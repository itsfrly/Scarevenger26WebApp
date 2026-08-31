import { useState } from "react";
import type { Challenge, Submission } from "shared";
import {
  useChallenges,
  useReview,
  useReviewQueue,
  useSetPlacements,
  useTeams,
} from "@/lib/queries";
import { Button, Card, ErrorNote, Screen, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";

export default function Judge() {
  const [tab, setTab] = useState<"queue" | "ranked">("queue");

  return (
    <Screen title="Judging">
      <div className="mb-4 flex gap-2">
        <Tab active={tab === "queue"} onClick={() => setTab("queue")}>
          Submissions
        </Tab>
        <Tab active={tab === "ranked"} onClick={() => setTab("ranked")}>
          Ranked
        </Tab>
      </div>
      {tab === "queue" ? <Queue /> : <Ranked />}
    </Screen>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "min-h-10 flex-1 rounded-xl px-4 text-sm font-semibold",
        active ? "bg-orange-500 text-zinc-950" : "bg-zinc-800 text-zinc-300",
      )}
    >
      {children}
    </button>
  );
}

function Queue() {
  const queue = useReviewQueue(true);
  const challenges = useChallenges();
  const teams = useTeams();
  const review = useReview();

  if (queue.isLoading) return <Spinner />;
  if (queue.isError) return <ErrorNote>{(queue.error as Error).message}</ErrorNote>;

  const challengeName = new Map(
    (challenges.data ?? []).map((c) => [c.challengeId, c.title]),
  );
  const teamName = new Map((teams.data ?? []).map((t) => [t.teamId, t.name]));

  if (!queue.data?.length) {
    return <p className="text-sm text-zinc-500">No submissions yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {queue.data.map((s) => (
        <li key={`${s.teamId}/${s.challengeId}`}>
          <SubmissionCard
            submission={s}
            challengeTitle={challengeName.get(s.challengeId) ?? s.challengeId}
            teamTitle={teamName.get(s.teamId) ?? s.teamId}
            onReview={(status, note) =>
              review.mutate({
                teamId: s.teamId,
                challengeId: s.challengeId,
                status,
                note,
              })
            }
            pending={review.isPending}
          />
        </li>
      ))}
    </ul>
  );
}

