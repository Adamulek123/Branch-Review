import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  FileSearch,
  Files,
  Filter,
  Folder,
  FolderOpen,
  Check,
  List,
  Search,
  X,
} from "lucide-react";
import type { ChangedFile, FileId } from "../api/types";
import type { FileView } from "../state/ui-state";
import { IconButton } from "../components/IconButton";
import { EmptyState } from "../components/EmptyState";
import { useDismissibleLayer } from "../components/useDismissibleLayer";
import { filterFiles, statusMeta } from "./comparison-utils";
import { FileStatusIcon } from "./FileStatusIcon";

interface Props {
  files: ChangedFile[];
  linesAdded: number;
  linesDeleted: number;
  search: string;
  statusFilters: string[];
  activeFileId: FileId | null;
  loading: boolean;
  view: FileView;
  collapsedFolders: string[];
  onSearch(value: string): void;
  onToggleStatus(status: string): void;
  onView(view: FileView): void;
  onToggleFolder(path: string): void;
  onSelect(fileId: FileId): void;
}

const filters = [
  { id: "added", label: "Added", status: "added" },
  { id: "modified", label: "Modified", status: "modified" },
  { id: "deleted", label: "Deleted", status: "deleted" },
  { id: "renamed", label: "Renamed", status: "renamed" },
  { id: "conflicted", label: "Conflicts", status: "unmerged" },
] satisfies Array<{ id: string; label: string; status: ChangedFile["status"] }>;

interface FolderNode {
  name: string;
  path: string;
  folders: Map<string, FolderNode>;
  files: ChangedFile[];
}

type NavigatorRow =
  | { kind: "folder"; node: FolderNode; depth: number }
  | { kind: "file"; file: ChangedFile; depth: number; name: string; directory: string };

function buildTree(files: ChangedFile[]): FolderNode {
  const root: FolderNode = { name: "", path: "", folders: new Map(), files: [] };
  for (const file of files) {
    const parts = file.display_path.split(/[\\/]/);
    const name = parts.pop() ?? file.display_path;
    let node = root;
    for (const part of parts) {
      const path = node.path ? `${node.path}/${part}` : part;
      const child = node.folders.get(part) ?? { name: part, path, folders: new Map(), files: [] };
      node.folders.set(part, child);
      node = child;
    }
    node.files.push({ ...file, display_path: file.display_path || name });
  }
  return root;
}

function flattenTree(root: FolderNode, collapsed: Set<string>, searching: boolean): NavigatorRow[] {
  const rows: NavigatorRow[] = [];
  const visit = (node: FolderNode, depth: number) => {
    const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const folder of folders) {
      rows.push({ kind: "folder", node: folder, depth });
      if (searching || !collapsed.has(folder.path)) visit(folder, depth + 1);
    }
    for (const file of [...node.files].sort((a, b) => a.display_path.localeCompare(b.display_path))) {
      const parts = file.display_path.split(/[\\/]/);
      rows.push({ kind: "file", file, depth, name: parts.pop() ?? file.display_path, directory: parts.join("/") });
    }
  };
  visit(root, 0);
  return rows;
}

