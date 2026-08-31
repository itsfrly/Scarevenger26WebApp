import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";

// Single table, key-overloaded. Access patterns:
//
//   1. Get user by Cognito sub        GetItem  USER#<sub> / PROFILE
//   2. Team dashboard                 Query    TEAM#<id>            -> metadata + members + submissions
//   3. Team's submissions             Query    TEAM#<id>, sk ^ SUB#
//   4. List challenges                Query    EVENT#<year>, sk ^ CHALLENGE#
//   5. List teams / scoreboard        Query    GSI1 EVENT#<year>, gsi1sk ^ TEAM#
//   6. Full export                    Scan     (~2k items)
//
// Pattern 2 is why this is one table: team, members and submissions share a
// partition, so the dashboard is one round trip instead of three.
export class Data extends Construct {
  readonly table: dynamodb.Table;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.Table(this, "Table", {
      tableName: "scarevenger",
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      // Traffic is one evening a year. Provisioned capacity would mean paying
      // for a baseline that is idle 364 days.
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      // Export before teardown: see the runbook in ARCHITECTURE.md.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.table.addGlobalSecondaryIndex({
      indexName: "gsi1",
      partitionKey: { name: "gsi1pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "gsi1sk", type: dynamodb.AttributeType.STRING },
    });
  }
}