function SubmissionCard({
  submission,
  challengeTitle,
  teamTitle,
  onReview,
  pending,
}: {
  submission: Submission;
  challengeTitle: string;
  teamTitle: string;
  onReview: (status: "submitted" | "rejected", note?: string) => void;
  pending: boolean;
}) {
  const rejected = submission.status === "rejected";

  return (
    <Card className={cn(rejected && "border-red-900/60")}>
      <div className="mb-2">
        <p className="font-medium">{challengeTitle}</p>
        <p className="text-sm text-zinc-500">
          {teamTitle}
          {submission.metricValue !== undefined && (
            <span className="ml-2 text-amber-400">{submission.metricValue}</span>
          )}
        </p>
      </div>

      {submission.files.length > 0 && (
        <ul className="mb-3 grid grid-cols-3 gap-2">
          {submission.files.map((f) => (
            <li key={f.key}>
              <a href={`/${f.key}`} target="_blank" rel="noreferrer">
                {f.contentType.startsWith("video/") ? (
                  <video src={`/${f.key}`} className="aspect-square w-full rounded-lg object-cover" />
                ) : (
                  <img src={`/${f.key}`} alt="" className="aspect-square w-full rounded-lg object-cover" />
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        {rejected ? (
          <Button
            variant="ghost"
            className="flex-1"
            disabled={pending}
            onClick={() => onReview("submitted")}
          >
            Restore
          </Button>
        ) : (
          <Button
            variant="danger"
            className="flex-1"
            disabled={pending}
            onClick={() => {
              const note = window.prompt("Why is this incomplete? (optional)") ?? "";
              onReview("rejected", note);
            }}
          >
            Mark incomplete
          </Button>
        )}
      </div>
    </Card>
  );
}

function Ranked() {
  const challenges = useChallenges();
  const ranked = (challenges.data ?? []).filter((c) => c.type === "ranked");

  if (challenges.isLoading) return <Spinner />;
  if (!ranked.length) {
    return <p className="text-sm text-zinc-500">No ranked challenges.</p>;
  }

  return (
    <ul className="space-y-3">
      {ranked.map((c) => (
        <li key={c.challengeId}>
          <RankedChallenge challenge={c} />
        </li>
      ))}
    </ul>
  );
}

function RankedChallenge({ challenge }: { challenge: Challenge }) {
  const teams = useTeams();
  const queue = useReviewQueue(true);
  const save = useSetPlacements();

  // Place -> teamIds. Several teams at one place is a tie, and each takes the
  // full points for it.
  const [places, setPlaces] = useState<Record<number, string[]>>(() =>
    Object.fromEntries(
      (challenge.placements ?? []).map((p) => [p.place, p.teamIds]),
    ),
  );

  const entries = (queue.data ?? [])
    .filter((s) => s.challengeId === challenge.challengeId && s.status !== "rejected")
    .sort((a, b) =>
      challenge.metricDirection === "lowest"
        ? (a.metricValue ?? 0) - (b.metricValue ?? 0)
        : (b.metricValue ?? 0) - (a.metricValue ?? 0),
    );

  const teamName = new Map((teams.data ?? []).map((t) => [t.teamId, t.name]));

  const toggle = (place: number, teamId: string) =>
    setPlaces((prev) => {
      const next: Record<number, string[]> = {};
      // A team can hold only one place, so clear it from the others first.
      for (const [p, ids] of Object.entries(prev)) {
        next[Number(p)] = ids.filter((id) => id !== teamId);
      }
      const current = next[place] ?? [];
      next[place] = current.includes(teamId) ? current : [...current, teamId];
      return next;
    });

  return (
    <Card>
      <p className="font-medium">{challenge.title}</p>
      {challenge.metricLabel && (
        <p className="mb-3 text-sm text-zinc-500">
          Sorted by {challenge.metricLabel.toLowerCase()} (
          {challenge.metricDirection ?? "highest"} first)
        </p>
      )}

      {entries.length === 0 && (
        <p className="py-2 text-sm text-zinc-500">No entries yet.</p>
      )}

      <ul className="space-y-2">
        {entries.map((s) => (
          <li key={s.teamId} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm">
              {teamName.get(s.teamId) ?? s.teamId}
              {s.metricValue !== undefined && (
                <span className="ml-2 text-amber-400">{s.metricValue}</span>
              )}
            </span>
            {(challenge.awards ?? []).map((a) => (
              <button
                key={a.place}
                onClick={() => toggle(a.place, s.teamId)}
                className={cn(
                  "size-9 shrink-0 rounded-lg text-sm font-bold",
                  places[a.place]?.includes(s.teamId)
                    ? "bg-amber-500 text-zinc-950"
                    : "bg-zinc-800 text-zinc-400",
                )}
                aria-label={`Place ${a.place} (${a.points} points)`}
              >
                {a.place}
              </button>
            ))}
          </li>
        ))}
      </ul>

      {save.isError && (
        <div className="mt-3">
          <ErrorNote>{(save.error as Error).message}</ErrorNote>
        </div>
      )}

      <Button
        className="mt-3 w-full"
        disabled={save.isPending || entries.length === 0}
        onClick={() =>
          save.mutate({
            challengeId: challenge.challengeId,
            placements: Object.entries(places)
              .filter(([, ids]) => ids.length > 0)
              .map(([place, teamIds]) => ({ place: Number(place), teamIds })),
          })
        }
      >
        {save.isPending ? "Saving…" : "Save placements"}
      </Button>
    </Card>
  );
}
