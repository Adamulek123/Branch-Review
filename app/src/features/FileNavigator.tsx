import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FileSearch, Search, X } from "lucide-react";
import type { ChangedFile, FileId } from "../api/types";
import { IconButton } from "../components/IconButton";
import { EmptyState } from "../components/EmptyState";
import { filterFiles, statusMeta } from "./comparison-utils";

interface Props {
  files: ChangedFile[];
  search: string;
  statusFilters: string[];
  activeFileId: FileId | null;
  loading: boolean;
  onSearch(value: string): void;
  onToggleStatus(status: string): void;
  onSelect(fileId: FileId): void;
}

const filters = [
  { id: "added", label: "Added", letter: "A" },
  { id: "modified", label: "Modified", letter: "M" },
  { id: "deleted", label: "Deleted", letter: "D" },
  { id: "renamed", label: "Renamed", letter: "R" },
  { id: "conflicted", label: "Conflicts", letter: "U" },
];

export function FileNavigator(props: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const visibleFiles = useMemo(() => filterFiles(props.files, props.search, props.statusFilters), [props.files, props.search, props.statusFilters]);
  const virtualizer = useVirtualizer({ count: visibleFiles.length, getScrollElement: () => parentRef.current, estimateSize: () => 48, overscan: 10 });

  useEffect(() => {
    const focus = () => searchRef.current?.focus();
    window.addEventListener("branch-review:focus-filter", focus);
    return () => window.removeEventListener("branch-review:focus-filter", focus);
  }, []);

  const navigate = (delta: number) => {
    if (!visibleFiles.length) return;
    const current = visibleFiles.findIndex((file) => file.file_id === props.activeFileId);
    const index = Math.max(0, Math.min(visibleFiles.length - 1, (current < 0 ? 0 : current) + delta));
    props.onSelect(visibleFiles[index].file_id);
    virtualizer.scrollToIndex(index, { align: "auto" });
  };

  return (
    <aside className="file-navigator" aria-label="Changed files" onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "ArrowDown" || event.key.toLowerCase() === "j") { event.preventDefault(); navigate(1); }
      if (event.key === "ArrowUp" || event.key.toLowerCase() === "k") { event.preventDefault(); navigate(-1); }
      if (event.key === "Enter" && props.activeFileId) { event.preventDefault(); props.onSelect(props.activeFileId); }
    }}>
      <div className="pane-heading"><div><span>Changed files</span><strong>{visibleFiles.length}<small> / {props.files.length}</small></strong></div></div>
      <div className="file-search">
        <Search size={14} />
        <input ref={searchRef} value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Filter paths" aria-label="Filter changed files" />
        {props.search && <IconButton label="Clear filter" onClick={() => props.onSearch("")}><X size={13} /></IconButton>}
        <kbd>⌘F</kbd>
      </div>
      <div className="status-filters" aria-label="Status filters">
        {filters.map((filter) => <button key={filter.id} className={props.statusFilters.includes(filter.id) ? `is-active status-${filter.id}` : ""} onClick={() => props.onToggleStatus(filter.id)} aria-pressed={props.statusFilters.includes(filter.id)} title={filter.label}><span>{filter.letter}</span>{filter.label}</button>)}
      </div>
      {props.loading ? (
        <div className="file-list-skeleton" aria-label="Loading changed files">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
      ) : visibleFiles.length === 0 ? (
        <EmptyState icon={FileSearch} title={props.files.length ? "No matching files" : "No changes here"} detail={props.files.length ? "Adjust the path or status filters." : "This comparison has no changed files."} compact />
      ) : (
        <div className="file-list" ref={parentRef} tabIndex={0} aria-label="Changed file list">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((row) => {
              const file = visibleFiles[row.index];
              const meta = statusMeta[file.status];
              return <button key={file.file_id} className={`file-row${file.file_id === props.activeFileId ? " is-active" : ""}`} style={{ transform: `translateY(${row.start}px)` }} onClick={() => props.onSelect(file.file_id)} aria-current={file.file_id === props.activeFileId ? "true" : undefined} title={file.display_path}>
                <span className={`status-letter status-${meta.group}`} aria-label={meta.label}>{meta.letter}</span>
                <span className="file-row__paths"><strong>{file.display_path.split(/[\\/]/).pop()}</strong><small>{file.old_display_path ? `${file.old_display_path} → ${file.display_path}` : file.display_path}</small></span>
                <span className="file-row__flags">{file.conflicted && <i title="Conflict">!</i>}{file.staged && <i title="Staged">S</i>}{file.unstaged && <i title="Unstaged">W</i>}{file.submodule && <i title="Submodule">M</i>}</span>
              </button>;
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
