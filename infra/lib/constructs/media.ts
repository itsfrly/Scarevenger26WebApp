import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface MediaProps {
  /** Browser origins allowed to upload directly to the bucket. */
  readonly uploadOrigins: string[];
  readonly retainAfterDays: number;
}

export class Media extends Construct {
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: MediaProps) {
    super(scope, id);

    this.bucket = new s3.Bucket(this, "Bucket", {
      // Deliberately unnamed. RETAIN plus a fixed name would collide on the
      // next deploy; auto-naming means next year's event gets a fresh bucket
      // and last year's photos stay where they are.
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Reads are served through CloudFront, so nothing here is public.
      cors: [
        {
          allowedOrigins: props.uploadOrigins,
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.PUT],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          id: "expire-event-media",
          expiration: cdk.Duration.days(props.retainAfterDays),
        },
      ],
      // The photos are the irreplaceable part of the event; the stack is not.
      // ~$0.09/month for a few GB is cheaper than regretting a teardown.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
  }
}
