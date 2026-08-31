import type { User } from "shared";
import { useScoreboard } from "@/lib/queries";
import { Card, ErrorNote, Screen, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

export default function Scoreboard({ user }: { user: User }) {
  const board = useScoreboard();

  if (board.isLoading) return <Screen title="Scoreboard"><Spinner /></Screen>;
  if (board.isError) {
    return (
      <Screen title="Scoreboard">
        <ErrorNote>{(board.error as Error).message}</ErrorNote>
      </Screen>
    );
  }

  return (
    <Screen title="Scoreboard">
      <ol className="space-y-2">
        {(board.data ?? []).map((team, i) => {
          const mine = team.teamId === user.teamId;
          return (
            <li key={team.teamId}>
              <Card
                className={cn(
                  "flex items-center gap-3",
                  mine && "border-orange-500/60 bg-orange-950/20",
                )}
              >
                <span className="w-7 text-center text-lg font-bold text-zinc-500">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {team.name}
                  {mine && <span className="ml-2 text-xs text-orange-400">you</span>}
                </span>
                <span className="text-xl font-bold tabular-nums">{team.score}</span>
              </Card>
            </li>
          );
        })}
      </ol>
      <p className="mt-4 text-center text-xs text-zinc-600">
        Updates every 30 seconds. Judges can still adjust scores.
      </p>
    </Screen>
  );
}
