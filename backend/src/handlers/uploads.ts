import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import {
  ALLOWED_UPLOAD_PREFIXES,
  MAX_UPLOAD_BYTES,
  mediaKeyPrefix,
} from "shared";
import { caller, requireVerified } from "../lib/auth";
import { handle, HttpError, ok, parseBody } from "../lib/http";
import { tracer } from "../lib/observability";

const s3 = tracer.captureAWSv3Client(new S3Client({}));
const BUCKET = process.env.MEDIA_BUCKET!;
const URL_TTL_SECONDS = 300;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    const c = caller(event);
    const user = await requireVerified(c);
    if (!user.teamId) throw new HttpError(409, "Join a team first");

    const { challengeId, contentType } = parseBody<{
      challengeId?: string;
      contentType?: string;
    }>(event.body);

    if (!challengeId) throw new HttpError(400, "challengeId required");
    if (!contentType || !ALLOWED_UPLOAD_PREFIXES.some((p) => contentType.startsWith(p))) {
      throw new HttpError(400, "Only image and video uploads are allowed");
    }

    // The key is built server-side from the caller's own team, so a client
    // cannot obtain a URL that writes into another team's prefix.
    const ext = EXTENSIONS[contentType] ?? "bin";
    const key = `${mediaKeyPrefix(user.teamId, challengeId)}${randomUUID()}.${ext}`;

    // Presigned POST rather than PUT: only POST can carry a
    // content-length-range condition, so the size cap is enforced by S3
    // instead of trusted from the browser.
    const presigned = await createPresignedPost(s3, {
      Bucket: BUCKET,
      Key: key,
      Expires: URL_TTL_SECONDS,
      Conditions: [
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
    });

    return ok({ key, url: presigned.url, fields: presigned.fields });
  });
