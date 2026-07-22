import { QueryClient } from "@tanstack/react-query";
import type { FrontendError, RepoId } from "../api/types";

export const queryKeys = {
  capabilities: ["capabilities"] as const,
  projects: ["projects"] as const,
  repository: (repoId: RepoId, generation: number) => ["repository", repoId, generation] as const,
  comparison: (repoId: RepoId, generation: number, descriptor: string) =>
    ["comparison", repoId, generation, descriptor] as const,
  file: (repoId: RepoId, generation: number, comparisonId: string, fileId: string) =>
    ["file", repoId, generation, comparisonId, fileId] as const,
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        const frontendError = error as Partial<FrontendError>;
        return frontendError.retryable === true && failureCount < 1;
      },
    },
    mutations: { retry: false },
  },
});

export function removeRepositoryQueries(repoId: RepoId): void {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey.includes(repoId),
  });
}
