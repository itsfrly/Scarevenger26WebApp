import type { AuthContextProps } from "react-oidc-context";
import { groupsFrom } from "./auth";

export { setTokenGetter } from "./api";

export function groupsFromAuth(auth: AuthContextProps): string[] {
  return groupsFrom(auth.user?.profile);
}
