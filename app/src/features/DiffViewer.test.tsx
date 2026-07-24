import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";
import type { ChangedFile, FileComparison, FileContent, FileId, ComparisonId, RepoId } from "../api/types";

vi.mock("./MonacoDiff", () => ({ default: ({ modified }: { modified: string }) => <div data-testid="monaco-diff">{modified}</div> }));

const contentCases: Array<[FileContent, string]> = [
  [{ kind: "binary", size: 42 }, "Binary file"],
  [{ kind: "too_large", size: 8_000_000, limit: 5_242_880 }, "File exceeds the display limit"],
  [{ kind: "missing" }, "No file on this side"],
  [{ kind: "symlink", target: "../target" }, "Symbolic link"],
  [{ kind: "submodule", commit_oid: "abcdef" }, "Submodule pointer"],
  [{ kind: "unsupported_encoding", size: 18 }, "Unsupported text encoding"],
];

function comparison(content: FileContent): FileComparison {
  return {
    repo_id: "repo" as RepoId,
    comparison_id: "comparison" as ComparisonId,
    file_id: "file" as FileId,
    generation: 1,
    left: { label: "Left", source: { kind: "empty" }, content },
    right: { label: "Right", source: { kind: "worktree" }, content },
  };
}

const file: ChangedFile = {
  file_id: "file" as FileId,
  display_path: "asset.bin",
  old_display_path: null,
  status: "modified",
  staged: false,
  unstaged: true,
  conflicted: false,
  submodule: false,
  similarity: null,
};

const viewProps = {
  view: "split" as const,
  loading: false,
  wrapLines: false,
  ignoreTrimWhitespace: false,
  collapseUnchanged: true,
  filePaneCollapsed: false,
  hasPrevious: false,
  hasNext: false,
  onView: vi.fn(),
  onWrapLines: vi.fn(),
  onIgnoreTrimWhitespace: vi.fn(),
  onCollapseUnchanged: vi.fn(),
  onToggleFilePane: vi.fn(),
  onPreviousFile: vi.fn(),
  onNextFile: vi.fn(),
};

describe("DiffViewer", () => {
  it.each(contentCases)("renders a deliberate %s presentation", (content, heading) => {
    render(<DiffViewer {...viewProps} comparison={comparison(content)} file={file} />);
    expect(screen.getAllByText(heading)).toHaveLength(2);
  });
  it("renders the no-selection state", () => {
    render(<DiffViewer {...viewProps} comparison={null} file={null} />);
    expect(screen.getByText("Choose a file to review")).toBeInTheDocument();
  });
  it("renders the newly selected text file after repeated editor replacement", async () => {
    const first = { ...comparison({ kind: "text", text: "old", encoding: "utf-8", size: 3 }), file_id: "first" as FileId };
    const second = { ...comparison({ kind: "text", text: "new", encoding: "utf-8", size: 3 }), file_id: "second" as FileId };
    const view = render(<DiffViewer {...viewProps} comparison={first} file={{ ...file, file_id: first.file_id, display_path: "first.ts" }} />);
    expect(await screen.findByTestId("monaco-diff")).toHaveTextContent("old");
    view.rerender(<DiffViewer {...viewProps} comparison={second} file={{ ...file, file_id: second.file_id, display_path: "second.ts" }} />);
    expect(await screen.findByTestId("monaco-diff")).toHaveTextContent("new");
  });
});
