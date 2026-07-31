import { lazy, Suspense, useCallback, useRef, useState } from "react";
import {
  Binary,
  Box,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileCode2,
  FileQuestion,
  FileWarning,
  Link2,
  ListCollapse,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Rows3,
  Settings2,
  WrapText,
} from "lucide-react";
import type { ChangedFile, FileComparison, FileContent, FileSide } from "../api/types";
import type { DiffView } from "../state/ui-state";
import { EmptyState } from "../components/EmptyState";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { IconButton } from "../components/IconButton";
import { useDismissibleLayer } from "../components/useDismissibleLayer";
import { formatBytes } from "./comparison-utils";
import { FileStatusIcon } from "./FileStatusIcon";

const MonacoDiffEditor = lazy(() => import("./MonacoDiff"));

export function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ rs: "rust", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", toml: "toml", yml: "yaml", yaml: "yaml", sh: "shellscript", ps1: "powershell", sql: "sql" } as Record<string, string>)[extension ?? ""] ?? "text";
}

function sourceLabel(side: FileSide): string {
  switch (side.source.kind) {
    case "commit": return `commit ${side.source.commit_oid.slice(0, 8)}`;
    case "conflict_stage": return `conflict stage ${side.source.stage}`;
    case "index": return "index";
    case "worktree": return "worktree";
    case "empty": return "empty";
    case "submodule": return "submodule";
  }
}

function ContentCard({ side }: { side: FileSide }) {
  const content = side.content;
  let icon = FileQuestion;
  let title = "Content unavailable";
  let detail = "This side cannot be displayed as text.";
  if (content.kind === "binary") { icon = Binary; title = "Binary file"; detail = `${formatBytes(content.size)} · binary content is not decoded.`; }
  if (content.kind === "too_large") { icon = FileWarning; title = "File exceeds the display limit"; detail = `${formatBytes(content.size)} · limit ${formatBytes(content.limit)}.`; }
  if (content.kind === "missing") { icon = FileCode2; title = "No file on this side"; detail = "The file was added or deleted in this comparison."; }
  if (content.kind === "symlink") { icon = Link2; title = "Symbolic link"; detail = content.target; }
  if (content.kind === "submodule") { icon = Box; title = "Submodule pointer"; detail = content.commit_oid ?? "No commit on this side"; }
  if (content.kind === "unsupported_encoding") { icon = FileWarning; title = "Unsupported text encoding"; detail = `${formatBytes(content.size)} · only supported text encodings are rendered.`; }
  const Icon = icon;
  return <section className="content-card"><header><span><Icon size={16} />{side.label}</span><code>{sourceLabel(side)}</code></header><div><Icon size={24} /><h3>{title}</h3><p>{detail}</p></div></section>;
}

function NonTextComparison({ comparison }: { comparison: FileComparison }) {
  return <div className="non-text-comparison"><ContentCard side={comparison.left} /><ContentCard side={comparison.right} /></div>;
}

function textForDiff(content: FileContent): string | null {
  if (content.kind === "text") return content.text;
  if (content.kind === "missing") return "";
  return null;
}

interface Props {
  comparison: FileComparison | null;
  file: ChangedFile | null;
  view: DiffView;
  loading: boolean;
  wrapLines: boolean;
  ignoreTrimWhitespace: boolean;
  collapseUnchanged: boolean;
  filePaneCollapsed: boolean;
  hasPrevious: boolean;
  hasNext: boolean;
  focusLine?: number | null;
  onView(view: DiffView): void;
  onWrapLines(enabled: boolean): void;
  onIgnoreTrimWhitespace(enabled: boolean): void;
  onCollapseUnchanged(enabled: boolean): void;
  onToggleFilePane(): void;
  onPreviousFile(): void;
  onNextFile(): void;
}

