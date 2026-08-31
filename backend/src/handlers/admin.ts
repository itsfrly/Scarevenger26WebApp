import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyResultV2,
} from "aws-lambda";
import { randomUUID } from "node:crypto";
import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { keys, prefixes, type Challenge } from "shared";
import { ddb, TABLE_NAME } from "../lib/ddb";
import { caller, requireAdmin } from "../lib/auth";
import { recomputeTeams } from "../lib/scoring";
import { buildExport, scanAll, toCsv } from "../lib/export";
import { handle, HttpError, json, ok, parseBody } from "../lib/http";

export const handler = async (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
): Promise<APIGatewayProxyResultV2> =>
  handle(event, async () => {
    // Admins are exempt from the event-code gate: they run the event.
    requireAdmin(caller(event));

    switch (event.routeKey) {
      case "PUT /api/admin/challenges": {
        const body = parseBody<Partial<Challenge>>(event.body);
        if (!body.title?.trim()) throw new HttpError(400, "Title required");

        const type = body.type ?? "standard";
        if (type === "standard" && typeof body.points !== "number") {
          throw new HttpError(400, "Standard challenges need points");
        }
        if (type === "ranked" && !body.awards?.length) {
          throw new HttpError(400, "Ranked challenges need at least one award");
        }

        const challenge: Challenge = {
          challengeId: body.challengeId ?? randomUUID(),
          title: body.title.trim(),
          description: body.description ?? "",
          active: body.active ?? true,
          type,
          proofType: body.proofType ?? "photo",
          maxFiles: body.maxFiles,
          points: type === "standard" ? body.points : undefined,
          awards: type === "ranked" ? body.awards : undefined,
          placements: body.placements,
          metricLabel: body.metricLabel,
          metricDirection: body.metricDirection,
        };
        await ddb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: { ...keys.challenge(challenge.challengeId), ...challenge },
          }),
        );
        return ok(challenge);
      }

      case "DELETE /api/admin/challenges/{id}": {
        const id = event.pathParameters?.id;
        if (!id) throw new HttpError(400, "Challenge id required");
        await ddb.send(
          new DeleteCommand({ TableName: TABLE_NAME, Key: keys.challenge(id) }),
        );
        return json(204, {});
      }

      case "POST /api/admin/recalculate":
        return ok(await recalculateAll());

      case "GET /api/admin/export":
        return exportAll(event.queryStringParameters?.format);

      default:
        throw new HttpError(404, "Not found");
    }
  });

/** Safety net: rebuilds every team's score from submissions and placements. */
async function recalculateAll(): Promise<{ teams: number }> {
  const items = await scanAll();
  const teamIds = items
    .filter((i) => i.sk === "METADATA")
    .map((i) => String(i.teamId));
  await recomputeTeams(teamIds);
  return { teams: teamIds.length };
}

/**
 * Full snapshot for the paper fallback. A Scan is correct here: ~2,000 items,
 * run rarely, and the point is to capture everything rather than serve a
 * specific access pattern.
 */
async function exportAll(format?: string): Promise<APIGatewayProxyResultV2> {
  const data = await buildExport();

  if (format === "csv") {
    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv",
        "content-disposition": `attachment; filename="scarevenger-${Date.now()}.csv"`,
      },
      body: toCsv(data),
    };
  }
  return ok(data);
}
