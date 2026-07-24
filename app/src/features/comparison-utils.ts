import type { ChangeKind, ChangedFile, ComparisonMode, ComparisonRequest, GitReference, RefId } from "../api/types";

export const modeLabels: Record<ComparisonMode, string> = {
  all_uncommitted: "Working tree",
  unstaged: "Unstaged",
  staged: "Staged",
  direct: "Branch tips",
  since_merge_base: "Changes since split",
};

export interface UpstreamComparison {
  local: GitReference;
  upstream: GitReference;
}

export function findUpstreamComparison(references: GitReference[]): UpstreamComparison | null {
  const local = references.find((reference) => reference.kind === "local_branch" && reference.is_head);
  if (!local?.upstream_full_name) return null;
  const upstream = references.find((reference) => reference.full_name === local.upstream_full_name);
  return upstream ? { local, upstream } : null;
}

export const statusMeta: Record<ChangeKind, { letter: string; label: string; group: string }> = {
  added: { letter: "A", label: "Added", group: "added" },
  modified: { letter: "M", label: "Modified", group: "modified" },
  deleted: { letter: "D", label: "Deleted", group: "deleted" },
  renamed: { letter: "R", label: "Renamed", group: "renamed" },
  copied: { letter: "C", label: "Copied", group: "renamed" },
  type_changed: { letter: "T", label: "Type changed", group: "modified" },
  unmerged: { letter: "U", label: "Unmerged", group: "conflicted" },
  untracked: { letter: "?", label: "Untracked", group: "added" },
  unknown: { letter: "·", label: "Unknown", group: "modified" },
};

export function createComparisonRequest(
  mode: ComparisonMode,
  references: GitReference[],
  leftFullRef: string | null,
  rightFullRef: string | null,
): ComparisonRequest | null {
  if (mode === "all_uncommitted" || mode === "staged" || mode === "unstaged") return { mode };
  const left = references.find((reference) => reference.full_name === leftFullRef)?.id;
  const right = references.find((reference) => reference.full_name === rightFullRef)?.id;
  if (!left || !right) return null;
  return { mode, left: left as RefId, right: right as RefId };
}

export function filterFiles(files: ChangedFile[], search: string, statusFilters: string[]): ChangedFile[] {
  const needle = search.trim().toLocaleLowerCase();
  return files.filter((file) => {
    const matchesSearch = !needle || file.display_path.toLocaleLowerCase().includes(needle) || file.old_display_path?.toLocaleLowerCase().includes(needle);
    const matchesStatus = statusFilters.length === 0 || statusFilters.includes(statusMeta[file.status].group);
    return Boolean(matchesSearch && matchesStatus);
  });
}

export function shortRef(fullName: string | null): string {
  if (!fullName) return "Select branch";
  return fullName.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, "");
}

export function headLabel(kind: "branch" | "detached" | "unborn", fullRef?: string | null, oid?: string): string {
  if (kind === "branch") return shortRef(fullRef ?? null);
  if (kind === "detached") return `detached · ${oid?.slice(0, 7) ?? "unknown"}`;
  return fullRef ? `unborn · ${shortRef(fullRef)}` : "unborn HEAD";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
