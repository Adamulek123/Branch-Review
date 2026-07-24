import { describe, expect, it } from "vitest";
import { createComparisonRequest, filterFiles, findUpstreamComparison, formatBytes } from "./comparison-utils";
import type { ChangedFile, GitReference, RefId } from "../api/types";

const references = [
  { id: "left" as RefId, full_name: "refs/heads/main", display_name: "main", kind: "local_branch", commit_oid: "1", upstream_full_name: null, is_head: true, checked_out_worktree: null },
  { id: "right" as RefId, full_name: "refs/heads/feature", display_name: "feature", kind: "local_branch", commit_oid: "2", upstream_full_name: null, is_head: false, checked_out_worktree: null },
] satisfies GitReference[];

describe("comparison utilities", () => {
  it("requires current opaque reference IDs for branch comparisons", () => {
    expect(createComparisonRequest("direct", references, "refs/heads/main", "refs/heads/feature")).toEqual({ mode: "direct", left: "left", right: "right" });
    expect(createComparisonRequest("direct", references, "refs/heads/missing", "refs/heads/feature")).toBeNull();
    expect(createComparisonRequest("staged", [], null, null)).toEqual({ mode: "staged" });
  });
  it("filters paths and semantic status groups", () => {
    const files = [{ file_id: "1", display_path: "src/main.rs", old_display_path: null, status: "modified", staged: false, unstaged: true, conflicted: false, submodule: false, similarity: null }] as ChangedFile[];
    expect(filterFiles(files, "MAIN", [])).toHaveLength(1);
    expect(filterFiles(files, "", ["added"])).toHaveLength(0);
  });
  it("formats bounded content sizes", () => expect(formatBytes(5242880)).toBe("5.0 MB"));
  it("resolves only the checked-out branch's cached upstream", () => {
    const withUpstream = [
      { ...references[0], upstream_full_name: "refs/remotes/origin/main" },
      { id: "origin-main" as RefId, full_name: "refs/remotes/origin/main", display_name: "origin/main", kind: "remote_branch", commit_oid: "0", upstream_full_name: null, is_head: false, checked_out_worktree: null },
      references[1],
    ] satisfies GitReference[];

    expect(findUpstreamComparison(withUpstream)).toEqual({ local: withUpstream[0], upstream: withUpstream[1] });
    expect(findUpstreamComparison(references)).toBeNull();
    expect(findUpstreamComparison([{ ...withUpstream[0], upstream_full_name: "refs/remotes/origin/missing" }])).toBeNull();
  });
});
