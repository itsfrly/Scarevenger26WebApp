import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { buildExport, toCsv } from "../lib/export";
import { logger, tracer } from "../lib/observability";

const s3 = tracer.captureAWSv3Client(new S3Client({}));
const BUCKET = process.env.EXPORTS_BUCKET!;

/**
 * Periodic snapshot of the whole event to S3.
 *
 * The on-demand admin export cannot help if the API is what broke, so this
 * runs on a schedule and leaves files that are readable with nothing but the
 * AWS console. Off by default -- enabled for the event window.
 */
export const handler = async (): Promise<void> => {
  const data = await buildExport();
  const stamp = data.exportedAt.replace(/[:.]/g, "-");

  await Promise.all([
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `snapshots/${stamp}.json`,
        Body: JSON.stringify(data, null, 2),
        ContentType: "application/json",
      }),
    ),
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: `snapshots/${stamp}.csv`,
        Body: toCsv(data),
        ContentType: "text/csv",
      }),
    ),
    // Stable key so there is always one obvious file to grab in a hurry.
    s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: "latest.csv",
        Body: toCsv(data),
        ContentType: "text/csv",
      }),
    ),
  ]);

  logger.info("snapshot written", {
    teams: data.teams.length,
    submissions: data.submissions.length,
  });
};
