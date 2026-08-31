// Seeds the challenge list. Run with your SSO profile active:
//   npx tsx backend/scripts/seed-challenges.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { keys, type Challenge } from "shared";

const TABLE = process.env.TABLE_NAME ?? "scarevenger";
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: "us-east-1" }),
);

const CHALLENGES: Omit<Challenge, "challengeId">[] = [
  {
    title: "Group photo with a jack-o'-lantern",
    description: "Whole team in frame.",
    active: true, type: "standard", proofType: "photo", points: 10,
  },
  {
    title: "Sing a whole verse of the Monster Mash",
    description: "Honour system. We will know.",
    active: true, type: "standard", proofType: "none", points: 5,
  },
  {
    title: "Three houses with inflatable decorations",
    description: "One photo each.",
    active: true, type: "standard", proofType: "photos", maxFiles: 3, points: 20,
  },
  {
    title: "Film your best scream",
    description: "Ten seconds, one take.",
    active: true, type: "standard", proofType: "video", points: 25,
  },
  {
    title: "Highest skeeball score",
    description: "Photo of the machine showing your score.",
    active: true, type: "ranked", proofType: "photo",
    awards: [
      { place: 1, points: 50 },
      { place: 2, points: 30 },
      { place: 3, points: 15 },
    ],
    metricLabel: "Skeeball score",
    metricDirection: "highest",
  },
];

async function main() {
  for (const [i, c] of CHALLENGES.entries()) {
    const challengeId = `c${String(i + 1).padStart(2, "0")}`;
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: { ...keys.challenge(challengeId), challengeId, ...c },
      }),
    );
    console.log(`seeded ${challengeId}  ${c.title}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
