import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomInt, randomUUID } from "node:crypto";
import { GetCommand, QueryCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import {
  generateJoinCode,
  indexKeys,
  keys,
  normalizeJoinCode,
  prefixes,
  type Submission,
  type Team,
  type TeamMember,
} from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireVerified, type Caller } from "../lib/auth";
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

      case "POST /api/teams/join": {
        const { code } = parseBody<{ code?: string }>(event.body);
        if (!code?.trim()) throw new HttpError(400, "Join code required");
        if (user.teamId) throw new HttpError(409, "Already on a team");
        return ok(await joinByCode(code, c.sub, c.displayName));
      }

      case "GET /api/teams/{id}": {
        if (!teamId) throw new HttpError(400, "Team id required");
        return ok(await teamDashboard(teamId, c, user.teamId));
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

/** The join code is a shared secret; it never appears in a list. */
const withoutCode = (team: Team): Omit<Team, "joinCode"> => {
  const { joinCode: _omit, ...rest } = team;
  return rest;
};

async function listTeams(): Promise<Omit<Team, "joinCode">[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :e AND begins_with(gsi1sk, :t)",
      ExpressionAttributeValues: { ":e": prefixes.event, ":t": prefixes.team },
    }),
  );
  return ((res.Items ?? []) as Team[])
    .sort((a, b) => b.score - a.score)
    .map(withoutCode);
}

async function createTeam(
  name: string,
  sub: string,
  displayName: string,
): Promise<Team> {
  const teamId = randomUUID();
  const now = new Date().toISOString();

  // The join-code lookup item doubles as a uniqueness constraint: a
  // conditional put on the same key fails if the code is taken. Six characters
  // from a 29-letter alphabet across ~30 teams makes a collision very
  // unlikely, but retrying is cheaper than reasoning about it.
  for (let attempt = 0; attempt < 5; attempt++) {
    const joinCode = generateJoinCode((max) => randomInt(max));
    const team: Team = { teamId, name, joinCode, createdBy: sub, score: 0, createdAt: now };

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE_NAME,
                Item: { ...keys.team(teamId), ...indexKeys.team(teamId), ...team },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: TABLE_NAME,
                Item: { ...keys.joinCode(joinCode), teamId },
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
      return team;
    } catch (err) {
      if ((err as { name?: string }).name !== "TransactionCanceledException") throw err;
      // Could be a code collision (retry) or the user already having a team
      // (do not). The latter is checked before we get here, so retry.
    }
  }
  throw new HttpError(503, "Could not allocate a join code, try again");
}

async function joinByCode(
  code: string,
  sub: string,
  displayName: string,
): Promise<{ teamId: string; joinedAt: string }> {
  const lookup = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keys.joinCode(code) }),
  );
  const teamId = (lookup.Item as { teamId?: string } | undefined)?.teamId;
  // Same message whether the code is wrong or the team vanished: a valid code
  // should not be distinguishable from an invalid one by probing.
  if (!teamId) throw new HttpError(404, "No team with that code");

  const now = new Date().toISOString();
  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          ConditionCheck: {
            TableName: TABLE_NAME,
            Key: keys.team(teamId),
            ConditionExpression: "attribute_exists(pk)",
          },
        },
        {
          Put: {
            TableName: TABLE_NAME,
            Item: { ...keys.member(teamId, sub), teamId, sub, displayName, joinedAt: now },
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
  return { teamId, joinedAt: now };
}

/** One query returns team metadata, members and submissions together. */
async function teamDashboard(teamId: string, c: Caller, callerTeamId?: string) {
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

  // Only members and admins see the join code. Otherwise anyone could read
  // another team's code straight off its dashboard.
  const canSeeCode = c.isAdmin || callerTeamId === teamId;

  return {
    team: canSeeCode ? team : withoutCode(team),
    members: items.filter((i) =>
      String(i.sk).startsWith(prefixes.member),
    ) as TeamMember[],
    submissions: items.filter((i) =>
      String(i.sk).startsWith(prefixes.submission),
    ) as Submission[],
  };
}
