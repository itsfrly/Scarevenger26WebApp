import { Link } from "react-router-dom";
import { Check, ChevronRight, Trophy, X } from "lucide-react";
import type { Challenge, Submission, User } from "shared";
import { useChallenges, useTeam } from "@/lib/queries";
import { Card, ErrorNote, Screen, Spinner } from "@/components/ui";

export default function Challenges({ user }: { user: User }) {
  const challenges = useChallenges();
  const team = useTeam(user.teamId);

  if (challenges.isLoading || team.isLoading) return <Screen><Spinner /></Screen>;
  if (challenges.isError) {
    return <Screen><ErrorNote>{(challenges.error as Error).message}</ErrorNote></Screen>;
  }

  const byChallenge = new Map(
    (team.data?.submissions ?? []).map((s) => [s.challengeId, s]),
  );
  const list = challenges.data ?? [];
  const done = list.filter(
    (c) => byChallenge.get(c.challengeId)?.status === "submitted",
  ).length;

  return (
    <Screen>
      <header className="mb-5">
        <h1 className="text-2xl font-bold">{team.data?.team.name ?? "Your team"}</h1>
        <p className="text-zinc-400">
          {team.data?.team.score ?? 0} points · {done} of {list.length} done
        </p>
      </header>

      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.challengeId}>
            <Row challenge={c} submission={byChallenge.get(c.challengeId)} />
          </li>
        ))}
      </ul>
    </Screen>
  );
}

function Row({
  challenge,
  submission,
}: {
  challenge: Challenge;
  submission?: Submission;
}) {
  const rejected = submission?.status === "rejected";
  const complete = submission?.status === "submitted";

  return (
    <Link to={`/challenges/${challenge.challengeId}`} className="block">
      <Card className="flex items-center gap-3">
        <Status complete={complete} rejected={rejected} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{challenge.title}</p>
          <p className="text-sm text-zinc-500">
            {challenge.type === "ranked" ? (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <Trophy className="size-3.5" /> Ranked
              </span>
            ) : (
              `${challenge.points} pts`
            )}
            {rejected && <span className="ml-2 text-red-400">Needs redoing</span>}
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-zinc-600" />
      </Card>
    </Link>
  );
}

function Status({ complete, rejected }: { complete: boolean; rejected: boolean }) {
  if (rejected) {
    return (
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-red-950 text-red-400">
        <X className="size-5" />
      </span>
    );
  }
  return (
    <span
      className={
        complete
          ? "grid size-9 shrink-0 place-items-center rounded-full bg-emerald-950 text-emerald-400"
          : "size-9 shrink-0 rounded-full border-2 border-dashed border-zinc-700"
      }
    >
      {complete && <Check className="size-5" />}
    </span>
  );
}