export function FileNavigator(props: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const visibleFiles = useMemo(() => filterFiles(props.files, props.search, props.statusFilters), [props.files, props.search, props.statusFilters]);
  const rows = useMemo<NavigatorRow[]>(() => {
    if (props.view === "list") {
      return visibleFiles.map((file) => {
        const parts = file.display_path.split(/[\\/]/);
        return { kind: "file", file, depth: 0, name: parts.pop() ?? file.display_path, directory: parts.join("/") };
      });
    }
    return flattenTree(buildTree(visibleFiles), new Set(props.collapsedFolders), Boolean(props.search.trim()));
  }, [props.collapsedFolders, props.search, props.view, visibleFiles]);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 36, overscan: 12 });
  const counts = useMemo(() => filters.reduce<Record<string, number>>((value, filter) => {
    value[filter.id] = props.files.filter((file) => statusMeta[file.status].group === filter.id).length;
    return value;
  }, {}), [props.files]);

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("branch-review:focus-filter", focus);
    return () => window.removeEventListener("branch-review:focus-filter", focus);
  }, []);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  useDismissibleLayer({ open: filtersOpen, rootRef: filterMenuRef, triggerRef: filterTriggerRef, onDismiss: closeFilters });

  const navigate = (delta: number) => {
    if (!visibleFiles.length) return;
    const current = visibleFiles.findIndex((file) => file.file_id === props.activeFileId);
    const index = Math.max(0, Math.min(visibleFiles.length - 1, (current < 0 ? 0 : current) + delta));
    props.onSelect(visibleFiles[index].file_id);
    const rowIndex = rows.findIndex((row) => row.kind === "file" && row.file.file_id === visibleFiles[index].file_id);
    if (rowIndex >= 0) virtualizer.scrollToIndex(rowIndex, { align: "auto" });
  };

  return (
    <aside className="file-navigator" aria-label="Changed files" onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") { event.preventDefault(); navigate(1); }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") { event.preventDefault(); navigate(-1); }
      if (event.key === "Enter" && props.activeFileId) { event.preventDefault(); props.onSelect(props.activeFileId); }
    }}>
      <header className="file-navigator__header">
        <div>
          <div className="file-navigator__title">
            <strong>Changes</strong>
            <span className="change-line-totals" aria-label={`${props.linesAdded} lines added, ${props.linesDeleted} lines removed`}>
              <b>+{props.linesAdded}</b>
              <i>−{props.linesDeleted}</i>
            </span>
          </div>
          <span>{visibleFiles.length === props.files.length ? `${props.files.length} files` : `${visibleFiles.length} of ${props.files.length}`}</span>
        </div>
        <div className="file-view-switcher" aria-label="File presentation">
          <button type="button" className={props.view === "tree" ? "is-active" : ""} onClick={() => props.onView("tree")} aria-label="Folder tree" aria-pressed={props.view === "tree"}><Files size={14} /></button>
          <button type="button" className={props.view === "list" ? "is-active" : ""} onClick={() => props.onView("list")} aria-label="Flat list" aria-pressed={props.view === "list"}><List size={14} /></button>
        </div>
      </header>

      <div className="file-tools">
        <label className="file-search">
          <Search size={14} />
          <input ref={searchRef} value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Find changed files" aria-label="Filter changed files" />
          {props.search && <IconButton label="Clear filter" onClick={() => props.onSearch("")}><X size={13} /></IconButton>}
          <kbd>Ctrl F</kbd>
        </label>
        <div className="filter-menu" ref={filterMenuRef}>
          <button ref={filterTriggerRef} type="button" className={props.statusFilters.length ? "filter-trigger is-active" : "filter-trigger"} onClick={() => setFiltersOpen((open) => !open)} aria-label="Filter by status" aria-expanded={filtersOpen} aria-haspopup="menu">
            <Filter size={14} />
            {props.statusFilters.length > 0 && <span>{props.statusFilters.length}</span>}
          </button>
          {filtersOpen && (
            <div className="filter-popover" role="menu">
              <header><strong>Filter by status</strong>{props.statusFilters.length > 0 && <button type="button" onClick={() => props.statusFilters.forEach(props.onToggleStatus)}>Clear</button>}</header>
              {filters.map((filter) => (
                <button type="button" role="menuitemcheckbox" aria-checked={props.statusFilters.includes(filter.id)} key={filter.id} onClick={() => props.onToggleStatus(filter.id)}>
                  <FileStatusIcon status={filter.status} decorative />
                  <span>{filter.label}</span>
                  <small>{counts[filter.id]}</small>
                  <span className={props.statusFilters.includes(filter.id) ? "checkbox is-checked" : "checkbox"}>{props.statusFilters.includes(filter.id) && <Check size={11} aria-hidden="true" />}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {props.loading ? (
        <div className="file-list-skeleton" aria-label="Loading changed files">{Array.from({ length: 10 }, (_, index) => <span key={index} />)}</div>
      ) : visibleFiles.length === 0 ? (
        <EmptyState icon={FileSearch} title={props.files.length ? "No matching files" : "Everything is clean"} detail={props.files.length ? "Try another path or clear the status filters." : "There are no files in this review scope."} compact />
      ) : (
        <div className="file-list" ref={parentRef} tabIndex={0} aria-label="Changed file list">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              if (row.kind === "folder") {
                const collapsed = props.collapsedFolders.includes(row.node.path) && !props.search.trim();
                return (
                  <button key={`folder:${row.node.path}`} type="button" className="folder-row" style={{ transform: `translateY(${virtualRow.start}px)`, paddingLeft: `${10 + row.depth * 14}px` }} onClick={() => props.onToggleFolder(row.node.path)} aria-expanded={!collapsed}>
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    {collapsed ? <Folder size={14} /> : <FolderOpen size={14} />}
                    <span>{row.node.name}</span>
                  </button>
                );
              }
              return (
                <button key={row.file.file_id} type="button" className={`file-row${row.file.file_id === props.activeFileId ? " is-active" : ""}`} style={{ transform: `translateY(${virtualRow.start}px)`, paddingLeft: `${12 + row.depth * 14}px` }} onClick={() => props.onSelect(row.file.file_id)} aria-current={row.file.file_id === props.activeFileId ? "true" : undefined} title={row.file.display_path}>
                  <FileStatusIcon status={row.file.status} />
                  <span className="file-row__paths"><strong>{row.name}</strong>{row.directory && <small>{row.directory}</small>}{row.file.old_display_path && <small>{row.file.old_display_path} → {row.file.display_path}</small>}</span>
                  <span className="file-row__flags">{row.file.conflicted && <i title="Conflict">!</i>}{row.file.staged && <i title="Staged">S</i>}{row.file.unstaged && <i title="Working tree">W</i>}{row.file.submodule && <i title="Submodule">M</i>}</span>
                  <span className="sr-only">{row.file.display_path}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
