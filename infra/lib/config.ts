import { Construct } from "constructs";

// Set in your shell profile; nothing here is committed.
//   SCAREVENGER_GOOGLE_CLIENT_ID
//   SCAREVENGER_CERT_ARN              (only when SCAREVENGER_CUSTOM_AUTH_DOMAIN=true)
//   SCAREVENGER_CUSTOM_AUTH_DOMAIN

const DOMAIN_NAME = "scarevenger.app";
const LOCAL_DEV_ORIGIN = "http://localhost:5173";

/**
 * Extra HTTPS origin allowed through the OAuth flow, for testing on a phone.
 * Cognito permits http:// only for localhost, so a LAN IP will not work --
 * point a tunnel at the dev server and set this to its hostname:
 *
 *   export SCAREVENGER_DEV_ORIGIN=https://dev.scarevenger.app
 */
function devOrigin(scope: Construct): string | undefined {
  const value =
    scope.node.tryGetContext("devOrigin") ?? process.env.SCAREVENGER_DEV_ORIGIN;
  if (!value) return undefined;
  if (!String(value).startsWith("https://")) {
    throw new Error(
      `SCAREVENGER_DEV_ORIGIN must be https:// -- Cognito rejects http for anything but localhost. Got: ${value}`,
    );
  }
  return String(value).replace(/\/$/, "");
}

export interface CustomAuthDomain {
  readonly domainName: string;
  readonly certificateArn: string;
}

export interface ScavengerConfig {
  readonly domainName: string;
  readonly customAuthDomain?: CustomAuthDomain;
  /** Apex domain on CloudFront. Same switch and certificate as the auth domain. */
  readonly customSiteDomain?: CustomAuthDomain;
  readonly authDomainPrefix: string;
  readonly googleClientId: string;
  readonly googleClientSecretName: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  /** Flip on once WAF COUNT metrics show no false positives. */
  readonly blockManagedRules: boolean;
  /** Enable the 15-minute event snapshots. Off outside the event window. */
  readonly snapshotsEnabled: boolean;
  /** Optional: address to receive alarm notifications. */
  readonly alarmEmail?: string;
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

  const certificateArn = useCustomDomain
    ? required(
        scope,
        "certificateArn",
        "SCAREVENGER_CERT_ARN",
        "ACM cert ARN. aws acm list-certificates --region us-east-1",
      )
    : undefined;

  const dev = devOrigin(scope);

  return {
    domainName: DOMAIN_NAME,
    customSiteDomain:
      useCustomDomain && certificateArn
        ? { domainName: DOMAIN_NAME, certificateArn }
        : undefined,
    customAuthDomain: useCustomDomain
      ? { domainName: `login.${DOMAIN_NAME}`, certificateArn: certificateArn! }
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
    snapshotsEnabled:
      String(
        scope.node.tryGetContext("snapshotsEnabled") ??
          process.env.SCAREVENGER_SNAPSHOTS_ENABLED ??
          "false",
      ).toLowerCase() === "true",
    alarmEmail:
      scope.node.tryGetContext("alarmEmail") ??
      process.env.SCAREVENGER_ALARM_EMAIL ??
      undefined,
    blockManagedRules:
      String(
        scope.node.tryGetContext("blockManagedRules") ??
          process.env.SCAREVENGER_BLOCK_MANAGED_RULES ??
          "false",
      ).toLowerCase() === "true",
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
