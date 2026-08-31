import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "shared";
import { useCreateTeam, useJoinTeam } from "@/lib/queries";
import { Button, Card, ErrorNote, Input, Screen } from "@/components/ui";

export default function ChooseTeam({ user }: { user: User }) {
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [code, setCode] = useState(params.get("invite") ?? "");
  const create = useCreateTeam();
  const join = useJoinTeam();
  const navigate = useNavigate();

  const go = () => navigate("/challenges");

  // Arriving on an invite link should just work rather than making someone
  // retype the code that is already in the URL.
  useEffect(() => {
    const invite = params.get("invite");
    if (invite && !user.teamId && !join.isPending && join.isIdle) {
      join.mutate(invite, { onSuccess: go });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (user.teamId) {
    navigate("/challenges", { replace: true });
  }

  const error = (create.error ?? join.error) as Error | null;

  return (
    <Screen title="Your team">
      <div className="space-y-6">
        <Card>
          <h2 className="mb-1 font-semibold">Join your team</h2>
          <p className="mb-3 text-sm text-zinc-500">
            Ask whoever made the team for the code.
          </p>
          <div className="flex gap-2">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              aria-label="Team join code"
              className="font-mono tracking-widest"
            />
            <Button
              disabled={!code.trim() || join.isPending}
              onClick={() => join.mutate(code.trim(), { onSuccess: go })}
            >
              Join
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-1 font-semibold">Or start a new one</h2>
          <p className="mb-3 text-sm text-zinc-500">
            You'll get a code to share with your team.
          </p>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              aria-label="New team name"
            />
            <Button
              variant="ghost"
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate(name.trim(), { onSuccess: go })}
            >
              Create
            </Button>
          </div>
        </Card>

        {error && <ErrorNote>{error.message}</ErrorNote>}
      </div>
    </Screen>
  );
}
