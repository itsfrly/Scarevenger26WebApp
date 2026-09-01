export const EVENT_YEAR = "2026";

export type ProofType = "none" | "photo" | "photos" | "video";
export type ChallengeType = "standard" | "ranked";
export type SubmissionStatus = "submitted" | "rejected";

export const DEFAULT_MAX_FILES = 10;

/** Enforced in the presigned POST policy, not just client-side. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_UPLOAD_PREFIXES = ["image/", "video/"] as const;

export function mediaKeyPrefix(teamId: string, challengeId: string): string {
  return `media/${teamId}/${challengeId}/`;
}

/** Points for finishing in a given place on a ranked challenge. */
export interface Award {
  place: number;
  points: number;
}

/** Judge-assigned result. More than one teamId is a tie for that place. */
export interface Placement {
  place: number;
  teamIds: string[];
}

export interface Challenge {
  challengeId: string;
  title: string;
  description: string;
  active: boolean;
  type: ChallengeType;
  proofType: ProofType;
  /** Cap for proofType "photos". Defaults to DEFAULT_MAX_FILES. */
  maxFiles?: number;
  /** standard challenges only. */
  points?: number;
  /** ranked only. A single entry is winner-takes-all. */
  awards?: Award[];
  /** ranked only, set by judges. */
  placements?: Placement[];
  /** Prompts teams for a number, e.g. "Skeeball score". */
  metricLabel?: string;
  metricDirection?: "highest" | "lowest";
}

export interface SubmissionFile {
  /** S3 object key, always media/<teamId>/<challengeId>/<uuid>.<ext> */
  key: string;
  contentType: string;
  size?: number;
}

export interface Submission {
  teamId: string;
  challengeId: string;
  files: SubmissionFile[];
  metricValue?: number;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
}

export type EventPhase = "open" | "ended";

export interface EventState {
  phase: EventPhase;
  endedAt?: string;
}

/** One slide: a single file, with the context needed to caption it. */
export interface Slide {
  key: string;
  contentType: string;
  teamId: string;
  teamName: string;
  challengeId: string;
  challengeTitle: string;
  submittedAt: string;
}

export interface User {
  sub: string;
  email: string;
  displayName: string;
  eventVerified: boolean;
  teamId?: string;
  createdAt: string;
}

export interface Team {
  teamId: string;
  name: string;
  /** Shared by the team; required to join. Rotatable by an admin. */
  joinCode: string;
  createdBy: string;
  /** Recomputed from submissions and placements; never incremented in place. */
  score: number;
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  sub: string;
  displayName: string;
  joinedAt: string;
}

/**
 * Single source of truth for scoring.
 *
 * Deliberately a pure recompute rather than incremental deltas: rejections and
 * placement changes move several teams at once, and a missed decrement is
 * silent and permanent. Recomputing is idempotent, so a lost update self-heals
 * on the next scoring event.
 *
 * Ties take full points for their place; the judge skips the next place by
 * simply not assigning it.
 */
export function teamScore(
  teamId: string,
  submissions: Submission[],
  challenges: Challenge[],
): number {
  const byId = new Map(challenges.map((c) => [c.challengeId, c]));
  let total = 0;

  for (const s of submissions) {
    if (s.status === "rejected") continue;
    const c = byId.get(s.challengeId);
    if (c?.active && c.type === "standard") total += c.points ?? 0;
  }

  for (const c of challenges) {
    if (!c.active || c.type !== "ranked") continue;
    for (const p of c.placements ?? []) {
      if (!p.teamIds.includes(teamId)) continue;
      total += c.awards?.find((a) => a.place === p.place)?.points ?? 0;
    }
  }

  return total;
}

/**
 * Deterministic shuffle from a seed.
 *
 * Seeded rather than Math.random so every viewer sees the same order — people
 * watching together on different phones should be looking at the same slide,
 * and it makes "go back, I missed one" possible.
 */
export function shuffleSeeded<T>(items: T[], seed: string): T[] {
  const out = items.slice();
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Fisher-Yates driven by a xorshift PRNG.
  for (let i = out.length - 1; i > 0; i--) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function fileCountValid(challenge: Challenge, count: number): boolean {
  switch (challenge.proofType) {
    case "none":
      return count === 0;
    case "photo":
    case "video":
      return count === 1;
    case "photos":
      return count >= 1 && count <= (challenge.maxFiles ?? DEFAULT_MAX_FILES);
  }
}

/**
 * Primary keys only. DynamoDB rejects a Key containing anything beyond the
 * table's pk/sk, so index attributes live in `indexKeys` and are spread into
 * the Item at write time, never into a Key.
 */
export const keys = {
  user: (sub: string) => ({ pk: `USER#${sub}`, sk: "PROFILE" }),
  team: (teamId: string) => ({ pk: `TEAM#${teamId}`, sk: "METADATA" }),
  member: (teamId: string, sub: string) => ({
    pk: `TEAM#${teamId}`,
    sk: `MEMBER#${sub}`,
  }),
  submission: (teamId: string, challengeId: string) => ({
    pk: `TEAM#${teamId}`,
    sk: `SUB#${challengeId}`,
  }),
  eventState: () => ({ pk: `EVENT#${EVENT_YEAR}`, sk: "STATE" }),
  challenge: (challengeId: string) => ({
    pk: `EVENT#${EVENT_YEAR}`,
    sk: `CHALLENGE#${challengeId}`,
  }),
  /**
   * Lookup item pointing a join code at its team. A separate item rather than
   * a GSI: it doubles as a uniqueness constraint, since a conditional put on
   * the same key fails if the code is already taken.
   */
  joinCode: (code: string) => ({
    pk: `JOINCODE#${normalizeJoinCode(code)}`,
    sk: "TEAM",
  }),
} as const;

/** Codes are case-insensitive and ignore spaces, because people retype them. */
export function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Ambiguous characters removed: no O/0, I/1/L, U/V. A code read aloud across
 * a dark garden should not depend on hearing the difference.
 */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTWXYZ23456789";

export function generateJoinCode(random: (max: number) => number): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  return out;
}

/** Spread into the Item alongside `keys`, never into a Key. */
export const indexKeys = {
  team: (teamId: string) => ({
    gsi1pk: `EVENT#${EVENT_YEAR}`,
    gsi1sk: `TEAM#${teamId}`,
  }),
} as const;

export const prefixes = {
  member: "MEMBER#",
  submission: "SUB#",
  challenge: "CHALLENGE#",
  team: "TEAM#",
  event: `EVENT#${EVENT_YEAR}`,
} as const;
