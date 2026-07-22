import { lazy, Suspense } from "react";
import { Binary, Box, FileCode2, FileQuestion, FileWarning, Link2, LoaderCircle } from "lucide-react";
import type { FileComparison, FileContent, FileSide } from "../api/types";
import type { DiffView } from "../state/ui-state";
import { EmptyState } from "../components/EmptyState";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { formatBytes } from "./comparison-utils";

const MonacoDiffEditor = lazy(() => import("./MonacoDiff"));

function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({ rs: "rust", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", css: "css", scss: "scss", html: "html", md: "markdown", py: "python", toml: "toml", yml: "yaml", yaml: "yaml", sh: "shell", ps1: "powershell", sql: "sql" } as Record<string, string>)[extension ?? ""] ?? "plaintext";
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
  return <section className="content-card"><header><span><Icon size={16} />{side.label}</span><code>{sourceLabel(side)}</code></header><div><Icon size={22} /><h3>{title}</h3><p>{detail}</p></div></section>;
}

function NonTextComparison({ comparison }: { comparison: FileComparison }) {
  return <div className="non-text-comparison"><ContentCard side={comparison.left} /><ContentCard side={comparison.right} /></div>;
}

export function DiffViewer({ comparison, path, view, loading }: { comparison: FileComparison | null; path: string | null; view: DiffView; loading: boolean }) {
  if (loading) return <div className="diff-loading"><LoaderCircle className="spin" size={18} /><span>Loading file comparison</span></div>;
  if (!comparison || !path) return <EmptyState icon={FileCode2} title="Select a changed file" detail="Choose a file from the navigator to inspect both sides." />;
  if (comparison.left.content.kind !== "text" || comparison.right.content.kind !== "text") return <NonTextComparison comparison={comparison} />;

  return (
    <section className="diff-viewer" aria-label={`Comparison for ${path}`}>
      <header className="diff-viewer__header">
        <div><FileCode2 size={15} /><strong>{path}</strong></div>
        <div className="diff-side-labels"><span><i className="dot dot--old" />{comparison.left.label}<code>{sourceLabel(comparison.left)}</code></span><span><i className="dot dot--new" />{comparison.right.label}<code>{sourceLabel(comparison.right)}</code></span></div>
      </header>
      <div className="diff-viewer__editor">
        <ErrorBoundary resetKey={comparison.file_id} fallback={(_error, reset) => <div className="diff-render-error"><FileWarning size={22} /><strong>Diff renderer failed</strong><span>The rest of the workspace is still available.</span><button className="button button--ghost" onClick={reset}>Try again</button></div>}>
          <Suspense fallback={<div className="diff-loading"><LoaderCircle className="spin" size={18} /><span>Starting diff renderer</span></div>}>
          <MonacoDiffEditor key={comparison.file_id}
            original={comparison.left.content.text}
            modified={comparison.right.content.text}
            language={languageForPath(path)}
            split={view === "split"}
          />
          </Suspense>
        </ErrorBoundary>
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
