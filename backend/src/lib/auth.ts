import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { keys, type User } from "shared";
import { ddb, TABLE_NAME } from "./ddb";
import { HttpError } from "./http";

export interface Caller {
  sub: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  /** Admins can judge; judges cannot administer. */
  isJudge: boolean;
}

export function caller(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const sub = claims.sub as string | undefined;
  if (!sub) throw new HttpError(401, "Unauthenticated");

  const g = groups(claims["cognito:groups"]);
  return {
    sub,
    email: (claims.email as string) ?? "",
    displayName:
      (claims.given_name as string) ?? (claims.email as string) ?? "Player",
    isAdmin: g.includes("admins"),
    isJudge: g.includes("judges") || g.includes("admins"),
  };
}

// HTTP API flattens list claims inconsistently: sometimes a real array,
// sometimes the string "[admins manager]". Handle both.
function groups(claim: unknown): string[] {
  if (Array.isArray(claim)) return claim as string[];
  if (typeof claim === "string") {
    return claim.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

/** Loads the caller's user record, rejecting anyone past the event-code gate. */
export async function requireVerified(c: Caller): Promise<User> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keys.user(c.sub) }),
  );
  const user = res.Item as User | undefined;
  if (!user?.eventVerified) {
    throw new HttpError(403, "Event code required");
  }
  return user;
}

export function requireAdmin(c: Caller): void {
  if (!c.isAdmin) throw new HttpError(403, "Admin only");
}

export function requireJudge(c: Caller): void {
  if (!c.isJudge) throw new HttpError(403, "Judges only");
}
