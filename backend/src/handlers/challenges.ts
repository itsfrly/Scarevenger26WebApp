import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  fileCountValid,
  keys,
  mediaKeyPrefix,
  type Challenge,
  type Submission,
  type SubmissionFile,
} from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireVerified } from "../lib/auth";
import { allChallenges, recomputeTeam } from "../lib/scoring";
import { handle, HttpError, ok, parseBody } from "../lib/http";
import { tracer } from "../lib/observability";

const s3 = tracer.captureAWSv3Client(new S3Client({}));
const BUCKET = process.env.MEDIA_BUCKET!;

interface SubmissionInput {
  challengeId?: string;
  files?: SubmissionFile[];
  metricValue?: number;
}

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(async () => {
    const c = caller(event);
    const user = await requireVerified(c);

    switch (event.routeKey) {
      case "GET /api/challenges":
        return ok((await allChallenges()).filter((ch) => ch.active));

      case "POST /api/submissions": {
        if (!user.teamId) throw new HttpError(409, "Join a team first");
        return ok(
          await submit(user.teamId, c.sub, parseBody<SubmissionInput>(event.body)),
        );
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

async function submit(
  teamId: string,
  sub: string,
  input: SubmissionInput,
): Promise<Submission> {
  if (!input.challengeId) throw new HttpError(400, "challengeId required");

  const res = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: keys.challenge(input.challengeId),
    }),
  );
  const challenge = res.Item as Challenge | undefined;
  if (!challenge?.active) throw new HttpError(404, "Challenge not found");

  const files = input.files ?? [];
  if (!fileCountValid(challenge, files.length)) {
    throw new HttpError(400, proofHelp(challenge));
  }
  // Trust nothing the client says about the key: it must sit under this
  // team's prefix for this challenge, and the object must actually exist.
  // Otherwise a team could claim submissions they never uploaded.
  const prefix = mediaKeyPrefix(teamId, input.challengeId);
  await Promise.all(
    files.map(async (f) => {
      if (!f.key?.startsWith(prefix)) {
        throw new HttpError(400, "File key does not belong to this submission");
      }
      try {
        await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: f.key }));
      } catch {
        throw new HttpError(400, `Upload not found: ${f.key}`);
      }
    }),
  );
  if (challenge.metricLabel && typeof input.metricValue !== "number") {
    throw new HttpError(400, `${challenge.metricLabel} required`);
  }

  // Resubmitting replaces the entry outright, including clearing a previous
  // rejection: a team that was told to redo a challenge gets a clean review.
  const submission: Submission = {
    teamId,
    challengeId: input.challengeId,
    files,
    metricValue: input.metricValue,
    submittedBy: sub,
    submittedAt: new Date().toISOString(),
    status: "submitted",
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: { ...keys.submission(teamId, input.challengeId), ...submission },
    }),
  );

  // Ranked challenges score only when a judge assigns placements, so this is
  // a no-op for them.
  await recomputeTeam(teamId);
  return submission;
}

function proofHelp(c: Challenge): string {
  switch (c.proofType) {
    case "none":
      return "This challenge takes no files";
    case "photo":
      return "Exactly one photo required";
    case "video":
      return "Exactly one video required";
    case "photos":
      return `Between 1 and ${c.maxFiles ?? 10} photos required`;
  }
}
