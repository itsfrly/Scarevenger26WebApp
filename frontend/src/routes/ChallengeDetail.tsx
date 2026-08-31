import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Camera } from "lucide-react";
import { DEFAULT_MAX_FILES, fileCountValid, type SubmissionFile, type User } from "shared";
import { useChallenges, useSubmit, useTeam } from "@/lib/queries";
import { UploadError, uploadOne } from "@/lib/upload";
import { Button, Card, ErrorNote, Input, Screen, Spinner } from "@/components/ui";

export default function ChallengeDetail({ user }: { user: User }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const challenges = useChallenges();
  const team = useTeam(user.teamId);
  const submit = useSubmit();
  const fileInput = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<SubmissionFile[]>([]);
  const [metric, setMetric] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (challenges.isLoading || team.isLoading) return <Screen><Spinner /></Screen>;

  const challenge = challenges.data?.find((c) => c.challengeId === id);
  if (!challenge) {
    return <Screen title="Not found"><Back /></Screen>;
  }

  const existing = team.data?.submissions.find((s) => s.challengeId === id);
  const maxFiles =
    challenge.proofType === "photos" ? (challenge.maxFiles ?? DEFAULT_MAX_FILES) : 1;

  const onPick = async (picked: FileList | null) => {
    if (!picked?.length) return;
    setBusy(true);
    setError(null);
    try {
      const uploaded: SubmissionFile[] = [];
      for (const file of Array.from(picked).slice(0, maxFiles - files.length)) {
        uploaded.push(await uploadOne(challenge.challengeId, file));
      }
      setFiles((prev) => [...prev, ...uploaded]);
    } catch (e) {
      setError(
        e instanceof UploadError ? e.message : (e as Error).message ?? "Upload failed",
      );
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const needsMetric = Boolean(challenge.metricLabel);
  const countOk = fileCountValid(challenge, files.length);
  const canSubmit =
    countOk && (!needsMetric || metric.trim() !== "") && !busy && !submit.isPending;

  return (
    <Screen>
      <Back />
      <h1 className="mb-1 mt-3 text-2xl font-bold">{challenge.title}</h1>
      <p className="mb-1 text-zinc-400">{challenge.description}</p>
      <p className="mb-5 text-sm text-zinc-500">
        {challenge.type === "ranked"
          ? `Ranked — judges award ${challenge.awards?.map((a) => a.points).join(" / ")} points`
          : `${challenge.points} points`}
      </p>

      {existing && (
        <Card className="mb-5">
          <p className="text-sm">
            {existing.status === "rejected" ? (
              <span className="text-red-400">
                A judge marked this incomplete
                {existing.reviewNote ? `: ${existing.reviewNote}` : "."} Upload
                again to fix it.
              </span>
            ) : (
              <span className="text-emerald-400">Submitted. You can replace it below.</span>
            )}
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {challenge.proofType !== "none" && (
          <>
            <input
              ref={fileInput}
              type="file"
              className="sr-only"
              accept={challenge.proofType === "video" ? "video/*" : "image/*"}
              // `capture` opens the camera directly rather than the gallery.
              capture="environment"
              multiple={challenge.proofType === "photos"}
              onChange={(e) => void onPick(e.target.files)}
            />
            <Button
              variant="ghost"
              className="w-full"
              disabled={busy || files.length >= maxFiles}
              onClick={() => fileInput.current?.click()}
            >
              <Camera className="size-5" />
              {busy
                ? "Uploading…"
                : files.length === 0
                  ? challenge.proofType === "video"
                    ? "Record video"
                    : "Take photo"
                  : `Add another (${files.length}/${maxFiles})`}
            </Button>

            {files.length > 0 && (
              <ul className="grid grid-cols-3 gap-2">
                {files.map((f) => (
                  <li key={f.key}>
                    <img
                      src={`/${f.key}`}
                      alt=""
                      className="aspect-square w-full rounded-lg object-cover"
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {needsMetric && (
          <label className="block">
            <span className="mb-1 block text-sm text-zinc-400">
              {challenge.metricLabel}
            </span>
            <Input
              type="number"
              inputMode="numeric"
              value={metric}
              onChange={(e) => setMetric(e.target.value)}
            />
          </label>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
        {submit.isError && <ErrorNote>{(submit.error as Error).message}</ErrorNote>}

        <Button
          className="w-full"
          disabled={!canSubmit}
          onClick={() =>
            submit.mutate(
              {
                challengeId: challenge.challengeId,
                files,
                metricValue: needsMetric ? Number(metric) : undefined,
              },
              { onSuccess: () => navigate("/challenges") },
            )
          }
        >
          {submit.isPending ? "Submitting…" : existing ? "Replace submission" : "Mark complete"}
        </Button>

        {challenge.proofType === "none" && (
          <p className="text-center text-xs text-zinc-600">
            Honour system. No photo needed for this one.
          </p>
        )}
      </div>
    </Screen>
  );
}

function Back() {
  return (
    <Link to="/challenges" className="inline-flex items-center gap-1 text-sm text-zinc-400">
      <ArrowLeft className="size-4" /> All challenges
    </Link>
  );
}
