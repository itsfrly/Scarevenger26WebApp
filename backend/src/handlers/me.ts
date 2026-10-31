import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { keys, type User } from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller } from "../lib/auth";
import { handle, HttpError, ok, parseBody } from "../lib/http";
import { logger, metrics, tracer } from "../lib/observability";

const secrets = tracer.captureAWSv3Client(new SecretsManagerClient({}));
const EVENT_CODE_SECRET_ARN = process.env.EVENT_CODE_SECRET_ARN!;

// Cached across invocations to avoid a Secrets Manager call per sign-in, but
// with a TTL: without one, rotating the code mid-event would leave warm
// containers accepting the old value indefinitely.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedCode: { value: string; expires: number } | undefined;

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    const c = caller(event);

    switch (event.routeKey) {
      case "GET /api/me":
        return ok(await getOrCreateUser(c.sub, c.email, c.displayName));

      case "POST /api/event-code": {
        const { code } = parseBody<{ code?: string }>(event.body);
        if (!code) throw new HttpError(400, "Code required");

        if (!timingSafeEqual(code.trim(), await eventCode())) {
          metrics.addMetric("EventCodeRejected", "Count", 1);
          metrics.publishStoredMetrics();
          logger.warn("event code rejected", { sub: c.sub });
          throw new HttpError(403, "Incorrect event code");
        }

        const res = await ddb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: keys.user(c.sub),
            UpdateExpression: "SET eventVerified = :t",
            ExpressionAttributeValues: { ":t": true },
            ReturnValues: "ALL_NEW",
          }),
        );
        metrics.addMetric("EventCodeAccepted", "Count", 1);
        metrics.publishStoredMetrics();
        return ok(res.Attributes);
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

/**
 * Always upserts rather than read-then-create.
 *
 * One round trip instead of two, no race between concurrent sign-ins, and it
 * backfills any field a partial record is missing -- which matters because
 * POST /event-code creates the item too, so a user can exist with only
 * eventVerified set.
 */
async function getOrCreateUser(
  sub: string,
  email: string,
  displayName: string,
): Promise<User> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.user(sub),
      // `sub` is a DynamoDB reserved word and must be aliased. So are `name`,
      // `size`, `status` and `timestamp` -- worth checking before adding an
      // attribute to any expression.
      UpdateExpression:
        "SET #sub = if_not_exists(#sub, :sub), email = if_not_exists(email, :email), " +
        "displayName = if_not_exists(displayName, :name), " +
        "eventVerified = if_not_exists(eventVerified, :false), " +
        "createdAt = if_not_exists(createdAt, :now)",
      ExpressionAttributeNames: { "#sub": "sub" },
      ExpressionAttributeValues: {
        ":sub": sub,
        ":email": email,
        ":name": displayName,
        ":false": false,
        ":now": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  return res.Attributes as User;
}

async function eventCode(): Promise<string> {
  if (cachedCode && cachedCode.expires > Date.now()) return cachedCode.value;
  const res = await secrets.send(
    new GetSecretValueCommand({ SecretId: EVENT_CODE_SECRET_ARN }),
  );
  cachedCode = {
    value: (res.SecretString ?? "").trim(),
    expires: Date.now() + CACHE_TTL_MS,
  };
  return cachedCode.value;
}

// Constant-time compare so a wrong code cannot be narrowed by response timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
