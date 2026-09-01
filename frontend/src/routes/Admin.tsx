import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import {
  DEFAULT_MAX_FILES,
  type Award,
  type Challenge,
  type ChallengeType,
  type ProofType,
} from "shared";
import {
  useChallenges,
  useDeleteChallenge,
  useEventState,
  useSaveChallenge,
  useSetEventPhase,
} from "@/lib/queries";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Input, Screen, Spinner } from "@/components/ui";

const BLANK: Partial<Challenge> = {
  title: "",
  description: "",
  active: true,
  type: "standard",
  proofType: "photo",
  points: 10,
};

export default function Admin() {
  const challenges = useChallenges();
  const [editing, setEditing] = useState<Partial<Challenge> | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (challenges.isLoading) return <Screen title="Challenges"><Spinner /></Screen>;

  return (
    <Screen title="Challenges">
      {editing ? (
        <Editor challenge={editing} onDone={() => setEditing(null)} />
      ) : (
        <>
          <EndHunt />

          <Button className="mb-4 w-full" onClick={() => setEditing({ ...BLANK })}>
            <Plus className="size-5" /> New challenge
          </Button>

          <ul className="space-y-2">
            {(challenges.data ?? []).map((c) => (
              <li key={c.challengeId}>
                <Card className="flex items-center gap-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setEditing(c)}
                  >
                    <p className="truncate font-medium">{c.title}</p>
                    <p className="text-sm text-zinc-500">
                      {c.type === "ranked"
                        ? `Ranked · ${c.awards?.map((a) => a.points).join("/")}`
                        : `${c.points} pts`}{" "}
                      · {c.proofType}
                    </p>
                  </button>
                </Card>
              </li>
            ))}
          </ul>

          <Button
            variant="ghost"
            className="mt-6 w-full"
            disabled={exporting}
            onClick={() => {
              setExporting(true);
              setExportError(null);
              api
                .download(
                  "/admin/export?format=csv",
                  `scarevenger-${new Date().toISOString().slice(0, 10)}.csv`,
                )
                .catch((e: Error) => setExportError(e.message))
                .finally(() => setExporting(false));
            }}
          >
            <Download className="size-5" />
            {exporting ? "Exporting…" : "Export scoreboard CSV"}
          </Button>
          {exportError && (
            <div className="mt-2">
              <ErrorNote>{exportError}</ErrorNote>
            </div>
          )}
          <p className="mt-2 text-center text-xs text-zinc-600">
            Print this before the event as your paper fallback.
          </p>
        </>
      )}
    </Screen>
  );
}

function EndHunt() {
  const event = useEventState();
  const setPhase = useSetEventPhase();
  const ended = event.data?.phase === "ended";

  return (
    <Card className="mb-4">
      <p className="font-semibold">
        {ended ? "The hunt has ended" : "The hunt is running"}
      </p>
      <p className="mb-3 text-sm text-zinc-500">
        {ended
          ? "Submissions are closed and the slideshow is open to everyone."
          : "Ending closes submissions and opens the slideshow. You can reopen it."}
      </p>
      <Button
        variant={ended ? "ghost" : "danger"}
        className="w-full"
        disabled={setPhase.isPending}
        onClick={() => {
          const next = ended ? "open" : "ended";
          const warn = ended
            ? "Reopen the hunt? Teams can submit again."
            : "End the hunt? Nobody will be able to submit after this.";
          if (window.confirm(warn)) setPhase.mutate(next);
        }}
      >
        {setPhase.isPending
          ? "Working…"
          : ended
            ? "Reopen the hunt"
            : "End the hunt"}
      </Button>
      {setPhase.isError && (
        <div className="mt-2">
          <ErrorNote>{(setPhase.error as Error).message}</ErrorNote>
        </div>
      )}
    </Card>
  );
}

function Editor({
  challenge,
  onDone,
}: {
  challenge: Partial<Challenge>;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(challenge);
  const save = useSaveChallenge();
  const remove = useDeleteChallenge();

  const set = <K extends keyof Challenge>(key: K, value: Challenge[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const awards = draft.awards ?? [
    { place: 1, points: 50 },
    { place: 2, points: 30 },
    { place: 3, points: 15 },
  ];

  return (
    <div className="space-y-4">
      <Field label="Title">
        <Input value={draft.title ?? ""} onChange={(e) => set("title", e.target.value)} />
      </Field>

      <Field label="Description">
        <Input
          value={draft.description ?? ""}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>

      <Field label="Type">
        <Choice
          value={draft.type ?? "standard"}
          options={[
            ["standard", "Everyone can score"],
            ["ranked", "Judges rank teams"],
          ]}
          onChange={(v) => set("type", v as ChallengeType)}
        />
      </Field>

      {draft.type === "ranked" ? (
        <Field label="Points per place">
          <div className="flex gap-2">
            {awards.map((a, i) => (
              <Input
                key={a.place}
                type="number"
                inputMode="numeric"
                value={a.points}
                aria-label={`Place ${a.place} points`}
                onChange={(e) => {
                  const next: Award[] = awards.map((x, j) =>
                    j === i ? { ...x, points: Number(e.target.value) } : x,
                  );
                  set("awards", next);
                }}
              />
            ))}
          </div>
        </Field>
      ) : (
        <Field label="Points">
          <Input
            type="number"
            inputMode="numeric"
            value={draft.points ?? 0}
            onChange={(e) => set("points", Number(e.target.value))}
          />
        </Field>
      )}

      <Field label="Proof required">
        <Choice
          value={draft.proofType ?? "photo"}
          options={[
            ["none", "None (honour system)"],
            ["photo", "One photo"],
            ["photos", "Several photos"],
            ["video", "Video"],
          ]}
          onChange={(v) => set("proofType", v as ProofType)}
        />
      </Field>

      {draft.proofType === "photos" && (
        <Field label="Max photos">
          <Input
            type="number"
            inputMode="numeric"
            value={draft.maxFiles ?? DEFAULT_MAX_FILES}
            onChange={(e) => set("maxFiles", Number(e.target.value))}
          />
        </Field>
      )}

      <Field label="Number to record (optional)">
        <Input
          placeholder="e.g. Skeeball score"
          value={draft.metricLabel ?? ""}
          onChange={(e) => set("metricLabel", e.target.value)}
        />
      </Field>

      {save.isError && <ErrorNote>{(save.error as Error).message}</ErrorNote>}

      <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onDone}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={!draft.title?.trim() || save.isPending}
          onClick={() =>
            save.mutate(
              { ...draft, awards: draft.type === "ranked" ? awards : undefined },
              { onSuccess: onDone },
            )
          }
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {draft.challengeId && (
        <Button
          variant="danger"
          className="w-full"
          disabled={remove.isPending}
          onClick={() => {
            if (window.confirm(`Delete "${draft.title}"? Submissions stay but stop scoring.`)) {
              remove.mutate(draft.challengeId!, { onSuccess: onDone });
            }
          }}
        >
          <Trash2 className="size-5" /> Delete
        </Button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function Choice({
  value,
  options,
  onChange,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-12 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 text-base text-zinc-100"
    >
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
