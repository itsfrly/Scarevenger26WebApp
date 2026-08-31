import * as cdk from "aws-cdk-lib";
import * as cw from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import { Construct } from "constructs";

export interface ObservabilityProps {
  readonly functions: lambda.IFunction[];
  readonly httpApi: apigw.HttpApi;
  readonly table: dynamodb.Table;
  readonly distribution: cloudfront.Distribution;
  /** Email for alarm notifications. Requires confirming a subscription email. */
  readonly alarmEmail?: string;
}

const NAMESPACE = "Scarevenger";

export class Observability extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: ObservabilityProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, "Alarms", { displayName: "Scarevenger alarms" });
    if (props.alarmEmail) {
      this.topic.addSubscription(new subs.EmailSubscription(props.alarmEmail));
    }

    const dashboard = new cw.Dashboard(this, "Dashboard", {
      dashboardName: "scarevenger",
      defaultInterval: cdk.Duration.hours(3),
    });

    // What actually matters on the night: are requests failing, are they slow,
    // and is anyone being turned away.
    const apiErrors = props.httpApi.metricServerError({ statistic: "Sum" });
    const apiLatency = props.httpApi.metricLatency({ statistic: "p95" });

    dashboard.addWidgets(
      new cw.GraphWidget({
        title: "API requests and errors",
        width: 12,
        left: [props.httpApi.metricCount({ statistic: "Sum" })],
        right: [
          props.httpApi.metricClientError({ statistic: "Sum" }),
          apiErrors,
        ],
      }),
      new cw.GraphWidget({
        title: "API latency (p95 / p99)",
        width: 12,
        left: [apiLatency, props.httpApi.metricLatency({ statistic: "p99" })],
      }),
    );

    dashboard.addWidgets(
      new cw.GraphWidget({
        title: "Lambda errors and throttles",
        width: 12,
        left: props.functions.map((f) => f.metricErrors({ statistic: "Sum" })),
        right: props.functions.map((f) => f.metricThrottles({ statistic: "Sum" })),
      }),
      new cw.GraphWidget({
        title: "Lambda duration (p95)",
        width: 12,
        left: props.functions.map((f) => f.metricDuration({ statistic: "p95" })),
      }),
    );

    dashboard.addWidgets(
      new cw.GraphWidget({
        title: "DynamoDB throttles",
        width: 8,
        left: [
          props.table.metricThrottledRequestsForOperations({
            operations: [
              dynamodb.Operation.QUERY,
              dynamodb.Operation.GET_ITEM,
              dynamodb.Operation.PUT_ITEM,
              dynamodb.Operation.UPDATE_ITEM,
              dynamodb.Operation.SCAN,
            ],
            statistic: "Sum",
          }),
        ],
      }),
      new cw.GraphWidget({
        title: "Event code attempts",
        width: 8,
        left: [
          new cw.Metric({
            namespace: NAMESPACE,
            metricName: "EventCodeAccepted",
            statistic: "Sum",
          }),
          new cw.Metric({
            namespace: NAMESPACE,
            metricName: "EventCodeRejected",
            statistic: "Sum",
          }),
        ],
      }),
      new cw.GraphWidget({
        title: "WAF (blocked / counted)",
        width: 8,
        left: [
          wafMetric("BlockedRequests"),
          wafMetric("CountedRequests"),
        ],
      }),
    );

    // Three alarms, chosen because each one means someone at the party is
    // having a bad time. Deliberately not alarming on 4xx: a wrong event code
    // is a 403 and entirely expected.
    this.alarm("ApiServerErrors", apiErrors, 5, "API is returning 5xx");
    this.alarm(
      "ApiLatency",
      apiLatency,
      3000,
      "API p95 latency above 3s — uploads will feel broken",
    );
    for (const fn of props.functions) {
      this.alarm(
        `LambdaErrors${fn.node.id}`,
        fn.metricErrors({ statistic: "Sum" }),
        5,
        `${fn.node.id} is throwing`,
      );
    }
  }

  private alarm(
    id: string,
    metric: cw.IMetric,
    threshold: number,
    description: string,
  ): void {
    new cw.Alarm(this, id, {
      metric,
      threshold,
      evaluationPeriods: 1,
      alarmDescription: description,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      // Absent data is normal for an app used one night a year.
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new actions.SnsAction(this.topic));
  }
}

const wafMetric = (name: string) =>
  new cw.Metric({
    namespace: "AWS/WAFV2",
    metricName: name,
    dimensionsMap: { WebACL: "scarevenger", Rule: "ALL", Region: "CloudFront" },
    statistic: "Sum",
    region: "us-east-1",
  });
