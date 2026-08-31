import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { resolveConfig } from "./config";
import { AppSecrets } from "./constructs/secrets";
import { Auth } from "./constructs/auth";
import { Data } from "./constructs/data";
import { Api } from "./constructs/api";
import { Media } from "./constructs/media";
import { Cdn } from "./constructs/cdn";
import { Firewall } from "./constructs/firewall";
import { Snapshots } from "./constructs/snapshots";
import { Observability } from "./constructs/observability";

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

    const data = new Data(this, "Data");

    const firewall = new Firewall(this, "Firewall", {
      blockManagedRules: config.blockManagedRules,
    });

    const media = new Media(this, "Media", {
      uploadOrigins: [`https://${config.domainName}`, "http://localhost:5173"],
      retainAfterDays: 90,
    });

    const api = new Api(this, "Api", {
      table: data.table,
      mediaBucket: media.bucket,
      originSecret: firewall.originSecret,
      eventCode: secrets.eventCode,
      userPool: auth.userPool,
      userPoolClient: auth.userPoolClient,
    });

    const cdn = new Cdn(this, "Cdn", {
      mediaBucket: media.bucket,
      httpApi: api.httpApi,
      customDomain: config.customSiteDomain,
      webAclArn: firewall.webAcl.attrArn,
      originSecret: firewall.originSecret,
    });

    const snapshots = new Snapshots(this, "Snapshots", {
      table: data.table,
      enabled: config.snapshotsEnabled,
    });

    new Observability(this, "Observability", {
      functions: api.functions,
      httpApi: api.httpApi,
      table: data.table,
      distribution: cdn.distribution,
      alarmEmail: config.alarmEmail,
    });

    // Next: CI/CD with GitHub OIDC, custom domain cutover.

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
    new cdk.CfnOutput(this, "TableName", { value: data.table.tableName });
    new cdk.CfnOutput(this, "ApiUrl", { value: api.httpApi.apiEndpoint });
    new cdk.CfnOutput(this, "MediaBucket", { value: media.bucket.bucketName });
    new cdk.CfnOutput(this, "SnapshotsBucket", {
      value: snapshots.bucket.bucketName,
      description: "Scheduled event snapshots. latest.csv is the paper fallback.",
    });
    new cdk.CfnOutput(this, "SiteUrl", { value: cdn.url });
    new cdk.CfnOutput(this, "SiteBucket", { value: cdn.siteBucket.bucketName });
    new cdk.CfnOutput(this, "DistributionId", {
      value: cdn.distribution.distributionId,
      description: "For cache invalidation after a frontend deploy.",
    });
    new cdk.CfnOutput(this, "EventCodeSecretArn", {
      value: secrets.eventCode.secretArn,
      description: "Overwrite the generated value before the event.",
    });
  }
}
