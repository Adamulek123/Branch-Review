import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiffViewer } from "./DiffViewer";
import type { FileComparison, FileContent, FileId, ComparisonId, RepoId } from "../api/types";

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

describe("DiffViewer", () => {
  it.each(contentCases)("renders a deliberate %s presentation", (content, heading) => {
    render(<DiffViewer comparison={comparison(content)} path="asset.bin" view="split" loading={false} />);
    expect(screen.getAllByText(heading)).toHaveLength(2);
  });
  it("renders the no-selection state", () => {
    render(<DiffViewer comparison={null} path={null} view="split" loading={false} />);
    expect(screen.getByText("Select a changed file")).toBeInTheDocument();
  });
  it("renders the newly selected text file after repeated editor replacement", async () => {
    const first = { ...comparison({ kind: "text", text: "old", encoding: "utf-8", size: 3 }), file_id: "first" as FileId };
    const second = { ...comparison({ kind: "text", text: "new", encoding: "utf-8", size: 3 }), file_id: "second" as FileId };
    const view = render(<DiffViewer comparison={first} path="first.ts" view="split" loading={false} />);
    expect(await screen.findByTestId("monaco-diff")).toHaveTextContent("old");
    view.rerender(<DiffViewer comparison={second} path="second.ts" view="split" loading={false} />);
    expect(await screen.findByTestId("monaco-diff")).toHaveTextContent("new");
  });
});
