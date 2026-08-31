import { PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  keys,
  prefixes,
  teamScore,
  type Challenge,
  type Submission,
} from "shared";
import { ddb, TABLE_NAME } from "./ddb";

export async function allChallenges(): Promise<Challenge[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :e AND begins_with(sk, :c)",
      ExpressionAttributeValues: {
        ":e": prefixes.event,
        ":c": prefixes.challenge,
      },
    }),
  );
  return (res.Items ?? []) as Challenge[];
}

export async function teamSubmissions(teamId: string): Promise<Submission[]> {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :s)",
      ExpressionAttributeValues: {
        ":pk": keys.team(teamId).pk,
        ":s": prefixes.submission,
      },
    }),
  );
  return (res.Items ?? []) as Submission[];
}

/**
 * Recomputes and stores one team's score. Two queries, ~45 items.
 *
 * Not atomic with the write that triggered it, which is fine: a recompute is
 * idempotent, so a lost update corrects itself on the next scoring event
 * rather than drifting permanently the way a missed delta would.
 */
export async function recomputeTeam(
  teamId: string,
  challenges?: Challenge[],
): Promise<number> {
  const [subs, chals] = await Promise.all([
    teamSubmissions(teamId),
    challenges ? Promise.resolve(challenges) : allChallenges(),
  ]);
  const score = teamScore(teamId, subs, chals);

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: keys.team(teamId),
      UpdateExpression: "SET score = :s",
      ConditionExpression: "attribute_exists(pk)",
      ExpressionAttributeValues: { ":s": score },
    }),
  );
  return score;
}

export async function recomputeTeams(teamIds: string[]): Promise<void> {
  if (teamIds.length === 0) return;
  const challenges = await allChallenges();
  await Promise.all(
    [...new Set(teamIds)].map((id) => recomputeTeam(id, challenges)),
  );
}
