import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../api/fixtures/contracts.json";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../features/MonacoDiff", () => ({ default: () => <div>Local Monaco diff</div> }));
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 48,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, start: index * 48 })),
    scrollToIndex: () => undefined,
  }),
}));

import App from "../app/App";
import { Providers } from "../app/providers";
import { queryClient } from "../app/query-client";

describe("renderer workflow with mocked Tauri IPC", () => {
  let repositoryListener: ((event: { payload: { repo_id: string; generation: number } }) => void) | null;
  let snapshotGeneration: number;

  beforeEach(() => {
    cleanup();
    queryClient.clear();
    localStorage.clear();
    repositoryListener = null;
    snapshotGeneration = fixture.snapshot.generation;
    mocks.listen.mockImplementation(async (_event, handler) => {
      repositoryListener = handler;
      return () => undefined;
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "get_backend_capabilities": return { api_version: 1, git_version: "git version 2.50.0", supports_sha256: true, max_metadata_bytes: 10_485_760, max_file_bytes: 5_242_880 };
        case "load_projects": return [{ ...fixture.project, repositories: fixture.project.repositories.map((repository) => ({ ...repository, default_comparison: { mode: "all_uncommitted", left_full_ref: null, right_full_ref: null } })) }];
        case "open_repository": return fixture.snapshot;
        case "get_repository_snapshot": return { ...fixture.snapshot, generation: snapshotGeneration, info: { ...fixture.snapshot.info, generation: snapshotGeneration }, status: { ...fixture.snapshot.status, generation: snapshotGeneration } };
        case "create_comparison": return { ...fixture.comparison, generation: snapshotGeneration };
        case "get_file_comparison": return { ...fixture.file_comparison, generation: snapshotGeneration, right: { ...fixture.file_comparison.right, content: { kind: "binary", size: 128 } } };
        default: return null;
      }
    });
  });

  it("opens a saved repository, creates a comparison, and shows a typed file result", async () => {
    render(<Providers><App /></Providers>);
    expect(await screen.findByText("Fixture project")).toBeInTheDocument();
    expect(await screen.findByText("src/main.rs")).toBeInTheDocument();
    expect(await screen.findByText("Binary file")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("open_repository", { args: { path: "C:/fixture" } });
    expect(mocks.invoke).toHaveBeenCalledWith("create_comparison", expect.objectContaining({ args: expect.objectContaining({ repo_id: "repo-1" }) }));
  });

  it("opens the command palette and exposes keyboard-first actions", async () => {
    render(<Providers><App /></Providers>);
    await screen.findAllByText("Fixture project");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Commands" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Search commands"), "shortcut");
    expect(screen.getByText("Show keyboard shortcuts")).toBeInTheDocument();
  });

  it("cleans up its repository event listener", async () => {
    const cleanup = vi.fn();
    mocks.listen.mockResolvedValue(cleanup);
    const view = render(<Providers><App /></Providers>);
    await waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    view.unmount();
    await waitFor(() => expect(cleanup).toHaveBeenCalled());
  });

  it("synchronizes a completed watcher snapshot without starting a second refresh", async () => {
    render(<Providers><App /></Providers>);
    await screen.findByText("src/main.rs");
    await waitFor(() => expect(repositoryListener).not.toBeNull());
    mocks.invoke.mockClear();
    snapshotGeneration += 1;
    repositoryListener!({ payload: { repo_id: fixture.snapshot.repo_id, generation: snapshotGeneration } });
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("get_repository_snapshot", { args: { repo_id: fixture.snapshot.repo_id } }));
    expect(mocks.invoke).not.toHaveBeenCalledWith("refresh_repository", expect.anything());
  });
});
