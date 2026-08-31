import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "node:path";

export interface SnapshotsProps {
  readonly table: dynamodb.Table;
  /** Off outside the event window; a snapshot every 15 min is pointless in July. */
  readonly enabled: boolean;
}

/**
 * Scheduled full export to S3.
 *
 * The on-demand admin export cannot help if the API is what broke, so this
 * writes files retrievable with nothing but the AWS console.
 *
 * Deliberately its own bucket rather than a prefix on the media bucket: media
 * is served publicly through CloudFront under /media/*, so an export placed
 * there would be downloadable by anyone who guessed the path.
 */
export class Snapshots extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: SnapshotsProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "Bucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      // The record of the event outlives the stack.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const fn = new NodejsFunction(this, "Snapshot", {
      entry: path.join(__dirname, "../../../backend/src/handlers/snapshot.ts"),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      tracing: lambda.Tracing.ACTIVE,
      logGroup: new logs.LogGroup(this, "SnapshotLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: props.table.tableName,
        EXPORTS_BUCKET: this.bucket.bucketName,
        POWERTOOLS_SERVICE_NAME: "scarevenger",
      },
      bundling: { minify: true, sourceMap: true, externalModules: ["@aws-sdk/*"] },
    });

    props.table.grantReadData(fn);
    this.bucket.grantPut(fn);

    new events.Rule(this, "Schedule", {
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
      enabled: props.enabled,
      targets: [new targets.LambdaFunction(fn)],
      description: "Scarevenger event snapshots (enable for the event window)",
    });
  }
}
