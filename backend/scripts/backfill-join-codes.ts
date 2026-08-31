/**
 * Gives a join code to teams created before join codes existed.
 *
 * Without one they cannot be joined at all and the invite card stays hidden.
 * Safe to re-run: teams that already have a code are skipped.
 *
 *   npx tsx backend/scripts/backfill-join-codes.ts
 */
import { randomInt } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  ScanCommand,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { generateJoinCode, keys, type Team } from "shared";

const TABLE = process.env.TABLE_NAME ?? "scarevenger";
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" }),
);

async function main() {
  const res = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      FilterExpression: "sk = :sk AND attribute_not_exists(joinCode)",
      ExpressionAttributeValues: { ":sk": "METADATA" },
    }),
  );
  const teams = (res.Items ?? []) as Team[];

  if (teams.length === 0) {
    console.log("every team already has a join code");
    return;
  }

  for (const team of teams) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const joinCode = generateJoinCode((max) => randomInt(max));
      try {
        await ddb.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: TABLE,
                  Item: { ...keys.joinCode(joinCode), teamId: team.teamId },
                  ConditionExpression: "attribute_not_exists(pk)",
                },
              },
              {
                Update: {
                  TableName: TABLE,
                  Key: keys.team(team.teamId),
                  UpdateExpression: "SET joinCode = :c",
                  // Re-runnable: another process may have got there first.
                  ConditionExpression: "attribute_not_exists(joinCode)",
                  ExpressionAttributeValues: { ":c": joinCode },
                },
              },
            ],
          }),
        );
        console.log(`${team.name.padEnd(24)} ${joinCode}`);
        break;
      } catch (err) {
        if ((err as { name?: string }).name !== "TransactionCanceledException") throw err;
        if (attempt === 4) console.error(`could not assign a code to ${team.name}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
