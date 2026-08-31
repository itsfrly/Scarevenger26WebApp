import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { resolveConfig } from "./config";
import { AppSecrets } from "./constructs/secrets";
import { Auth } from "./constructs/auth";

export class ScavengerHuntStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const config = resolveConfig(this);

    // Secrets first: the Google IdP resolves the client secret at deploy time.
    const secrets = new AppSecrets(this, "Secrets", {
      googleClientSecretName: config.googleClientSecretName,
    });

    const auth = new Auth(this, "Auth", {
      customAuthDomain: config.customAuthDomain,
      authDomainPrefix: config.authDomainPrefix,
      googleClientId: config.googleClientId,
      googleClientSecret: secrets.googleClientSecret,
      callbackUrls: config.callbackUrls,
      logoutUrls: config.logoutUrls,
    });

    // Next: DynamoDB, Lambda + IAM, API Gateway + JWT authorizer, S3,
    // CloudFront, WAF, CloudWatch + X-Ray. See ARCHITECTURE.md.

    new cdk.CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: auth.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, "AuthBaseUrl", { value: auth.authBaseUrl });
    new cdk.CfnOutput(this, "GoogleRedirectUri", {
      value: auth.googleRedirectUri,
      description: "Must be registered in the Google Cloud console.",
    });
    if (auth.usesCustomDomain) {
      new cdk.CfnOutput(this, "AuthDnsTarget", {
        value: auth.dnsTarget,
        description: "Cloudflare CNAME target for `login`. DNS only.",
      });
    }
    new cdk.CfnOutput(this, "EventCodeSecretArn", {
      value: secrets.eventCode.secretArn,
      description: "Overwrite the generated value before the event.",
    });
  }
}
