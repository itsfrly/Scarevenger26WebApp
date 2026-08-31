import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { logger } from "./observability";
import { assertFromCloudFront } from "./origin";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (
  status: number,
  body: unknown,
): APIGatewayProxyResultV2 => ({
  statusCode: status,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const ok = (body: unknown) => json(200, body);

/**
 * Wraps every handler. Takes the event so the CloudFront origin check cannot
 * be forgotten on a new route.
 *
 * There is no CORS layer here by design: CloudFront serves the app and the
 * API under one domain.
 */
export async function handle(
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  try {
    await assertFromCloudFront(event);
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) {
      logger.warn("request rejected", {
        status: err.status,
        reason: err.message,
      });
      return json(err.status, { error: err.message });
    }
    logger.error("unhandled error", err as Error);
    return json(500, { error: "Internal server error" });
  }
}

export function parseBody<T>(body: string | undefined): T {
  if (!body) throw new HttpError(400, "Request body required");
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new HttpError(400, "Body must be valid JSON");
  }
}
