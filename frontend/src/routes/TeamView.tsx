import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { challengePoints, type User } from "shared";
import { useChallenges, useTeam } from "@/lib/queries";
import { Card, ErrorNote, Screen, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Any team's submissions and what each one scored, open to every player. */
export default function TeamView({ user }: { user: User }) {
  const { id } = useParams();
  const team = useTeam(id);
  const challenges = useChallenges();

  if (team.isLoading || challenges.isLoading) return <Screen><Spinner /></Screen>;
  if (team.isError) {
    return (
      <Screen>
        <Back />
        <ErrorNote>{(team.error as Error).message}</ErrorNote>
      </Screen>
    );
  }

  const { team: t, members, submissions } = team.data!;
  const byChallenge = new Map(submissions.map((s) => [s.challengeId, s]));

  // Ranked points can arrive by placement alone, so walk challenges rather
  // than submissions. Newest submission first; placements without one last.
  const rows = (challenges.data ?? [])
    .map((c) => ({
      challenge: c,
      submission: byChallenge.get(c.challengeId),
      points: challengePoints(t.teamId, c, byChallenge.get(c.challengeId)),
    }))
    .filter((r) => r.submission || r.points > 0)
    .sort((a, b) =>
      (b.submission?.submittedAt ?? "").localeCompare(a.submission?.submittedAt ?? ""),
    );

  return (
    <Screen>
      <Back />
      <header className="mb-5 mt-3">
        <h1 className="text-2xl font-bold">
          {t.name}
          {t.teamId === user.teamId && (
            <span className="ml-2 align-middle text-xs text-orange-400">you</span>
          )}
        </h1>
        <p className="text-zinc-400">
          {t.score} points · {rows.length} challenge{rows.length === 1 ? "" : "s"}
        </p>
        {members.length > 0 && (
          <p className="mt-1 text-sm text-zinc-500">
            {members.map((m) => m.displayName).join(", ")}
          </p>
        )}
      </header>

      {rows.length === 0 && <p className="text-zinc-400">Nothing submitted yet.</p>}

      <ul className="space-y-3">
        {rows.map(({ challenge, submission, points }) => {
          const rejected = submission?.status === "rejected";
          return (
            <li key={challenge.challengeId}>
              <Card>
                <div className="mb-2 flex items-start gap-3">
                  <p className="min-w-0 flex-1 font-medium">{challenge.title}</p>
                  <span
                    className={cn(
                      "shrink-0 font-bold tabular-nums",
                      points > 0 ? "text-orange-400" : "text-zinc-600",
                    )}
                  >
                    {points} pts
                  </span>
                </div>

                {rejected && (
                  <p className="mb-2 text-sm text-red-400">
                    Marked incomplete
                    {submission.reviewNote ? `: ${submission.reviewNote}` : ""}
                  </p>
                )}
                {challenge.metricLabel && submission?.metricValue !== undefined && (
                  <p className="mb-2 text-sm text-zinc-400">
                    {challenge.metricLabel}: {submission.metricValue}
                  </p>
                )}
                {challenge.type === "ranked" && points === 0 && !rejected && (
                  <p className="mb-2 text-sm text-zinc-500">Awaiting judges</p>
                )}

                {submission && submission.files.length > 0 && (
                  <ul className="grid grid-cols-3 gap-2">
                    {submission.files.map((f) => (
                      <li
                        key={f.key}
                        className={cn(f.contentType.startsWith("video/") && "col-span-3")}
                      >
                        {f.contentType.startsWith("video/") ? (
                          <video
                            src={`/${f.key}`}
                            className="w-full rounded-lg"
                            controls
                            playsInline
                            preload="metadata"
                          />
                        ) : (
                          <a href={`/${f.key}`} target="_blank" rel="noreferrer">
                            <img
                              src={`/${f.key}`}
                              alt={`${t.name} — ${challenge.title}`}
                              loading="lazy"
                              className="aspect-square w-full rounded-lg object-cover"
                            />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </Screen>
  );
}

function Back() {
  return (
    <Link to="/scoreboard" className="inline-flex items-center gap-1 text-sm text-zinc-400">
      <ArrowLeft className="size-4" /> Scoreboard
    </Link>
  );
}
