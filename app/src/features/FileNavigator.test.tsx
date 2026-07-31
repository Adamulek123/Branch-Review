import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangedFile, FileId } from "../api/types";
import { FileNavigator } from "./FileNavigator";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 48,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 48 })),
    scrollToIndex: vi.fn(),
  }),
}));

const files = [
  { file_id: "file-a" as FileId, display_path: "src/a.ts", old_display_path: null, status: "modified", similarity: null, staged: false, unstaged: true, conflicted: false, submodule: false },
  { file_id: "file-b" as FileId, display_path: "src/b.ts", old_display_path: null, status: "added", similarity: null, staged: false, unstaged: true, conflicted: false, submodule: false },
] satisfies ChangedFile[];

afterEach(cleanup);

describe("FileNavigator keyboard behavior", () => {
  it("shows the aggregate added and removed line counts next to Changes", () => {
    render(<FileNavigator files={files} linesAdded={42} linesDeleted={17} search="" statusFilters={[]} activeFileId={files[0].file_id} loading={false} view="list" collapsedFolders={[]} onSearch={vi.fn()} onToggleStatus={vi.fn()} onView={vi.fn()} onToggleFolder={vi.fn()} onSelect={vi.fn()} />);

    expect(screen.getByLabelText("42 lines added, 17 lines removed")).toHaveTextContent("+42−17");
  });

  it("moves with arrows or J/K and opens the active item with Enter", () => {
    const onSelect = vi.fn();
    render(<FileNavigator files={files} linesAdded={42} linesDeleted={17} search="" statusFilters={[]} activeFileId={files[0].file_id} loading={false} view="list" collapsedFolders={[]} onSearch={vi.fn()} onToggleStatus={vi.fn()} onView={vi.fn()} onToggleFolder={vi.fn()} onSelect={onSelect} />);
    const list = screen.getByLabelText("Changed file list");

    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "j" });
    fireEvent.keyDown(list, { key: "k" });
    fireEvent.keyDown(list, { key: "Enter" });

    expect(onSelect).toHaveBeenNthCalledWith(1, files[1].file_id);
    expect(onSelect).toHaveBeenNthCalledWith(2, files[1].file_id);
    expect(onSelect).toHaveBeenNthCalledWith(3, files[0].file_id);
    expect(onSelect).toHaveBeenNthCalledWith(4, files[0].file_id);
  });

  it("dismisses the status filter outside and with Escape", () => {
    render(<FileNavigator files={files} linesAdded={42} linesDeleted={17} search="" statusFilters={[]} activeFileId={files[0].file_id} loading={false} view="list" collapsedFolders={[]} onSearch={vi.fn()} onToggleStatus={vi.fn()} onView={vi.fn()} onToggleFolder={vi.fn()} onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "Filter by status" });

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
