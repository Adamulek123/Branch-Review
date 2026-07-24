import { AlertCircle, ArchiveX, ChevronLeft, ChevronRight, CircleDot, FolderGit2, FolderPlus, GitBranch, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { ProjectDefinition, ProjectRepositoryDefinition, RepositorySnapshot, RuntimeRepository } from "../api/types";
import { IconButton } from "../components/IconButton";
import { headLabel } from "./comparison-utils";

export interface RepositoryView {
  definition: ProjectRepositoryDefinition;
  runtime: RuntimeRepository | undefined;
  snapshot: RepositorySnapshot | null;
}

interface Props {
  projects: ProjectDefinition[];
  activeProject: ProjectDefinition | null;
  activeProjectRepoId: string | null;
  repositories: RepositoryView[];
  collapsed: boolean;
  onProject(id: string): void;
  onCreateProject(): void;
  onRenameProject(): void;
  onDeleteProject(): void;
  onAddRepository(): void;
  onSelectRepository(id: string): void;
  onRetryRepository(id: string): void;
  onCloseRepository(id: string): void;
  onRemoveRepository(id: string): void;
  onToggleCollapsed(): void;
}

function dirtyCount(snapshot: RepositorySnapshot | null): number {
  return snapshot?.status.entries.length ?? 0;
}

export function RepositorySidebar(props: Props) {
  if (props.collapsed) return (
    <aside className="repository-rail" aria-label="Repository navigation">
      <IconButton label="Expand repositories" onClick={props.onToggleCollapsed}><ChevronRight size={16} /></IconButton>
      <div className="repository-rail__items">{props.repositories.map((item) => <button key={item.definition.project_repo_id} className={item.definition.project_repo_id === props.activeProjectRepoId ? "is-active" : ""} onClick={() => props.onSelectRepository(item.definition.project_repo_id)} aria-label={item.definition.display_name} title={item.definition.display_name}><FolderGit2 size={16} /><span>{item.definition.display_name.slice(0, 1).toUpperCase()}</span>{dirtyCount(item.snapshot) > 0 && <i />}</button>)}</div>
      <IconButton label="Add repository" shortcut="Ctrl+O" onClick={props.onAddRepository}><FolderPlus size={16} /></IconButton>
    </aside>
  );

  return (
    <aside className="repository-sidebar" aria-label="Projects and repositories">
      <header className="repository-sidebar__header">
        <label><span>Project</span><select value={props.activeProject?.project_id ?? ""} onChange={(event) => props.onProject(event.target.value)} aria-label="Active project"><option value="" disabled>No project</option>{props.projects.map((project) => <option key={project.project_id} value={project.project_id}>{project.name}</option>)}</select></label>
        <IconButton label="Collapse repositories" onClick={props.onToggleCollapsed}><ChevronLeft size={16} /></IconButton>
      </header>
      <div className="project-actions">
        <button onClick={props.onCreateProject} aria-label="New project" title="New project"><Plus size={13} /> New</button>
        <button onClick={props.onRenameProject} disabled={!props.activeProject} aria-label="Rename project" title="Rename project"><Pencil size={13} /> Rename</button>
        <button onClick={props.onDeleteProject} disabled={!props.activeProject} aria-label="Delete project" title="Delete project"><Trash2 size={13} /> Delete</button>
      </div>
      <div className="sidebar-section-label"><span>Repositories</span><small>{props.repositories.length}</small></div>
      <div className="repository-list">
        {props.repositories.map(({ definition, runtime, snapshot }) => {
          const selected = definition.project_repo_id === props.activeProjectRepoId;
          const head = snapshot?.head;
          const headText = head ? headLabel(head.kind, head.kind === "branch" ? head.full_ref : head.kind === "unborn" ? head.full_ref : null, head.kind === "detached" ? head.commit_oid : undefined) : runtime?.opening ? "opening…" : "unavailable";
          return <div key={definition.project_repo_id} className={`repository-row${selected ? " is-active" : ""}${runtime?.error ? " has-error" : ""}`}>
            <button className="repository-row__main" onClick={() => props.onSelectRepository(definition.project_repo_id)}>
              <span className="repository-row__icon">{runtime?.error ? <AlertCircle size={16} /> : <FolderGit2 size={16} />}</span>
              <span><strong>{definition.display_name}</strong><small>{head ? <GitBranch size={11} /> : <CircleDot size={11} />}{headText}</small></span>
              {snapshot && dirtyCount(snapshot) > 0 && <mark title={`${dirtyCount(snapshot)} changed files`}>{dirtyCount(snapshot)}</mark>}
            </button>
            <details className="repository-menu"><summary aria-label={`Actions for ${definition.display_name}`} title="Repository actions"><MoreHorizontal size={15} /></summary><div><button onClick={() => props.onRetryRepository(definition.project_repo_id)}><RotateCcw size={13} /> Reopen</button><button onClick={() => props.onCloseRepository(definition.project_repo_id)} disabled={!runtime?.repoId}><X size={13} /> Close for now</button><button className="danger" onClick={() => props.onRemoveRepository(definition.project_repo_id)}><ArchiveX size={13} /> Remove from project</button></div></details>
          </div>;
        })}
      </div>
      <button className="add-repository" onClick={props.onAddRepository}><FolderPlus size={15} /><span>Add repository</span><kbd>⌘O</kbd></button>
      <footer><span><CircleDot size={11} /> Local only</span><span>Git is never modified</span></footer>
    </aside>
  );
}
