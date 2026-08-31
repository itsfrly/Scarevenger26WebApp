import { Construct } from "constructs";

// Set in your shell profile; nothing here is committed.
//   SCAREVENGER_GOOGLE_CLIENT_ID
//   SCAREVENGER_CERT_ARN              (only when SCAREVENGER_CUSTOM_AUTH_DOMAIN=true)
//   SCAREVENGER_CUSTOM_AUTH_DOMAIN

const DOMAIN_NAME = "scarevenger.app";
const LOCAL_DEV_ORIGIN = "http://localhost:5173";

export interface CustomAuthDomain {
  readonly domainName: string;
  readonly certificateArn: string;
}

export interface ScavengerConfig {
  readonly domainName: string;
  readonly customAuthDomain?: CustomAuthDomain;
  readonly authDomainPrefix: string;
  readonly googleClientId: string;
  readonly googleClientSecretName: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
}

export function resolveConfig(scope: Construct): ScavengerConfig {
  const googleClientId = required(
    scope,
    "googleClientId",
    "SCAREVENGER_GOOGLE_CLIENT_ID",
    "Google OAuth web client ID.",
  );

  const useCustomDomain =
    String(
      scope.node.tryGetContext("customAuthDomain") ??
        process.env.SCAREVENGER_CUSTOM_AUTH_DOMAIN ??
        "false",
    ).toLowerCase() === "true";

  return {
    domainName: DOMAIN_NAME,
    customAuthDomain: useCustomDomain
      ? {
          domainName: `login.${DOMAIN_NAME}`,
          certificateArn: required(
            scope,
            "certificateArn",
            "SCAREVENGER_CERT_ARN",
            "ACM cert ARN. aws acm list-certificates --region us-east-1",
          ),
        }
      : undefined,
    authDomainPrefix:
      scope.node.tryGetContext("authDomainPrefix") ??
      process.env.SCAREVENGER_AUTH_DOMAIN_PREFIX ??
      "scarevenger",
    googleClientId,
    googleClientSecretName:
      scope.node.tryGetContext("googleClientSecretName") ??
      process.env.SCAREVENGER_GOOGLE_SECRET_NAME ??
      "scarevenger/google-oauth-client-secret",
    callbackUrls: [
      `https://${DOMAIN_NAME}/auth/callback`,
      `${LOCAL_DEV_ORIGIN}/auth/callback`,
    ],
    logoutUrls: [`https://${DOMAIN_NAME}/`, `${LOCAL_DEV_ORIGIN}/`],
  };
}

// Env var fallback matters because `cdk destroy` synthesizes too: a
// context-only value locks you out of tearing down a broken stack.
function required(
  scope: Construct,
  contextKey: string,
  envVar: string,
  help: string,
): string {
  const value = scope.node.tryGetContext(contextKey) ?? process.env[envVar];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `Missing ${contextKey}. ${help}\n` +
        `  export ${envVar}=<value>   (or -c ${contextKey}=<value>)`,
    );
  }
  return value;
}
