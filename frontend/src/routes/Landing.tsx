import { useAuth } from "react-oidc-context";
import { Button } from "@/components/ui";

export default function Landing() {
  const auth = useAuth();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
      <div>
        <h1 className="text-5xl font-black tracking-tight text-orange-500">
          Scarevenger
        </h1>
        <p className="mt-3 text-zinc-400">
          Grab your team, hunt down the challenges, prove it with a photo.
        </p>
      </div>

      <Button className="w-full max-w-xs" onClick={() => void auth.signinRedirect()}>
        Sign in with Google
      </Button>

      <p className="max-w-xs text-xs text-zinc-600">
        You'll need the event code from the organizer after signing in.
      </p>
    </main>
  );
}
