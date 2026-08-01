import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Cloud, Gauge, ShieldCheck } from "lucide-react";
import { backend, normalizeError } from "../../api/backend";
import type {
  AuditDepth,
  AuditProviderSettings,
  AuditRequest,
  ComparisonResult,
  FrontendError,
  RepositorySnapshot,
} from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { ConfirmDialog } from "../../components/ModalForms";
import { InlineError } from "../../components/InlineError";

interface Draft {
  work: string;
  acceptance: string;
  context: string;
  depth: AuditDepth;
}

const emptyDraft: Draft = { work: "", acceptance: "", context: "", depth: "quick" };

export function AuditSetupDialog({
  open,
  snapshot,
  comparison,
  onClose,
  onStarted,
}: {
  open: boolean;
  snapshot: RepositorySnapshot;
  comparison: ComparisonResult;
  onClose(): void;
  onStarted(): void;
}) {
  const storageKey = `branch-review:audit-draft:${snapshot.repo_id}`;
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [initial, setInitial] = useState<Draft>(emptyDraft);
  const [settings, setSettings] = useState<AuditProviderSettings | null>(null);
  const [error, setError] = useState<FrontendError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const workRef = useRef<HTMLTextAreaElement>(null);
  const acceptanceRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    let saved = emptyDraft;
    try {
      saved = { ...emptyDraft, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") };
    } catch {
      // Invalid drafts are safely ignored.
    }
    setDraft(saved);
    setInitial(saved);
    setError(null);
    void backend.getAuditProviderSettings().then(setSettings).catch((value) => setError(normalizeError(value)));
  }, [open, storageKey]);

  useEffect(() => {
    if (open) localStorage.setItem(storageKey, JSON.stringify(draft));
  }, [draft, open, storageKey]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  useEffect(() => {
    if (!open || !dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, open]);
  const endpoints = useMemo(() => {
    const left = comparison.merge_base_oid ?? comparison.content_left_oid;
    const right = comparison.content_right_oid;
    return `${left?.slice(0, 12) ?? "empty"} → ${right?.slice(0, 12) ?? (comparison.mode === "unstaged" ? "worktree" : "index/worktree")}`;
  }, [comparison]);

  const requestClose = () => {
    if (dirty) setConfirmDismiss(true);
    else onClose();
  };

  const start = async () => {
    setError(null);
    if (!draft.work.trim()) {
      setError({ code: "IO", message: "Describe the work being audited.", retryable: false, repo_id: null, operation_id: null });
      workRef.current?.focus();
      return;
    }
    if (!draft.acceptance.trim()) {
      setError({ code: "IO", message: "Add acceptance criteria for the reviewer.", retryable: false, repo_id: null, operation_id: null });
      acceptanceRef.current?.focus();
      return;
    }
    if (!settings?.configured) {
      setError({ code: "IO", message: "Install Codex and sign in with your ChatGPT account before starting an audit.", retryable: false, repo_id: null, operation_id: null });
      return;
    }
    const request: AuditRequest = {
      repo_id: snapshot.repo_id,
      comparison_id: comparison.comparison_id,
      work_description: draft.work.trim(),
      acceptance_criteria: draft.acceptance.trim(),
      additional_context: draft.context.trim(),
      depth: draft.depth,
    };
    setSubmitting(true);
    try {
      await backend.startAudit(request);
      localStorage.removeItem(storageKey);
      onStarted();
    } catch (value) {
      setError(normalizeError(value));
    } finally {
      setSubmitting(false);
    }
  };

  const budget = draft.depth === "quick"
    ? "5 min · 40 evidence operations · 2 MiB returned"
    : "20 min · 160 evidence operations · 12 MiB returned";

  return (
    <>
      <Dialog open={open} onClose={requestClose} title="Audit immutable work" description="Create a read-only snapshot for an AI static review." width="medium">
        <form className="audit-setup" onSubmit={(event) => { event.preventDefault(); void start(); }}>
          {error && <InlineError error={error} />}
          <label className="field">
            <span>Work description <b aria-hidden="true">*</b></span>
            <textarea ref={workRef} name="work_description" autoComplete="off" autoFocus value={draft.work} onChange={(event) => setDraft({ ...draft, work: event.target.value })} rows={3} maxLength={10_000} aria-required="true" />
            <small>What changed and why?</small>
          </label>
          <label className="field">
            <span>Acceptance criteria <b aria-hidden="true">*</b></span>
            <textarea ref={acceptanceRef} name="acceptance_criteria" autoComplete="off" value={draft.acceptance} onChange={(event) => setDraft({ ...draft, acceptance: event.target.value })} rows={3} maxLength={10_000} aria-required="true" />
            <small>Concrete behavior the change must preserve or deliver.</small>
          </label>
          <label className="field">
            <span>Additional context</span>
            <textarea name="additional_context" autoComplete="off" value={draft.context} onChange={(event) => setDraft({ ...draft, context: event.target.value })} rows={2} maxLength={20_000} />
          </label>
          <fieldset className="audit-depth">
            <legend>Review depth</legend>
            {(["quick", "thorough"] as const).map((depth) => (
              <label key={depth} className={draft.depth === depth ? "is-selected" : ""}>
                <input type="radio" name="depth" value={depth} checked={draft.depth === depth} onChange={() => setDraft({ ...draft, depth })} />
                <span><strong>{depth === "quick" ? "Quick" : "Thorough"}</strong><small>{depth === "quick" ? "Focused defect scan" : "Wider evidence and coverage"}</small></span>
              </label>
            ))}
          </fieldset>
          <section className="audit-scope" aria-label="Audit scope and security">
            <header><ShieldCheck size={15} /><strong>Snapshot and data boundary</strong></header>
            <dl>
              <div><dt>Endpoints</dt><dd><code>{endpoints}</code></dd></div>
              <div><dt>Merge base</dt><dd><code>{comparison.merge_base_oid?.slice(0, 12) ?? "Not applicable"}</code></dd></div>
              <div><dt>Changed files</dt><dd>{comparison.files.length}</dd></div>
              <div><dt>Provider</dt><dd>{settings?.provider ?? "Codex"} · {settings?.model ?? "account default"}</dd></div>
              <div><dt>Budget</dt><dd>{budget}</dd></div>
              <div><dt>Excluded</dt><dd>.git, ignored files, dependencies/build output, credential/private-key paths{settings?.secret_paths.length ? `, configured: ${settings.secret_paths.join(", ")}` : ""}</dd></div>
            </dl>
            <p><Gauge size={14} /> Hard bundle cap 100 MiB; individual files 5 MiB; binary and generated/dependency content excluded.</p>
            <p><AlertTriangle size={14} /> Path rules exclude likely credential files, but inline secrets in ordinary source files may not be detected. Add sensitive files or directories to Settings before starting.</p>
            <p className="audit-scope__cloud"><Cloud size={14} /> Changed files plus bounded, unchanged tracked or unignored repository text may be reviewed through your signed-in Codex account. ChatGPT plan limits and workspace data controls apply.</p>
          </section>
          <footer className="audit-setup__actions">
            <button type="button" className="button button--ghost" onClick={requestClose}>Cancel</button>
            <button type="submit" className="button button--primary" disabled={submitting || !settings?.configured}>
              {submitting ? "Freezing snapshot…" : "Start audit"}
            </button>
          </footer>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDismiss}
        title="Discard audit setup?"
        detail="Your draft has unsaved changes. The local autosave will be removed."
        confirmLabel="Discard draft"
        onClose={() => setConfirmDismiss(false)}
        onConfirm={() => {
          localStorage.removeItem(storageKey);
          setConfirmDismiss(false);
          onClose();
        }}
      />
    </>
  );
}
