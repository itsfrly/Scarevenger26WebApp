import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Challenge,
  Placement,
  Submission,
  SubmissionFile,
  Team,
  TeamMember,
  User,
} from "shared";
import { api } from "./api";

export interface TeamDashboard {
  team: Team;
  members: TeamMember[];
  submissions: Submission[];
}

export const useMe = (): UseQueryResult<User> =>
  useQuery({ queryKey: ["me"], queryFn: () => api.get<User>("/me") });

export const useChallenges = (): UseQueryResult<Challenge[]> =>
  useQuery({
    queryKey: ["challenges"],
    queryFn: () => api.get<Challenge[]>("/challenges"),
    staleTime: 5 * 60_000,
  });

export const useTeams = (): UseQueryResult<Team[]> =>
  useQuery({ queryKey: ["teams"], queryFn: () => api.get<Team[]>("/teams") });

/** Polls: the board should visibly move as other teams submit. */
export const useScoreboard = (): UseQueryResult<Team[]> =>
  useQuery({
    queryKey: ["scoreboard"],
    queryFn: () => api.get<Team[]>("/scoreboard"),
    refetchInterval: 30_000,
  });

export const useTeam = (teamId?: string): UseQueryResult<TeamDashboard> =>
  useQuery({
    queryKey: ["team", teamId],
    queryFn: () => api.get<TeamDashboard>(`/teams/${teamId}`),
    enabled: Boolean(teamId),
  });

function useInvalidating<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
  keys: string[],
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
}

export const useVerifyEventCode = () =>
  useInvalidating((code: string) => api.post<User>("/event-code", { code }), ["me"]);

export const useCreateTeam = () =>
  useInvalidating((name: string) => api.post<Team>("/teams", { name }), [
    "me",
    "teams",
  ]);

export const useJoinTeam = () =>
  useInvalidating(
    (teamId: string) => api.post(`/teams/${teamId}/members`, {}),
    ["me", "teams", "team"],
  );

export const useSubmit = () =>
  useInvalidating(
    (input: {
      challengeId: string;
      files: SubmissionFile[];
      metricValue?: number;
    }) => api.post<Submission>("/submissions", input),
    ["team", "scoreboard"],
  );

export const useReviewQueue = (enabled: boolean): UseQueryResult<Submission[]> =>
  useQuery({
    queryKey: ["judge", "submissions"],
    queryFn: () => api.get<Submission[]>("/judge/submissions"),
    enabled,
    refetchInterval: 30_000,
  });

export const useReview = () =>
  useInvalidating(
    (input: {
      teamId: string;
      challengeId: string;
      status: "submitted" | "rejected";
      note?: string;
    }) =>
      api.post(`/judge/submissions/${input.teamId}/${input.challengeId}`, {
        status: input.status,
        note: input.note,
      }),
    ["judge", "scoreboard", "team"],
  );

export const useSetPlacements = () =>
  useInvalidating(
    (input: { challengeId: string; placements: Placement[] }) =>
      api.put(`/judge/challenges/${input.challengeId}/placements`, {
        placements: input.placements,
      }),
    ["challenges", "scoreboard", "judge"],
  );

export const useSaveChallenge = () =>
  useInvalidating(
    (challenge: Partial<Challenge>) =>
      api.put<Challenge>("/admin/challenges", challenge),
    ["challenges"],
  );

export const useDeleteChallenge = () =>
  useInvalidating(
    (challengeId: string) => api.del(`/admin/challenges/${challengeId}`),
    ["challenges"],
  );
