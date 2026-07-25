import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectDefinition, RepoId, RepositorySnapshot, RuntimeRepository } from "../api/types";
import { RepositorySidebar, type RepositoryView } from "./RepositorySidebar";

const project: ProjectDefinition = {
  schema_version: 1,
  project_id: "project",
  name: "Workspace",
  layout: "tabs",
  repositories: [],
};

const snapshot = {
  repo_id: "loaded-repo" as RepoId,
  generation: 1,
  head: { kind: "branch", full_ref: "refs/heads/main", commit_oid: "1111111" },
  status: { entries: [{ file_id: "changed" }] },
} as RepositorySnapshot;

const runtime = (projectRepoId: string, values: Partial<RuntimeRepository> = {}): RuntimeRepository => ({
  projectRepoId,
  repoId: null,
  generation: 0,
  opening: false,
  error: null,
  ...values,
});

const repositories: RepositoryView[] = [
  { definition: { project_repo_id: "loaded", display_name: "Loaded", path: "C:/loaded", display_order: 0, default_comparison: null }, runtime: runtime("loaded", { repoId: snapshot.repo_id, generation: 1 }), snapshot },
  { definition: { project_repo_id: "opening", display_name: "Opening", path: "C:/opening", display_order: 1, default_comparison: null }, runtime: runtime("opening", { opening: true }), snapshot: null },
  { definition: { project_repo_id: "closed", display_name: "Closed", path: "C:/closed", display_order: 2, default_comparison: null }, runtime: runtime("closed"), snapshot: null },
  { definition: { project_repo_id: "failed", display_name: "Failed", path: "C:/failed", display_order: 3, default_comparison: null }, runtime: runtime("failed", { error: { code: "IO", message: "Access denied", retryable: true, repo_id: null, operation_id: null } }), snapshot: null },
  { definition: { project_repo_id: "missing", display_name: "Missing", path: "C:/missing", display_order: 4, default_comparison: null }, runtime: undefined, snapshot: null },
];
project.repositories = repositories.map((item) => item.definition);

const defaultProps = {
  projects: [project],
  activeProject: project,
  activeProjectRepoId: "loaded",
  repositories,
  collapsed: false,
  onProject: vi.fn(),
  onCreateProject: vi.fn(),
  onRenameProject: vi.fn(),
  onDeleteProject: vi.fn(),
  onAddRepository: vi.fn(),
  onSelectRepository: vi.fn(),
  onRetryRepository: vi.fn(),
  onCloseRepository: vi.fn(),
  onRemoveRepository: vi.fn(),
  onToggleCollapsed: vi.fn(),
};

afterEach(cleanup);

describe("RepositorySidebar", () => {
  it("distinguishes loaded, opening, closed, failed, and unavailable repository states", () => {
    render(<RepositorySidebar {...defaultProps} />);

    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByTitle("1 changed files")).toHaveTextContent("1");
    expect(screen.getByText("opening…")).toBeInTheDocument();
    expect(screen.getByText("closed")).toBeInTheDocument();
    expect(screen.getByText("couldn't open")).toHaveAttribute("title", "Access denied");
    expect(screen.getByText("unavailable")).toBeInTheDocument();
    expect(screen.getByText("Ctrl O")).toBeInTheDocument();
  });

  it("dismisses repository actions outside, with Escape, and after an action", () => {
    const onRetryRepository = vi.fn();
    render(<RepositorySidebar {...defaultProps} onRetryRepository={onRetryRepository} />);
    const trigger = screen.getByRole("button", { name: "Actions for Loaded" });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: /Reopen/ }));
    expect(onRetryRepository).toHaveBeenCalledWith("loaded");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
