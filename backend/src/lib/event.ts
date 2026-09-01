import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { keys, type EventState } from "shared";
import { ddb, TABLE_NAME } from "./ddb";
import { HttpError } from "./http";

export async function eventState(): Promise<EventState> {
  const res = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: keys.eventState() }),
  );
  // Absent means the hunt has never been ended.
  return (res.Item as EventState | undefined) ?? { phase: "open" };
}

export async function requireOpen(): Promise<void> {
  const state = await eventState();
  if (state.phase === "ended") {
    throw new HttpError(409, "The hunt has ended — no more submissions");
  }
}
