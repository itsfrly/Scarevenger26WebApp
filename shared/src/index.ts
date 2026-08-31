export const EVENT_YEAR = "2026";

export type SubmissionStatus = "submitted" | "approved" | "rejected";

export interface User {
  sub: string;
  email: string;
  displayName: string;
  /** Set once the shared event code has been accepted. */
  eventVerified: boolean;
  teamId?: string;
  createdAt: string;
}

export interface Team {
  teamId: string;
  name: string;
  /** Denormalised sum of approved submissions, so the scoreboard is one query. */
  score: number;
  createdAt: string;
}

export interface TeamMember {
  teamId: string;
  sub: string;
  displayName: string;
  joinedAt: string;
}

export interface Challenge {
  challengeId: string;
  title: string;
  description: string;
  points: number;
  active: boolean;
}

export interface Submission {
  teamId: string;
  challengeId: string;
  driveFileId: string;
  driveUrl: string;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
}

// Admin is a Cognito group (`admins`), read from the cognito:groups JWT claim,
// so it is deliberately not a stored field.

export const keys = {
  user: (sub: string) => ({ pk: `USER#${sub}`, sk: "PROFILE" }),
  team: (teamId: string) => ({
    pk: `TEAM#${teamId}`,
    sk: "METADATA",
    gsi1pk: `EVENT#${EVENT_YEAR}`,
    gsi1sk: `TEAM#${teamId}`,
  }),
  member: (teamId: string, sub: string) => ({
    pk: `TEAM#${teamId}`,
    sk: `MEMBER#${sub}`,
  }),
  submission: (teamId: string, challengeId: string) => ({
    pk: `TEAM#${teamId}`,
    sk: `SUB#${challengeId}`,
  }),
  challenge: (challengeId: string) => ({
    pk: `EVENT#${EVENT_YEAR}`,
    sk: `CHALLENGE#${challengeId}`,
  }),
} as const;

export const prefixes = {
  member: "MEMBER#",
  submission: "SUB#",
  challenge: "CHALLENGE#",
  team: "TEAM#",
  event: `EVENT#${EVENT_YEAR}`,
} as const;
