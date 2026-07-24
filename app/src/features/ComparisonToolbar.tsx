import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  GitBranch,
  GitCompareArrows,
  RefreshCw,
  Search,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { ComparisonMode, GitReference, RepositorySnapshot } from "../api/types";
import { IconButton } from "../components/IconButton";
import { findUpstreamComparison, modeLabels, shortRef } from "./comparison-utils";

interface Props {
  snapshot: RepositorySnapshot;
  mode: ComparisonMode;
  leftFullRef: string | null;
  rightFullRef: string | null;
  refreshing: boolean;
  resolvedLeft?: { display_name: string; commit_oid: string } | null;
  resolvedRight?: { display_name: string; commit_oid: string } | null;
  onMode(mode: ComparisonMode): void;
  onReferences(left: string | null, right: string | null): void;
  onCompareUpstream(): void;
  onRefresh(): void;
}

const modes: Array<{ id: ComparisonMode; detail: string }> = [
  { id: "all_uncommitted", detail: "Staged, unstaged, and untracked files" },
  { id: "unstaged", detail: "Index compared with the working tree" },
  { id: "staged", detail: "HEAD compared with the index" },
  { id: "direct", detail: "Compare the exact tips of two branches" },
  { id: "since_merge_base", detail: "Changes on the compare branch since divergence" },
];

function BranchPicker({
  label,
  value,
  references,
  onChange,
}: {
  label: string;
  value: string | null;
  references: GitReference[];
  onChange(value: string): void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = references.find((reference) => reference.full_name === value) ?? null;
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return references.filter((reference) =>
      !needle || reference.display_name.toLocaleLowerCase().includes(needle) || reference.full_name.toLocaleLowerCase().includes(needle),
    );
  }, [references, search]);
  const groups = [
    { label: "Local branches", items: visible.filter((reference) => reference.kind === "local_branch") },
    { label: "Remote-tracking · cached", items: visible.filter((reference) => reference.kind === "remote_branch") },
  ].filter((group) => group.items.length);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="branch-picker" ref={rootRef}>
      <span className="branch-picker__label">{label}</span>
      <button
        className="branch-picker__trigger"
        type="button"
        aria-label={`${label}: ${current ? shortRef(current.full_name) : "Select branch"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          setSearch("");
        }}
      >
        <GitBranch size={14} />
        <span>{current ? shortRef(current.full_name) : "Select branch"}</span>
        {current?.is_head && <em>HEAD</em>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="branch-picker__popover">
          <label className="branch-picker__search">
            <Search size={14} />
            <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a branch" aria-label={`Search ${label.toLowerCase()} branches`} />
          </label>
          <div className="branch-picker__options" role="listbox" aria-label={`${label} branch`}>
            {groups.map((group) => (
              <section key={group.label}>
                <header>{group.label}</header>
                {group.items.map((reference) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={reference.full_name === value}
                    key={reference.full_name}
                    onClick={() => {
                      onChange(reference.full_name);
                      setOpen(false);
                    }}
                  >
                    <span><strong>{shortRef(reference.full_name)}</strong><small>{reference.commit_oid.slice(0, 7)}</small></span>
                    {reference.is_head && <em>HEAD</em>}
                    {reference.full_name === value && <Check size={14} />}
                  </button>
                ))}
              </section>
            ))}
            {!groups.length && <p>No matching branches</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export function ComparisonToolbar(props: Props) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const scopeRef = useRef<HTMLDivElement>(null);
  const branchMode = props.mode === "direct" || props.mode === "since_merge_base";
  const fallbackLeft = props.leftFullRef ?? props.snapshot.references.find((reference) => reference.is_head)?.full_name ?? props.snapshot.references[0]?.full_name ?? null;
  const fallbackRight = props.rightFullRef ?? props.snapshot.references.find((reference) => !reference.is_head)?.full_name ?? props.snapshot.references[1]?.full_name ?? fallbackLeft;
  const upstream = findUpstreamComparison(props.snapshot.references);
  const activeMode = modes.find((mode) => mode.id === props.mode)!;

  useEffect(() => {
    if (!scopeOpen) return;
    const close = (event: MouseEvent) => {
      if (!scopeRef.current?.contains(event.target as Node)) setScopeOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [scopeOpen]);

  return (
    <section className="review-toolbar" aria-label="Comparison controls">
      <div className="review-toolbar__scope" ref={scopeRef}>
        <span>Review</span>
        <button type="button" className="scope-trigger" onClick={() => setScopeOpen((open) => !open)} aria-haspopup="menu" aria-expanded={scopeOpen}>
          {props.mode === "since_merge_base" ? <Workflow size={15} /> : branchMode ? <GitCompareArrows size={15} /> : <Sparkles size={15} />}
          <span><strong>{modeLabels[props.mode]}</strong><small>{activeMode.detail}</small></span>
          <ChevronDown size={14} />
        </button>
        {scopeOpen && (
          <div className="scope-menu" role="menu">
            <header>Choose what to review</header>
            {modes.map((mode, index) => (
              <button type="button" role="menuitemradio" aria-checked={props.mode === mode.id} key={mode.id} onClick={() => { props.onMode(mode.id); setScopeOpen(false); }}>
                <span className="scope-menu__icon">{index < 3 ? <Sparkles size={14} /> : mode.id === "direct" ? <GitCompareArrows size={14} /> : <Workflow size={14} />}</span>
                <span><strong>{modeLabels[mode.id]}</strong><small>{mode.detail}</small></span>
                {props.mode === mode.id && <Check size={14} />}
              </button>
            ))}
          </div>
        )}
      </div>

      {branchMode ? (
        <div className="review-toolbar__branches">
          <BranchPicker label="Base" value={fallbackLeft} references={props.snapshot.references} onChange={(value) => props.onReferences(value, fallbackRight)} />
          <IconButton label="Swap base and compare branches" onClick={() => props.onReferences(fallbackRight, fallbackLeft)}><ArrowLeftRight size={15} /></IconButton>
          <BranchPicker label="Compare" value={fallbackRight} references={props.snapshot.references} onChange={(value) => props.onReferences(fallbackLeft, value)} />
        </div>
      ) : (
        <div className="review-toolbar__summary">
          <strong>{props.snapshot.info.display_name}</strong>
          <span>{activeMode.detail}</span>
        </div>
      )}

      <div className="review-toolbar__actions">
        {upstream && (
          <button className="upstream-action" type="button" onClick={props.onCompareUpstream} title={`Compare ${shortRef(upstream.local.full_name)} with cached ${shortRef(upstream.upstream.full_name)}`}>
            <GitCompareArrows size={14} />
            <span>Compare with upstream</span>
          </button>
        )}
        {!upstream && props.snapshot.head.kind === "branch" && <span className="upstream-unavailable" title="The checked-out branch has no available cached upstream">No upstream</span>}
        <IconButton label="Refresh repository" shortcut="Ctrl+R" onClick={props.onRefresh} disabled={props.refreshing}>
          <RefreshCw size={15} className={props.refreshing ? "spin" : ""} />
        </IconButton>
      </div>

      {branchMode && props.resolvedLeft && props.resolvedRight && (
        <div className="resolved-revisions" title={`${props.resolvedLeft.commit_oid} → ${props.resolvedRight.commit_oid}`}>
          <code>{shortRef(props.resolvedLeft.display_name)} · {props.resolvedLeft.commit_oid.slice(0, 7)}</code>
          <span>→</span>
          <code>{shortRef(props.resolvedRight.display_name)} · {props.resolvedRight.commit_oid.slice(0, 7)}</code>
        </div>
      )}
    </section>
  );
}
