import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComparisonId, FileId, RepoId, RepositorySnapshot } from "../api/types";
import {
  queryClient,
  queryKeys,
  removeOlderRepositoryGenerations,
  removeRepositoryQueries,
} from "./query-client";

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

  it("removes repository, comparison, and file data from superseded generations", () => {
    const repoId = "changing-repo" as RepoId;
    queryClient.setQueryData(queryKeys.repository(repoId, 1), { generation: 1 });
    queryClient.setQueryData(queryKeys.comparison(repoId, 1, "unstaged"), { generation: 1 });
    const comparisonId = "comparison" as ComparisonId;
    const fileId = "file" as FileId;
    queryClient.setQueryData(queryKeys.file(repoId, 1, comparisonId, fileId), { generation: 1 });
    queryClient.setQueryData(queryKeys.repository(repoId, 2), { generation: 2 });
    queryClient.setQueryData(queryKeys.repository("other-repo" as RepoId, 1), { generation: 1 });

    removeOlderRepositoryGenerations(repoId, 2);

    expect(queryClient.getQueryData(queryKeys.repository(repoId, 1))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.comparison(repoId, 1, "unstaged"))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.file(repoId, 1, comparisonId, fileId))).toBeUndefined();
    expect(queryClient.getQueryData(queryKeys.repository(repoId, 2))).toBeDefined();
    expect(queryClient.getQueryData(queryKeys.repository("other-repo" as RepoId, 1))).toBeDefined();
  });
});
