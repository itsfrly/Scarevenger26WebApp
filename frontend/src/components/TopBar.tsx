import { useState } from "react";
import { useAuth } from "react-oidc-context";
import { LogOut } from "lucide-react";
import { cognitoLogoutUrl } from "@/lib/auth";

export default function TopBar({ email }: { email?: string }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    // Clear the local session first. Cognito's /logout redirects away
    // immediately, so anything after it would not run.
    await auth.removeUser();
    window.location.href = cognitoLogoutUrl();
  };

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-center gap-3 px-4 py-3">
        <span className="font-black tracking-tight text-orange-500">
          Scarevenger
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-zinc-600">
          {email}
        </span>
        <button
          onClick={() => void signOut()}
          disabled={busy}
          aria-label="Sign out"
          className="-mr-2 grid size-10 shrink-0 place-items-center rounded-lg text-zinc-500 active:bg-zinc-900 disabled:opacity-50"
        >
          <LogOut className="size-5" />
        </button>
      </div>
    </header>
  );
}
