import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { HttpError } from "./http";
import { tracer } from "./observability";

const secrets = tracer.captureAWSv3Client(new SecretsManagerClient({}));
const ORIGIN_SECRET_ARN = process.env.ORIGIN_SECRET_ARN!;
const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { value: string; expires: number } | undefined;

/**
 * WAF cannot attach to an HTTP API, so the execute-api URL bypasses every rule
 * on the distribution. CloudFront injects a shared header no outside caller
 * knows; anything without it is refused.
 */
export async function assertFromCloudFront(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<void> {
  const header = event.headers?.["x-origin-verify"];
  if (!header || !timingSafeEqual(header, await originSecret())) {
    throw new HttpError(403, "Forbidden");
  }
}

async function originSecret(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.value;
  const res = await secrets.send(
    new GetSecretValueCommand({ SecretId: ORIGIN_SECRET_ARN }),
  );
  cached = {
    value: (res.SecretString ?? "").trim(),
    expires: Date.now() + CACHE_TTL_MS,
  };
  return cached.value;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
