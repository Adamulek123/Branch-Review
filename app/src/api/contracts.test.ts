import { describe, expect, it } from "vitest";
import fixture from "./fixtures/contracts.json";
import type { ComparisonRequest, ComparisonResult, FileComparison, FileContent, FileSourceSummary, FrontendError, HeadState, ProjectDefinition, RepositorySnapshot } from "./types";

interface ContractFixture {
  comparison_requests: ComparisonRequest[];
  file_contents: FileContent[];
  file_sources: FileSourceSummary[];
  head_states: HeadState[];
  snapshot: RepositorySnapshot;
  comparison: ComparisonResult;
  file_comparison: FileComparison;
  project: ProjectDefinition;
  error: FrontendError;
}

const contract = fixture as unknown as ContractFixture;

describe("Rust transport fixture", () => {
  it("covers every request, content, source, and HEAD discriminant", () => {
    expect(contract.comparison_requests.map((item) => item.mode)).toEqual(["direct", "since_merge_base", "unstaged", "staged", "all_uncommitted"]);
    expect(contract.file_contents.map((item) => item.kind)).toEqual(["text", "binary", "too_large", "missing", "symlink", "submodule", "unsupported_encoding"]);
    expect(contract.file_sources.map((item) => item.kind)).toEqual(["commit", "index", "worktree", "empty", "conflict_stage", "submodule"]);
    expect(contract.head_states.map((item) => item.kind)).toEqual(["branch", "detached", "unborn"]);
  });

  it("keeps snake-case DTOs and nullable values stable", () => {
    expect(contract.snapshot.repo_id).toBe("repo-1");
    expect(contract.comparison.resolved_left).toBeNull();
    expect(contract.file_comparison.right.source.kind).toBe("worktree");
    expect(contract.project.repositories[0].default_comparison?.right_full_ref).toBeNull();
    expect(contract.error.operation_id).toBeNull();
  });
});
