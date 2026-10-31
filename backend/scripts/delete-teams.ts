/**
 * Deletes teams and everything hanging off them: members, submissions, the
 * join code, judge placements, uploaded media, and each member's teamId (so
 * they land back on /team and can join a real one).
 *
 * Dry run unless --yes is passed. With no names, lists every team.
 *
 *   npx tsx backend/scripts/delete-teams.ts
 *   MEDIA_BUCKET=... npx tsx backend/scripts/delete-teams.ts "Test Team" "asdf"
 *   MEDIA_BUCKET=... npx tsx backend/scripts/delete-teams.ts "Test Team" "asdf" --yes
 *
 * Names match case-insensitively; a team id works too. Placements are not
 * renumbered: if a deleted team held 1st, nobody moves up. Re-run
 * "Recalculate scores" in the admin panel afterwards if any were touched.
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { keys, prefixes, type Challenge, type Team } from "shared";

const TABLE = process.env.TABLE_NAME ?? "scarevenger";
const BUCKET = process.env.MEDIA_BUCKET;
const region = "us-east-1";
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
const s3 = new S3Client({ region });

type Item = Record<string, unknown> & { pk: string; sk: string };

async function scanAll(params: Omit<ConstructorParameters<typeof ScanCommand>[0], "TableName">) {
  const out: Item[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({ TableName: TABLE, ...params, ExclusiveStartKey: start }),
    );
    out.push(...((res.Items ?? []) as Item[]));
    start = res.LastEvaluatedKey;
  } while (start);
  return out;
}

async function partition(pk: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": pk },
    }),
  );
  return (res.Items ?? []) as Item[];
}

async function mediaKeys(teamId: string) {
  if (!BUCKET) return [];
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `media/${teamId}/`,
        ContinuationToken: token,
      }),
    );
    out.push(...(res.Contents ?? []).map((o) => o.Key!));
    token = res.NextContinuationToken;
  } while (token);
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--yes");
  const wanted = args.filter((a) => a !== "--yes").map((a) => a.toLowerCase());

  const teams = (await scanAll({
    FilterExpression: "sk = :sk",
    ExpressionAttributeValues: { ":sk": "METADATA" },
  })) as unknown as (Team & Item)[];

  if (wanted.length === 0) {
    for (const t of teams.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const items = await partition(keys.team(t.teamId).pk);
      const members = items.filter((i) => i.sk.startsWith(prefixes.member));
      const subs = items.filter((i) => i.sk.startsWith(prefixes.submission));
      console.log(
        `${t.name.padEnd(28)} ${String(members.length).padStart(2)} members  ` +
          `${String(subs.length).padStart(3)} subs  ${t.createdAt.slice(0, 10)}  ${t.teamId}`,
      );
    }
    console.log(`\n${teams.length} teams. Pass names (or ids) to delete.`);
    return;
  }

  const targets = teams.filter(
    (t) => wanted.includes(t.name.toLowerCase()) || wanted.includes(t.teamId.toLowerCase()),
  );
  const found = new Set(targets.flatMap((t) => [t.name.toLowerCase(), t.teamId.toLowerCase()]));
  const missing = wanted.filter((w) => !found.has(w));
  if (missing.length) {
    console.error(`no team matches: ${missing.join(", ")}`);
    process.exit(1);
  }
  // Two teams can share a name; refuse rather than guess which one was meant.
  for (const w of wanted) {
    const hits = targets.filter((t) => t.name.toLowerCase() === w);
    if (hits.length > 1) {
      console.error(`"${w}" matches ${hits.length} teams; pass the ids instead:`);
      hits.forEach((h) => console.error(`  ${h.teamId}`));
      process.exit(1);
    }
  }

  const ids = new Set(targets.map((t) => t.teamId));
  const challenges = (await partition(prefixes.event)).filter((i) =>
    i.sk.startsWith(prefixes.challenge),
  ) as unknown as (Challenge & Item)[];
  const placed = challenges.filter((c) =>
    c.placements?.some((p) => p.teamIds.some((id) => ids.has(id))),
  );

  if (!BUCKET) console.log("MEDIA_BUCKET not set: uploaded media will be left in S3.\n");

  const plan = [];
  for (const t of targets) {
    const items = await partition(keys.team(t.teamId).pk);
    const members = items.filter((i) => i.sk.startsWith(prefixes.member));
    const media = await mediaKeys(t.teamId);
    plan.push({ team: t, items, members, media });
    console.log(
      `${t.name}: ${members.length} members, ` +
        `${items.filter((i) => i.sk.startsWith(prefixes.submission)).length} submissions, ` +
        `${media.length} media files`,
    );
    for (const m of members) console.log(`  - ${m.displayName ?? m.sk}`);
  }
  for (const c of placed) console.log(`placements on "${c.title}" will lose these teams`);

  if (!confirm) {
    console.log("\nDry run. Re-run with --yes to delete.");
    return;
  }

  for (const { team, items, members, media } of plan) {
    // Members first: if anything below fails, nobody is left pointing at a
    // team that is half gone. The condition skips anyone who already left.
    for (const m of members) {
      await ddb
        .send(
          new UpdateCommand({
            TableName: TABLE,
            Key: keys.user(m.sub as string),
            UpdateExpression: "REMOVE teamId",
            ConditionExpression: "teamId = :t",
            ExpressionAttributeValues: { ":t": team.teamId },
          }),
        )
        .catch((err) => {
          if (err.name !== "ConditionalCheckFailedException") throw err;
        });
    }

    const deletes = [...items.map((i) => ({ pk: i.pk, sk: i.sk }))];
    if (team.joinCode) deletes.push(keys.joinCode(team.joinCode));
    for (let i = 0; i < deletes.length; i += 25) {
      await ddb.send(
        new BatchWriteCommand({
          RequestItems: {
            [TABLE]: deletes.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
          },
        }),
      );
    }

    if (BUCKET) {
      for (let i = 0; i < media.length; i += 1000) {
        await s3.send(
          new DeleteObjectsCommand({
            Bucket: BUCKET,
            Delete: { Objects: media.slice(i, i + 1000).map((Key) => ({ Key })) },
          }),
        );
      }
    }
    console.log(`deleted ${team.name}`);
  }

  for (const c of placed) {
    const placements = c.placements!
      .map((p) => ({ ...p, teamIds: p.teamIds.filter((id) => !ids.has(id)) }))
      .filter((p) => p.teamIds.length > 0);
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk: c.pk, sk: c.sk },
        UpdateExpression: "SET placements = :p",
        ExpressionAttributeValues: { ":p": placements },
      }),
    );
  }
  if (placed.length) console.log('\nPlacements changed: run "Recalculate scores" in the admin panel.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
