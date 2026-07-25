import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitReference, RefId, RepoId, RepositorySnapshot } from "../api/types";
import { ComparisonToolbar } from "./ComparisonToolbar";

const references = [
  { id: "main" as RefId, full_name: "refs/heads/main", display_name: "main", kind: "local_branch", commit_oid: "1111111", upstream_full_name: "refs/remotes/origin/main", is_head: true, checked_out_worktree: null },
  { id: "feature" as RefId, full_name: "refs/heads/feature", display_name: "feature", kind: "local_branch", commit_oid: "2222222", upstream_full_name: null, is_head: false, checked_out_worktree: null },
  { id: "origin-main" as RefId, full_name: "refs/remotes/origin/main", display_name: "origin/main", kind: "remote_branch", commit_oid: "0000000", upstream_full_name: null, is_head: false, checked_out_worktree: null },
] satisfies GitReference[];

const snapshot = {
  repo_id: "repo" as RepoId,
  generation: 1,
  info: {
    id: "repo" as RepoId,
    display_name: "branch-review",
    worktree_root: "C:/repo",
    git_dir: "C:/repo/.git",
    git_common_dir: "C:/repo/.git",
    is_shallow: false,
    object_format: "sha1",
    head: { kind: "branch", full_ref: "refs/heads/main", commit_oid: "1111111" },
    generation: 1,
  },
  head: { kind: "branch", full_ref: "refs/heads/main", commit_oid: "1111111" },
  references,
  status: { generation: 1, branch_oid: "1111111", branch_head: "main", entries: [] },
} satisfies RepositorySnapshot;

afterEach(cleanup);

describe("ComparisonToolbar", () => {
  it("offers the cached upstream preset and swaps branch sides", () => {
    const onReferences = vi.fn();
    const onCompareUpstream = vi.fn();
    render(
      <ComparisonToolbar
        snapshot={snapshot}
        mode="direct"
        leftFullRef="refs/heads/main"
        rightFullRef="refs/heads/feature"
        refreshing={false}
        onMode={vi.fn()}
        onReferences={onReferences}
        onCompareUpstream={onCompareUpstream}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Compare with upstream" }));
    expect(onCompareUpstream).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Swap base and compare branches" }));
    expect(onReferences).toHaveBeenCalledWith("refs/heads/feature", "refs/heads/main");
  });

  it("groups and searches local and cached remote-tracking branches", () => {
    render(
      <ComparisonToolbar
        snapshot={snapshot}
        mode="direct"
        leftFullRef="refs/heads/main"
        rightFullRef="refs/heads/feature"
        refreshing={false}
        onMode={vi.fn()}
        onReferences={vi.fn()}
        onCompareUpstream={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Base: main" }));
    const listbox = screen.getByRole("listbox", { name: "Base branch" });
    expect(within(listbox).getByText("Local branches")).toBeInTheDocument();
    expect(within(listbox).getByText("Remote-tracking · cached")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search base branches" }), { target: { value: "origin" } });
    expect(within(listbox).queryByText("feature")).not.toBeInTheDocument();
    expect(within(listbox).getByText("origin/main")).toBeInTheDocument();
  });

  it("shows commit hashes in branch controls without a floating revision overlay", () => {
    render(
      <ComparisonToolbar
        snapshot={snapshot}
        mode="direct"
        leftFullRef="refs/heads/main"
        rightFullRef="refs/heads/feature"
        refreshing={false}
        onMode={vi.fn()}
        onReferences={vi.fn()}
        onCompareUpstream={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Base: main" })).toHaveTextContent("1111111");
    expect(screen.getByRole("button", { name: "Compare: feature" })).toHaveTextContent("2222222");
    expect(document.querySelector(".resolved-revisions")).not.toBeInTheDocument();
  });

  it("dismisses branch and review menus from outside or Escape and restores trigger focus", () => {
    render(
      <ComparisonToolbar
        snapshot={snapshot}
        mode="direct"
        leftFullRef="refs/heads/main"
        rightFullRef="refs/heads/feature"
        refreshing={false}
        onMode={vi.fn()}
        onReferences={vi.fn()}
        onCompareUpstream={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    const baseTrigger = screen.getByRole("button", { name: "Base: main" });
    fireEvent.click(baseTrigger);
    expect(screen.getByRole("listbox", { name: "Base branch" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox", { name: "Base branch" })).not.toBeInTheDocument();

    const reviewTrigger = screen.getByRole("button", { name: /Branch tips/ });
    fireEvent.click(reviewTrigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(reviewTrigger).toHaveFocus();
  });
});
