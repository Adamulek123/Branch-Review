import { Columns2, GitCompareArrows, RefreshCw, Rows3, Split, Workflow } from "lucide-react";
import type { ComparisonMode, GitReference, RepositorySnapshot } from "../api/types";
import type { DiffView } from "../state/ui-state";
import { IconButton } from "../components/IconButton";
import { modeLabels, shortRef } from "./comparison-utils";

interface Props {
  snapshot: RepositorySnapshot;
  mode: ComparisonMode;
  leftFullRef: string | null;
  rightFullRef: string | null;
  diffView: DiffView;
  refreshing: boolean;
  resolvedLeft?: { display_name: string; commit_oid: string } | null;
  resolvedRight?: { display_name: string; commit_oid: string } | null;
  onMode(mode: ComparisonMode): void;
  onReferences(left: string | null, right: string | null): void;
  onDiffView(view: DiffView): void;
  onRefresh(): void;
}

function ReferenceSelect({ label, value, references, onChange }: { label: string; value: string | null; references: GitReference[]; onChange(value: string): void }) {
  const locals = references.filter((reference) => reference.kind === "local_branch");
  const remotes = references.filter((reference) => reference.kind === "remote_branch");
  return (
    <label className="reference-select">
      <span>{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)} aria-label={`${label} reference`}>
        <option value="" disabled>Select branch</option>
        {locals.length > 0 && <optgroup label="Local branches">{locals.map((reference) => <option key={reference.full_name} value={reference.full_name}>{reference.display_name}{reference.is_head ? "  • HEAD" : ""}</option>)}</optgroup>}
        {remotes.length > 0 && <optgroup label="Remote-tracking · cached">{remotes.map((reference) => <option key={reference.full_name} value={reference.full_name}>{reference.display_name}</option>)}</optgroup>}
      </select>
    </label>
  );
}

export function ComparisonToolbar(props: Props) {
  const branchMode = props.mode === "direct" || props.mode === "since_merge_base";
  const fallbackLeft = props.leftFullRef ?? props.snapshot.references.find((reference) => reference.is_head)?.full_name ?? props.snapshot.references[0]?.full_name ?? null;
  const fallbackRight = props.rightFullRef ?? props.snapshot.references.find((reference) => !reference.is_head)?.full_name ?? props.snapshot.references[1]?.full_name ?? fallbackLeft;
  return (
    <section className="comparison-toolbar" aria-label="Comparison controls">
      <div className="segmented" aria-label="Comparison mode">
        {(["all_uncommitted", "unstaged", "staged", "direct", "since_merge_base"] as ComparisonMode[]).map((mode) => (
          <button key={mode} className={props.mode === mode ? "is-active" : ""} onClick={() => props.onMode(mode)} aria-pressed={props.mode === mode}>
            {mode === "direct" ? <GitCompareArrows size={14} /> : mode === "since_merge_base" ? <Workflow size={14} /> : null}
            {modeLabels[mode]}
          </button>
        ))}
      </div>
      {branchMode && (
        <div className="reference-pair">
          <ReferenceSelect label="Base" value={fallbackLeft} references={props.snapshot.references} onChange={(value) => props.onReferences(value, fallbackRight)} />
          <GitCompareArrows className="reference-pair__arrow" size={14} aria-hidden="true" />
          <ReferenceSelect label="Compare" value={fallbackRight} references={props.snapshot.references} onChange={(value) => props.onReferences(fallbackLeft, value)} />
        </div>
      )}
      {branchMode && props.resolvedLeft && props.resolvedRight && (
        <div className="resolved-revisions" title={`${props.resolvedLeft.commit_oid} → ${props.resolvedRight.commit_oid}`}>
          <code>{shortRef(props.resolvedLeft.display_name)} · {props.resolvedLeft.commit_oid.slice(0, 7)}</code>
          <span>→</span>
          <code>{shortRef(props.resolvedRight.display_name)} · {props.resolvedRight.commit_oid.slice(0, 7)}</code>
        </div>
      )}
      <div className="comparison-toolbar__spacer" />
      <div className="segmented segmented--icons" aria-label="Diff layout">
        <button className={props.diffView === "split" ? "is-active" : ""} onClick={() => props.onDiffView("split")} aria-label="Split diff" aria-pressed={props.diffView === "split"}><Columns2 size={15} /></button>
        <button className={props.diffView === "unified" ? "is-active" : ""} onClick={() => props.onDiffView("unified")} aria-label="Unified diff" aria-pressed={props.diffView === "unified"}><Rows3 size={15} /></button>
      </div>
      <IconButton label="Refresh repository" shortcut="Ctrl+R" onClick={props.onRefresh} disabled={props.refreshing}>
        <RefreshCw size={15} className={props.refreshing ? "spin" : ""} />
      </IconButton>
      <span className="read-only-pill"><Split size={13} /> Read only</span>
    </section>
  );
}
