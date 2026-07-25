import { afterEach, describe, expect, it, vi } from "vitest";
import type { RepoId, RepositorySnapshot } from "../api/types";
import { queryClient, queryKeys, removeRepositoryQueries } from "./query-client";

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

describe("repository query retention", () => {
  it("retains an inactive repository snapshot until the repository is explicitly closed", () => {
    vi.useFakeTimers();
    const repoId = "background-repo" as RepoId;
    const snapshot = { repo_id: repoId, generation: 1 } as RepositorySnapshot;
    const key = queryKeys.repository(repoId, 1);

    queryClient.setQueryData(key, snapshot);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(queryClient.getQueryData(key)).toBe(snapshot);

    removeRepositoryQueries(repoId);
    expect(queryClient.getQueryData(key)).toBeUndefined();
  });
});
