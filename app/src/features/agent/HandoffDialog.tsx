import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, LoaderCircle, LockKeyhole, Network, ShieldCheck } from "lucide-react";
import { backend, normalizeError } from "../../api/backend";
import type {
  AuditSession,
  CodexAvailability,
  FindingId,
  FrontendError,
  RepoId,
} from "../../api/types";
import { Dialog } from "../../components/Dialog";
import { InlineError } from "../../components/InlineError";

export interface HandoffSelection {
  audit: AuditSession;
  findingIds: FindingId[];
}

export function HandoffDialog({
  open,
  repoId,
  generation,
  selection,
  onClose,
  onStarted,
}: {
  open: boolean;
  repoId: RepoId;
  generation: number;
  selection: HandoffSelection | null;
  onClose(): void;
  onStarted(): void;
}) {
  const [availability, setAvailability] = useState<CodexAvailability | null>(null);
  const [error, setError] = useState<FrontendError | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setAvailability(null);
    void backend
      .getCodexAvailability()
      .then(setAvailability)
      .catch((value) => setError(normalizeError(value)));
  }, [open]);

  const findings = useMemo(
    () =>
      selection?.audit.findings.filter((finding) =>
        selection.findingIds.includes(finding.finding_id),
      ) ?? [],
    [selection],
  );
  if (!selection) return null;
  const drifted = selection.audit.snapshot?.generation !== generation;
  const usable =
    availability?.installed &&
    availability.app_server_supported &&
    availability.authenticated;

  const start = async () => {
    try {
      setStarting(true);
      setError(null);
      await backend.startRemediation({
        repo_id: repoId,
        audit_id: selection.audit.audit_id,
        finding_ids: selection.findingIds,
      });
      onStarted();
    } catch (value) {
      setError(normalizeError(value));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={starting ? () => undefined : onClose}
      title="Send findings to agent"
      description="Create a fresh, repository-scoped Codex thread."
      width="medium"
      footer={
        <>
          <button className="button button--ghost" disabled={starting} onClick={onClose}>
            Cancel
          </button>
          <button
            className="button button--primary"
            disabled={!usable || starting}
            onClick={() => void start()}
          >
            {starting ? <LoaderCircle className="spin" size={14} /> : <Bot size={14} />}
            Start agent
          </button>
        </>
      }
    >
      <section className="handoff-confirm">
        {error && <InlineError error={error} />}
        <div className={`agent-readiness ${usable ? "is-ready" : "is-blocked"}`}>
          {availability ? (
            usable ? <ShieldCheck size={17} /> : <AlertTriangle size={17} />
          ) : (
            <LoaderCircle className="spin" size={17} />
          )}
          <span>
            <strong>{availability?.version ?? "Checking Codex…"}</strong>
            <small>{availability?.message ?? "Checking app-server and authentication."}</small>
          </span>
        </div>
        <dl className="handoff-facts">
          <div>
            <dt>Audited revision</dt>
            <dd><code>{selection.audit.snapshot?.content_right_oid?.slice(0, 12) ?? "captured worktree"}</code></dd>
          </div>
          <div>
            <dt>Current workspace</dt>
            <dd className={drifted ? "freshness-stale" : "freshness-current"}>
              {drifted ? "Changed since audit — agent must revalidate" : "Matches audited generation"}
            </dd>
          </div>
          <div>
            <dt>Selected findings</dt>
            <dd>{findings.length} confirmed</dd>
          </div>
        </dl>
        <div className="handoff-security">
          <h3>Exact permission profile</h3>
          <p><LockKeyhole size={14} /><span><strong>Workspace write</strong> only inside this repository; <code>.git</code> remains protected and read-only.</span></p>
          <p><Network size={14} /><span><strong>Network off</strong>; web search and external MCP servers are disabled.</span></p>
          <p><ShieldCheck size={14} /><span><strong>On-request approvals</strong> return here with the exact command, cwd, paths, or network target.</span></p>
        </div>
        <div className="handoff-findings" aria-label="Selected findings">
          {findings.map((finding) => (
            <div key={finding.finding_id}>
              <span className={`severity-mark severity-mark--${finding.severity}`}>{finding.severity}</span>
              <span><strong>{finding.title}</strong><small>{finding.location.path}:{finding.location.start_line}</small></span>
            </div>
          ))}
        </div>
        <p className="handoff-warning">
          <AlertTriangle size={14} />
          This is a separate agent that can edit ordinary workspace files and run local checks. It cannot commit, push, switch branches, mutate Git metadata, or publish.
        </p>
      </section>
    </Dialog>
  );
}
