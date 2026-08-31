import { WebStorageStateStore } from "oidc-client-ts";
import type { AuthProviderProps } from "react-oidc-context";

const AUTHORITY = import.meta.env.VITE_AUTH_AUTHORITY;
const CLIENT_ID = import.meta.env.VITE_AUTH_CLIENT_ID;
const DOMAIN = import.meta.env.VITE_AUTH_DOMAIN;

export const oidcConfig: AuthProviderProps = {
  authority: AUTHORITY,
  client_id: CLIENT_ID,
  redirect_uri: `${window.location.origin}/auth/callback`,
  post_logout_redirect_uri: `${window.location.origin}/`,
  response_type: "code",
  scope: "openid email profile",
  // Google is the only provider, so skip Cognito's picker screen.
  extraQueryParams: { identity_provider: "Google" },
  // Survives a reload -- phones background tabs aggressively -- but clears
  // when the tab closes.
  userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  automaticSilentRenew: true,
  // Strips ?code= from the URL so a refresh cannot replay a spent code.
  onSigninCallback: () => {
    window.history.replaceState({}, document.title, window.location.pathname);
  },
};

/**
 * Cognito's OIDC discovery document has no end_session_endpoint, so
 * signoutRedirect() cannot work. The hosted UI uses /logout instead.
 */
export function cognitoLogoutUrl(): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    logout_uri: `${window.location.origin}/`,
  });
  return `${DOMAIN}/logout?${params}`;
}

export function groupsFrom(profile: unknown): string[] {
  const claim = (profile as Record<string, unknown> | undefined)?.[
    "cognito:groups"
  ];
  if (Array.isArray(claim)) return claim as string[];
  if (typeof claim === "string") {
    return claim.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
  }
  return [];
}
