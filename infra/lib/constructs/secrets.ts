import * as cdk from "aws-cdk-lib";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface AppSecretsProps {
  readonly googleClientSecretName: string;
}

export class AppSecrets extends Construct {
  readonly googleClientSecret: cdk.SecretValue;
  readonly eventCode: secretsmanager.Secret;
  readonly driveCredentials: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AppSecretsProps) {
    super(scope, id);

    // Created by hand, outside CDK: Cognito needs the real value at deploy
    // time. Name-based, not Secret.fromSecretNameV2().secretValue, which
    // builds an ARN without Secrets Manager's random suffix and fails to
    // resolve.
    this.googleClientSecret = cdk.SecretValue.secretsManager(
      props.googleClientSecretName,
    );

    // Generated rather than a "REPLACE_ME" placeholder: a forgotten literal
    // would be a guessable event code, a forgotten random one fails loudly.
    this.eventCode = new secretsmanager.Secret(this, "EventCode", {
      secretName: "scarevenger/event-code",
      description: "Shared event code checked by the API after sign-in.",
      generateSecretString: { passwordLength: 20, excludePunctuation: true },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.driveCredentials = new secretsmanager.Secret(this, "DriveCredentials", {
      secretName: "scarevenger/drive-admin-credentials",
      description: "Service account for the Drive account receiving uploads.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ clientEmail: "", projectId: "" }),
        generateStringKey: "privateKey",
        excludePunctuation: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
