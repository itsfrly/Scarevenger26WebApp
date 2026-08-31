import { Construct } from "constructs";

/**
 * Deployment configuration.
 *
 * Non-secret settings live in `cdk.json` under `scarevenger:*` so local and CI
 * deploys cannot disagree — a flag change is a reviewable commit, not two
 * places to keep in sync. Environment variables override for one-off local
 * testing.
 *
 * The ACM certificate ARN is the one exception: it contains the AWS account
 * id, so it stays out of the repo and comes from SCAREVENGER_CERT_ARN (the
 * CERT_ARN GitHub secret in CI).
 */

export interface CustomAuthDomain {
  readonly domainName: string;
  readonly certificateArn: string;
}

export interface ScavengerConfig {
  readonly domainName: string;
  readonly customAuthDomain?: CustomAuthDomain;
  readonly customSiteDomain?: CustomAuthDomain;
  readonly authDomainPrefix: string;
  readonly googleClientId: string;
  readonly googleClientSecretName: string;
  readonly callbackUrls: string[];
  readonly logoutUrls: string[];
  readonly blockManagedRules: boolean;
  readonly snapshotsEnabled: boolean;
  readonly alarmEmail?: string;
  readonly repository: string;
  readonly deployBranch: string;
  readonly githubOidcProviderExists: boolean;
}

const LOCAL_DEV_ORIGIN = "http://localhost:5173";

export function resolveConfig(scope: Construct): ScavengerConfig {
  const domainName = str(scope, "domainName", "scarevenger.app");
  const googleClientId = required(
    scope,
    "googleClientId",
    "SCAREVENGER_GOOGLE_CLIENT_ID",
    "Google OAuth web client ID. Set scarevenger:googleClientId in cdk.json.",
  );

  const useCustomDomain = bool(scope, "customAuthDomain");
  const certificateArn = useCustomDomain
    ? requiredEnv(
        "SCAREVENGER_CERT_ARN",
        "ACM cert ARN (us-east-1). Kept out of the repo because it contains " +
          "the account id.\n" +
          "    aws acm list-certificates --region us-east-1",
      )
    : undefined;

  const custom = certificateArn
    ? { domainName: `login.${domainName}`, certificateArn }
    : undefined;

  // Extra HTTPS origin for testing on a real device through a tunnel. Cognito
  // permits http only for localhost, so a LAN IP will not work.
  const dev = devOrigin(scope);

  return {
    domainName,
    customAuthDomain: custom,
    customSiteDomain: certificateArn
      ? { domainName, certificateArn }
      : undefined,
    authDomainPrefix: str(scope, "authDomainPrefix", "scarevenger"),
    googleClientId,
    googleClientSecretName: str(
      scope,
      "googleClientSecretName",
      "scarevenger/google-oauth-client-secret",
    ),
    callbackUrls: [
      `https://${domainName}/auth/callback`,
      `${LOCAL_DEV_ORIGIN}/auth/callback`,
      ...(dev ? [`${dev}/auth/callback`] : []),
    ],
    logoutUrls: [
      `https://${domainName}/`,
      `${LOCAL_DEV_ORIGIN}/`,
      ...(dev ? [`${dev}/`] : []),
    ],
    blockManagedRules: bool(scope, "blockManagedRules"),
    snapshotsEnabled: bool(scope, "snapshotsEnabled"),
    alarmEmail: str(scope, "alarmEmail", "") || undefined,
    repository: str(scope, "repository", ""),
    deployBranch: str(scope, "deployBranch", "main"),
    githubOidcProviderExists: bool(scope, "githubOidcProviderExists"),
  };
}

// --- lookup helpers -------------------------------------------------------
// Precedence: -c flag, then SCAREVENGER_<UPPER_SNAKE>, then cdk.json.

const envName = (key: string) =>
  `SCAREVENGER_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`;

function raw(scope: Construct, key: string): unknown {
  return (
    scope.node.tryGetContext(key) ??
    process.env[envName(key)] ??
    scope.node.tryGetContext(`scarevenger:${key}`)
  );
}

function str(scope: Construct, key: string, fallback: string): string {
  const v = raw(scope, key);
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

function bool(scope: Construct, key: string): boolean {
  return String(raw(scope, key) ?? "false").toLowerCase() === "true";
}

function required(
  scope: Construct,
  key: string,
  envVar: string,
  help: string,
): string {
  const v = raw(scope, key);
  if (typeof v !== "string" || v.length === 0) {
    throw new Error(`Missing ${key}.\n  ${help}\n  Or: export ${envVar}=<value>`);
  }
  return v;
}

function requiredEnv(envVar: string, help: string): string {
  const v = process.env[envVar];
  if (!v) throw new Error(`Missing ${envVar}.\n  ${help}`);
  return v;
}

function devOrigin(scope: Construct): string | undefined {
  const v = raw(scope, "devOrigin");
  if (typeof v !== "string" || v.length === 0) return undefined;
  if (!v.startsWith("https://")) {
    throw new Error(
      `devOrigin must be https:// — Cognito rejects http for anything but localhost. Got: ${v}`,
    );
  }
  return v.replace(/\/$/, "");
}
