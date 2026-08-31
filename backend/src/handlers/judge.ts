import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { GetCommand, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { keys, prefixes, type Challenge, type Placement, type Submission } from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireJudge } from "../lib/auth";
import { allChallenges, recomputeTeam, recomputeTeams } from "../lib/scoring";
import { handle, HttpError, ok, parseBody } from "../lib/http";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    const c = caller(event);
    requireJudge(c);

    switch (event.routeKey) {
      case "GET /api/judge/submissions":
        return ok(await reviewQueue(event.queryStringParameters?.challengeId));

      case "POST /api/judge/submissions/{teamId}/{challengeId}": {
        const { teamId, challengeId } = event.pathParameters ?? {};
        if (!teamId || !challengeId) throw new HttpError(400, "teamId and challengeId required");
        const { status, note } = parseBody<{ status?: string; note?: string }>(
          event.body,
        );
        if (status !== "submitted" && status !== "rejected") {
          throw new HttpError(400, "status must be 'submitted' or 'rejected'");
        }
        return ok(await review(teamId, challengeId, status, note, c.sub));
      }

      case "PUT /api/judge/challenges/{id}/placements": {
        const challengeId = event.pathParameters?.id;
        if (!challengeId) throw new HttpError(400, "Challenge id required");
        const { placements } = parseBody<{ placements?: Placement[] }>(event.body);
        return ok(await setPlacements(challengeId, placements ?? [], c.sub));
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

/**
 * All submissions, optionally for one challenge. A Scan is honest here: there
 * is no access pattern for "every team's submissions" and adding a GSI to
 * serve a screen a handful of people open a few times an evening would cost
 * more in write amplification than it saves.
 */
async function reviewQueue(challengeId?: string): Promise<Submission[]> {
  const items: Submission[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: "begins_with(sk, :s)",
        ExpressionAttributeValues: { ":s": prefixes.submission },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...((res.Items ?? []) as Submission[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);

  const filtered = challengeId
    ? items.filter((s) => s.challengeId === challengeId)
    : items;
  return filtered.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
}

async function review(
  teamId: string,
  challengeId: string,
  status: "submitted" | "rejected",
  note: string | undefined,
  judgeSub: string,
): Promise<Submission> {
  const res = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.submission(teamId, challengeId),
      UpdateExpression:
        "SET #s = :s, reviewedBy = :j, reviewedAt = :t, reviewNote = :n",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":s": status,
        ":j": judgeSub,
        ":t": new Date().toISOString(),
        ":n": note ?? "",
      },
      ReturnValues: "ALL_NEW",
    }),
  );
  await recomputeTeam(teamId);
  return res.Attributes as Submission;
}

async function setPlacements(
  challengeId: string,
  placements: Placement[],
  judgeSub: string,
): Promise<Challenge> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keys.challenge(challengeId) }),
  );
  const challenge = res.Item as Challenge | undefined;
  if (!challenge) throw new HttpError(404, "Challenge not found");
  if (challenge.type !== "ranked") {
    throw new HttpError(400, "Only ranked challenges have placements");
  }

  const awarded = new Set((challenge.awards ?? []).map((a) => a.place));
  for (const p of placements) {
    if (!awarded.has(p.place)) {
      throw new HttpError(400, `No award defined for place ${p.place}`);
    }
    if (p.teamIds.length === 0) {
      throw new HttpError(400, `Place ${p.place} has no teams`);
    }
  }
  const assigned = placements.flatMap((p) => p.teamIds);
  if (new Set(assigned).size !== assigned.length) {
    throw new HttpError(400, "A team cannot hold two places");
  }

  const updated = await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.challenge(challengeId),
      UpdateExpression: "SET placements = :p, reviewedBy = :j, reviewedAt = :t",
      ExpressionAttributeValues: {
        ":p": placements,
        ":j": judgeSub,
        ":t": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }),
  );

  // Teams losing a place need recomputing as much as teams gaining one.
  const affected = [
    ...assigned,
    ...(challenge.placements ?? []).flatMap((p) => p.teamIds),
  ];
  await recomputeTeams(affected);
  return updated.Attributes as Challenge;
}
