import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "shared";
import { useVerifyEventCode } from "@/lib/queries";
import { Button, ErrorNote, Input, Screen } from "@/components/ui";

export default function JoinEvent({ user }: { user: User }) {
  const [code, setCode] = useState("");
  const verify = useVerifyEventCode();
  const navigate = useNavigate();

  if (user.eventVerified) {
    navigate("/team", { replace: true });
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    verify.mutate(code.trim(), { onSuccess: () => navigate("/team") });
  };

  return (
    <Screen title="Event code">
      <p className="mb-5 text-zinc-400">
        Your organizer shared a code with the group. Enter it to get in.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="four random words"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Event code"
        />
        {verify.isError && <ErrorNote>{(verify.error as Error).message}</ErrorNote>}
        <Button type="submit" className="w-full" disabled={!code.trim() || verify.isPending}>
          {verify.isPending ? "Checking…" : "Let me in"}
        </Button>
      </form>
    </Screen>
  );
}
