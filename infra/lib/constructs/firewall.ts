import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import { Construct } from "constructs";

export interface FirewallProps {
  /**
   * Managed rules start in COUNT so false positives show up in CloudWatch
   * rather than as someone unable to submit a photo at the party. Flip to
   * true once the logs are clean -- see the runbook in ARCHITECTURE.md.
   */
  readonly blockManagedRules: boolean;
}

// WAF cannot attach to an API Gateway HTTP API -- only CloudFront, ALB, REST
// APIs, AppSync and Cognito. CloudFront is therefore the only enforcement
// point, which is why the origin-verify header below matters: without it the
// execute-api URL is a way around everything here.
export class Firewall extends Construct {
  readonly webAcl: wafv2.CfnWebACL;
  /** Shared between CloudFront's custom header and the Lambdas' check. */
  readonly originSecret: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: FirewallProps) {
    super(scope, id);

    this.originSecret = new secretsmanager.Secret(this, "OriginSecret", {
      secretName: "scarevenger/origin-verify",
      description:
        "Value CloudFront sends as x-origin-verify; the API rejects requests without it.",
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      name: "scarevenger",
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "scarevenger-waf",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "ApiRateLimit",
          priority: 0,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              // Deliberately generous. The group may all be on one house's
              // wifi, so every request shares a source IP -- a tight limit
              // locks out the whole party rather than an attacker.
              limit: 5000,
              evaluationWindowSec: 300,
              aggregateKeyType: "IP",
              // Only the API counts. Static assets and media are cached at
              // the edge and harmless.
              scopeDownStatement: {
                byteMatchStatement: {
                  fieldToMatch: { uriPath: {} },
                  positionalConstraint: "STARTS_WITH",
                  searchString: "/api/",
                  textTransformations: [{ priority: 0, type: "NONE" }],
                },
              },
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "ApiRateLimit",
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "AmazonIpReputation",
          priority: 1,
          overrideAction: props.blockManagedRules ? { none: {} } : { count: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: "AWS",
              name: "AWSManagedRulesAmazonIpReputationList",
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "AmazonIpReputation",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
  }
}
