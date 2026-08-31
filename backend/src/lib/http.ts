import type { APIGatewayProxyResultV2 } from "aws-lambda";
import { logger } from "./observability";

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

// CloudFront serves the app and the API under one domain, so there is no CORS
// layer here by design.
export async function handle(
  fn: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  try {
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
