import { describe, expect, it, vi } from "vitest";
import { loadFileWithComparisonRecovery } from "./comparison-lifecycle";
import type { BackendClient } from "./backend";
import contracts from "./fixtures/contracts.json";
import type { ChangedFile, ComparisonRequest, ComparisonResult, FileComparison, RepoId } from "./types";

const invalid = { code: "INVALID_COMPARISON_ID", message: "Comparison expired", retryable: false, repo_id: "repo-1", operation_id: null };

function client(getFileComparison: BackendClient["getFileComparison"], createComparison: BackendClient["createComparison"]): BackendClient {
  return {
    getFileComparison,
    createComparison,
    getCapabilities: vi.fn(), openRepository: vi.fn(), closeRepository: vi.fn(), listOpenRepositories: vi.fn(),
    refreshRepository: vi.fn(), getRepositorySnapshot: vi.fn(), pickRepositoryDirectory: vi.fn(), loadProjects: vi.fn(),
    saveProject: vi.fn(), deleteProject: vi.fn(),
  };
}

describe("comparison lifecycle recovery", () => {
  it("recreates an expired comparison once and resolves the file by path", async () => {
    const result = contracts.comparison as unknown as ComparisonResult;
    const file = result.files[0] as ChangedFile;
    const getFile = vi.fn().mockRejectedValueOnce(invalid).mockResolvedValueOnce(contracts.file_comparison as unknown as FileComparison);
    const create = vi.fn().mockResolvedValue(result);

    await expect(loadFileWithComparisonRecovery({ client: client(getFile, create), repoId: result.repo_id, request: contracts.comparison_requests[4] as ComparisonRequest, comparison: result, file, accept: (value) => value, onRenewed: vi.fn() })).resolves.toMatchObject({ file_id: file.file_id });
    expect(create).toHaveBeenCalledTimes(1);
    expect(getFile).toHaveBeenCalledTimes(2);
  });

  it("stops after the recovered comparison expires again", async () => {
    const result = contracts.comparison as unknown as ComparisonResult;
    const getFile = vi.fn().mockRejectedValue(invalid);
    const create = vi.fn().mockResolvedValue(result);

    await expect(loadFileWithComparisonRecovery({ client: client(getFile, create), repoId: "repo-1" as RepoId, request: contracts.comparison_requests[4] as ComparisonRequest, comparison: result, file: result.files[0], accept: (value) => value, onRenewed: vi.fn() })).rejects.toMatchObject({ code: "INVALID_COMPARISON_ID" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(getFile).toHaveBeenCalledTimes(2);
  });
});
