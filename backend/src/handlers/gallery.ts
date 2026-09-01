import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  prefixes,
  shuffleSeeded,
  type Challenge,
  type Slide,
  type Submission,
  type Team,
} from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireVerified } from "../lib/auth";
import { eventState } from "../lib/event";
import { handle, HttpError, ok } from "../lib/http";
import { allChallenges } from "../lib/scoring";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    const c = caller(event);
    await requireVerified(c);

    switch (event.routeKey) {
      case "GET /api/event":
        return ok(await eventState());

      case "GET /api/gallery": {
        const state = await eventState();
        // Everyone's media becomes visible only once the hunt is over. Before
        // that a team can see only its own, via the team dashboard.
        if (state.phase !== "ended" && !c.isAdmin) {
          throw new HttpError(409, "The hunt is still running");
        }
        return ok(await slides(state.endedAt ?? "preview"));
      }

      default:
        throw new HttpError(404, "Not found");
    }
  });

async function slides(seed: string): Promise<Slide[]> {
  const [submissions, challenges, teams] = await Promise.all([
    allSubmissions(),
    allChallenges(),
    allTeams(),
  ]);

  const challengeTitle = new Map(
    challenges.map((c) => [c.challengeId, c.title]),
  );
  const teamName = new Map(teams.map((t) => [t.teamId, t.name]));

  const flat: Slide[] = submissions
    // A judge marked these incomplete, usually dummy photos. Keep the reel to
    // real attempts.
    .filter((s) => s.status !== "rejected")
    .flatMap((s) =>
      s.files.map((f) => ({
        key: f.key,
        contentType: f.contentType,
        teamId: s.teamId,
        teamName: teamName.get(s.teamId) ?? "Unknown team",
        challengeId: s.challengeId,
        challengeTitle: challengeTitle.get(s.challengeId) ?? "Challenge",
        submittedAt: s.submittedAt,
      })),
    );

  // Seeded on the end time so every viewer sees the same order — people
  // watching together should be on the same slide.
  return shuffleSeeded(flat, seed);
}

async function allSubmissions(): Promise<Submission[]> {
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
  return items;
}

async function allTeams(): Promise<Team[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :e AND begins_with(gsi1sk, :t)",
      ExpressionAttributeValues: { ":e": prefixes.event, ":t": prefixes.team },
    }),
  );
  return (res.Items ?? []) as Team[];
}