export function DiffViewer(props: Props) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lineCounts, setLineCounts] = useState<{ key: string; added: number; removed: number } | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  useDismissibleLayer({ open: settingsOpen, rootRef: settingsRef, triggerRef: settingsTriggerRef, onDismiss: closeSettings });
  const lineCountKey = `${props.comparison?.file_id ?? ""}:${props.ignoreTrimWhitespace}`;
  const handleLineCounts = useCallback(
    (counts: { added: number; removed: number }) => setLineCounts({ key: lineCountKey, ...counts }),
    [lineCountKey],
  );
  const path = props.file?.display_path ?? null;
  if (props.loading) return <div className="diff-loading"><LoaderCircle className="spin" size={18} /><span>Loading file comparison</span></div>;
  if (!props.comparison || !path || !props.file) return <EmptyState icon={FileCode2} title="Choose a file to review" detail="Select a changed file to compare its previous and current content." />;

  const pathParts = path.split(/[\\/]/);
  const fileName = pathParts.pop() ?? path;
  const original = textForDiff(props.comparison.left.content);
  const modified = textForDiff(props.comparison.right.content);
  const textDiff = (
    (props.comparison.left.content.kind === "text" || props.comparison.right.content.kind === "text")
    && original !== null
    && modified !== null
  ) ? { original, modified } : null;

  return (
    <section className="diff-viewer" aria-label={`Comparison for ${path}`}>
      <header className="diff-viewer__header">
        <div className="diff-file-context">
          <FileStatusIcon status={props.file.status} />
          <div className="path-breadcrumbs" title={path}>
            {pathParts.length > 0 && <span>{pathParts.join(" / ")}</span>}
            <strong>{fileName}</strong>
          </div>
          {props.file.old_display_path && <span className="rename-context">from {props.file.old_display_path}</span>}
          {textDiff && lineCounts?.key === lineCountKey && (
            <span className="diff-line-counts" aria-label={`${lineCounts.added} lines added, ${lineCounts.removed} lines removed`}>
              <strong>+{lineCounts.added}</strong>
              <em>−{lineCounts.removed}</em>
            </span>
          )}
        </div>

        <div className="diff-header-actions">
          <div className="file-stepper" aria-label="Changed file navigation">
            <IconButton label="Previous changed file" shortcut="Shift+K" disabled={!props.hasPrevious} onClick={props.onPreviousFile}><ChevronLeft size={15} /></IconButton>
            <IconButton label="Next changed file" shortcut="Shift+J" disabled={!props.hasNext} onClick={props.onNextFile}><ChevronRight size={15} /></IconButton>
          </div>
          <IconButton label={props.filePaneCollapsed ? "Show changed files" : "Focus on diff"} onClick={props.onToggleFilePane}>
            {props.filePaneCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </IconButton>
          <div className="diff-layout-switcher" aria-label="Diff layout">
            <button type="button" className={props.view === "split" ? "is-active" : ""} onClick={() => props.onView("split")} aria-label="Side-by-side diff" aria-pressed={props.view === "split"}><Columns2 size={15} /></button>
            <button type="button" className={props.view === "unified" ? "is-active" : ""} onClick={() => props.onView("unified")} aria-label="Inline diff" aria-pressed={props.view === "unified"}><Rows3 size={15} /></button>
          </div>
          <div className="diff-settings" ref={settingsRef}>
            <IconButton ref={settingsTriggerRef} label="Diff display settings" onClick={() => setSettingsOpen((open) => !open)}><Settings2 size={16} /></IconButton>
            {settingsOpen && (
              <div className="diff-settings__popover">
                <header>Diff display</header>
                <label><span><WrapText size={14} /><span><strong>Wrap long lines</strong><small>Keep code inside the visible pane</small></span></span><input type="checkbox" checked={props.wrapLines} onChange={(event) => props.onWrapLines(event.target.checked)} /></label>
                <label><span><ChevronDown size={14} /><span><strong>Ignore trim whitespace</strong><small>Hide whitespace-only line endings</small></span></span><input type="checkbox" checked={props.ignoreTrimWhitespace} onChange={(event) => props.onIgnoreTrimWhitespace(event.target.checked)} /></label>
                <label><span><ListCollapse size={14} /><span><strong>Collapse unchanged code</strong><small>Keep three context lines around changes</small></span></span><input type="checkbox" checked={props.collapseUnchanged} onChange={(event) => props.onCollapseUnchanged(event.target.checked)} /></label>
              </div>
            )}
          </div>
        </div>

        <div className="diff-revisions">
          <span><i className="dot dot--old" /><strong>{props.comparison.left.label}</strong><code>{sourceLabel(props.comparison.left)}</code></span>
          <span className="diff-revisions__arrow">→</span>
          <span><i className="dot dot--new" /><strong>{props.comparison.right.label}</strong><code>{sourceLabel(props.comparison.right)}</code></span>
        </div>
      </header>

      <div className="diff-viewer__editor">
        {textDiff ? (
          <ErrorBoundary resetKey={props.comparison.file_id} fallback={(_error, reset) => <div className="diff-render-error"><FileWarning size={22} /><strong>Diff renderer failed</strong><span>The changed-file list is still available.</span><button className="button button--ghost" onClick={reset}>Try again</button></div>}>
            <Suspense fallback={<div className="diff-loading"><LoaderCircle className="spin" size={18} /><span>Preparing syntax highlighting</span></div>}>
              <MonacoDiffEditor
                key={props.comparison.file_id}
                fileId={props.comparison.file_id}
                path={path}
                original={textDiff.original}
                modified={textDiff.modified}
                language={languageForPath(path)}
                split={props.view === "split"}
                wrapLines={props.wrapLines}
                ignoreTrimWhitespace={props.ignoreTrimWhitespace}
                collapseUnchanged={props.collapseUnchanged}
                focusLine={props.focusLine}
                onLineCounts={handleLineCounts}
              />
            </Suspense>
          </ErrorBoundary>
        ) : (
          <NonTextComparison comparison={props.comparison} />
        )}
      </div>
    </section>
  );
}

export function contentSummary(content: FileContent): string {
  switch (content.kind) {
    case "text": return `${content.encoding} · ${formatBytes(content.size)}`;
    case "binary": return `binary · ${formatBytes(content.size)}`;
    case "too_large": return `too large · ${formatBytes(content.size)}`;
    case "missing": return "missing";
    case "symlink": return `link → ${content.target}`;
    case "submodule": return content.commit_oid ?? "empty submodule";
    case "unsupported_encoding": return `unsupported encoding · ${formatBytes(content.size)}`;
  }
}
