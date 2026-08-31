import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { prefixes } from "shared";
import { ddb, TABLE_NAME } from "./ddb";

export interface EventExport {
  exportedAt: string;
  teams: Record<string, unknown>[];
  challenges: Record<string, unknown>[];
  submissions: Record<string, unknown>[];
}

export async function scanAll(): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(
      new ScanCommand({ TableName: TABLE_NAME, ExclusiveStartKey: startKey }),
    );
    items.push(...((res.Items ?? []) as Record<string, unknown>[]));
    startKey = res.LastEvaluatedKey;
  } while (startKey);
  return items;
}

export async function buildExport(): Promise<EventExport> {
  const items = await scanAll();
  return {
    exportedAt: new Date().toISOString(),
    teams: items.filter((i) => i.sk === "METADATA"),
    challenges: items.filter((i) =>
      String(i.sk).startsWith(prefixes.challenge),
    ),
    submissions: items.filter((i) =>
      String(i.sk).startsWith(prefixes.submission),
    ),
  };
}

/** Grid of teams against challenges, for printing. */
export function toCsv(data: EventExport): string {
  const done = new Set(
    data.submissions
      .filter((s) => s.status !== "rejected")
      .map((s) => `${s.teamId}|${s.challengeId}`),
  );
  const header: string[] = [
    "Team",
    "Score",
    ...data.challenges.map((c) => String(c.title)),
  ];
  const rows: string[][] = data.teams
    .slice()
    .sort((a, b) => Number(b.score) - Number(a.score))
    .map((t) => [
      String(t.name),
      String(t.score),
      ...data.challenges.map((c) =>
        done.has(`${t.teamId}|${c.challengeId}`) ? "X" : "",
      ),
    ]);
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
