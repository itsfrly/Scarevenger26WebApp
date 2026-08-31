import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import {
  QueryCommand,
  TransactWriteCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  indexKeys,
  keys,
  prefixes,
  type Team,
  type TeamMember,
  type Submission,
} from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireVerified } from "../lib/auth";
import { handle, HttpError, ok, parseBody } from "../lib/http";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    const c = caller(event);
    const user = await requireVerified(c);
    const teamId = event.pathParameters?.id;

    switch (event.routeKey) {
      case "GET /api/teams":
      case "GET /api/scoreboard":
        return ok(await listTeams());

      case "POST /api/teams": {
        const { name } = parseBody<{ name?: string }>(event.body);
        if (!name?.trim()) throw new HttpError(400, "Team name required");
        if (user.teamId) throw new HttpError(409, "Already on a team");
        return ok(await createTeam(name.trim(), c.sub, c.displayName));
      }

      case "POST /api/teams/{id}/members": {
        if (!teamId) throw new HttpError(400, "Team id required");
        if (user.teamId) throw new HttpError(409, "Already on a team");
        return ok(await joinTeam(teamId, c.sub, c.displayName));
      }

      case "GET /api/teams/{id}": {
        if (!teamId) throw new HttpError(400, "Team id required");
        return ok(await teamDashboard(teamId));
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

async function listTeams(): Promise<Team[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :e AND begins_with(gsi1sk, :t)",
      ExpressionAttributeValues: { ":e": prefixes.event, ":t": prefixes.team },
    }),
  );
  return ((res.Items ?? []) as Team[]).sort((a, b) => b.score - a.score);
}

async function createTeam(name: string, sub: string, displayName: string) {
  const teamId = randomUUID();
  const now = new Date().toISOString();

  // Transaction so a user can never end up pointing at a team that was not
  // created, or created without its founding member.
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              ...keys.team(teamId),
              ...indexKeys.team(teamId),
              teamId,
              name,
              score: 0,
              createdAt: now,
            },
            ConditionExpression: "attribute_not_exists(pk)",
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              ...keys.member(teamId, sub),
              teamId,
              sub,
              displayName,
              joinedAt: now,
            },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: keys.user(sub),
            UpdateExpression: "SET teamId = :t",
            ConditionExpression: "attribute_not_exists(teamId)",
            ExpressionAttributeValues: { ":t": teamId },
          },
        },
      ],
    }),
  );
  return { teamId, name, score: 0, createdAt: now };
}

async function joinTeam(teamId: string, sub: string, displayName: string) {
  const now = new Date().toISOString();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          // Fails the whole transaction if the team does not exist.
          ConditionCheck: {
            TableName: TABLE_NAME,
            Key: keys.team(teamId),
            ConditionExpression: "attribute_exists(pk)",
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: {
              ...keys.member(teamId, sub),
              teamId,
              sub,
              displayName,
              joinedAt: now,
            },
          },
        },
        {
          Update: {
            TableName: TABLE_NAME,
            Key: keys.user(sub),
            UpdateExpression: "SET teamId = :t",
            ConditionExpression: "attribute_not_exists(teamId)",
            ExpressionAttributeValues: { ":t": teamId },
          },
        },
      ],
    }),
  );
  return { teamId, sub, displayName, joinedAt: now };
}

/** One query returns team metadata, members and submissions together. */
async function teamDashboard(teamId: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": keys.team(teamId).pk },
    }),
  );
  const items = res.Items ?? [];
  const team = items.find((i) => i.sk === "METADATA") as Team | undefined;
  if (!team) throw new HttpError(404, "Team not found");

  return {
    team,
    members: items.filter((i) =>
      String(i.sk).startsWith(prefixes.member),
    ) as TeamMember[],
    submissions: items.filter((i) =>
      String(i.sk).startsWith(prefixes.submission),
    ) as Submission[],
  };
}
