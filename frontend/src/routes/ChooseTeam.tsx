import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "shared";
import { useCreateTeam, useJoinTeam, useTeams } from "@/lib/queries";
import { Button, Card, ErrorNote, Input, Screen, Spinner } from "@/components/ui";

export default function ChooseTeam({ user }: { user: User }) {
  const [name, setName] = useState("");
  const teams = useTeams();
  const create = useCreateTeam();
  const join = useJoinTeam();
  const navigate = useNavigate();

  if (user.teamId) navigate("/challenges", { replace: true });

  const go = () => navigate("/challenges");
  const error = (create.error ?? join.error) as Error | null;

  return (
    <Screen title="Your team">
      <div className="space-y-6">
        <Card>
          <h2 className="mb-3 font-semibold">Start a new team</h2>
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              aria-label="New team name"
            />
            <Button
              disabled={!name.trim() || create.isPending}
              onClick={() => create.mutate(name.trim(), { onSuccess: go })}
            >
              Create
            </Button>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 font-semibold">Or join one</h2>
          {teams.isLoading && <Spinner />}
          {teams.data?.length === 0 && (
            <p className="text-sm text-zinc-500">
              Nobody's made a team yet. Be the first.
            </p>
          )}
          <ul className="space-y-2">
            {teams.data?.map((t) => (
              <li key={t.teamId}>
                <Card className="flex items-center justify-between">
                  <span className="font-medium">{t.name}</span>
                  <Button
                    variant="ghost"
                    disabled={join.isPending}
                    onClick={() => join.mutate(t.teamId, { onSuccess: go })}
                  >
                    Join
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </div>

        {error && <ErrorNote>{error.message}</ErrorNote>}
      </div>
    </Screen>
  );
}
