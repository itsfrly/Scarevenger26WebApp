import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export interface AuthProps {
  readonly customAuthDomain?: {
    readonly domainName: string;
    readonly certificateArn: string;
  };
  readonly authDomainPrefix: string;
  readonly googleClientId: string;
  readonly googleClientSecret: cdk.SecretValue;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
}

// Google is the only identity provider, so the pool holds no passwords. The
// event code is enforced by the API after authentication, not here.
export class Auth extends Construct {
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly userPoolDomain: cognito.UserPoolDomain;
  readonly authBaseUrl: string;
  readonly usesCustomDomain: boolean;

  constructor(scope: Construct, id: string, props: AuthProps) {
    super(scope, id);

    this.usesCustomDomain = props.customAuthDomain !== undefined;

    this.userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: "scarevenger",
      // Federated users arrive via the IdP link, not the SignUp API.
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      accountRecovery: cognito.AccountRecovery.NONE,
      mfa: cognito.Mfa.OFF,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool: this.userPool,
        clientId: props.googleClientId,
        clientSecretValue: props.googleClientSecret,
        // Non-sensitive scopes only; anything more triggers Google's
        // verification review before the consent screen can go public.
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
          familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
        },
      },
    );

    // A pool has one domain. The custom domain provisions a CloudFront
    // distribution: ~15-20 min to create and the same to delete, so dev
    // deploys use the prefix domain. Switching modes replaces the resource
    // and costs that wait once.
    if (props.customAuthDomain) {
      this.userPoolDomain = this.userPool.addDomain("AuthDomain", {
        customDomain: {
          domainName: props.customAuthDomain.domainName,
          certificate: acm.Certificate.fromCertificateArn(
            this,
            "AuthCertificate",
            props.customAuthDomain.certificateArn,
          ),
        },
      });
      this.authBaseUrl = `https://${props.customAuthDomain.domainName}`;
    } else {
      this.userPoolDomain = this.userPool.addDomain("AuthDomain", {
        cognitoDomain: { domainPrefix: props.authDomainPrefix },
      });
      this.authBaseUrl = `https://${props.authDomainPrefix}.auth.${
        cdk.Stack.of(this).region
      }.amazoncognito.com`;
    }

    this.userPoolClient = this.userPool.addClient("WebClient", {
      userPoolClientName: "scarevenger-web",
      generateSecret: false, // public SPA client, authorization code + PKCE
      authFlows: {},
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
      preventUserExistenceErrors: true,
      accessTokenValidity: cdk.Duration.hours(1),
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(1),
    });

    // Not inferred: supportedIdentityProviders takes an enum, not a reference,
    // so without this the client can deploy first and fail with "identity
    // provider does not exist".
    this.userPoolClient.node.addDependency(googleProvider);
  }

  // CNAME target for `login` in Cloudflare. Custom domain mode only.
  get dnsTarget(): string {
    return this.userPoolDomain.cloudFrontEndpoint;
  }

  // Register both modes' URIs in Google Cloud so switching never breaks
  // sign-in.
  get googleRedirectUri(): string {
    return `${this.authBaseUrl}/oauth2/idpresponse`;
  }
}
