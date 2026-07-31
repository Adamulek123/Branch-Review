import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDot,
  FileCode2,
  LoaderCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  StopCircle,
} from "lucide-react";
import { backend, normalizeError } from "../../api/backend";
import { listenForAuditEvents } from "../../api/events";
import type {
  AuditEvidence,
  AuditFinding,
  AuditId,
  AuditSession,
  FileId,
  FindingId,
  FrontendError,
  RepoId,
} from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { InlineError } from "../../components/InlineError";

const active = (status: AuditSession["status"]) =>
  status === "preparing" || status === "running" || status === "cancelling";

export function AuditWorkspace({
  repoId,
  generation,
  onStart,
  onNavigate,
  onHandoff,
}: {
  repoId: RepoId;
  generation: number;
  onStart(): void;
  onNavigate?(fileId: FileId, line: number): void;
  onHandoff?(session: AuditSession, findingIds: FindingId[]): void;
}) {
  const [sessions, setSessions] = useState<AuditSession[]>([]);
  const [selectedId, setSelectedId] = useState<AuditId | null>(null);
  const [selectedFinding, setSelectedFinding] = useState<AuditFinding | null>(null);
  const [evidence, setEvidence] = useState<AuditEvidence | null>(null);
  const [error, setError] = useState<FrontendError | null>(null);
  const [mobilePane, setMobilePane] = useState<"activity" | "findings">("findings");
  const [anchorCurrent, setAnchorCurrent] = useState<boolean | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<{ fileId: FileId; line: number } | null>(null);
  const [selectedForAgent, setSelectedForAgent] = useState<Set<FindingId>>(new Set());
  const sequences = useRef(new Map<string, number>());

  const reconcile = async (auditId?: AuditId) => {
    try {
      if (auditId) {
        const session = await backend.getAuditSession(auditId);
        setSessions((items) => {
          const present = items.some((item) => item.audit_id === auditId);
          return present ? items.map((item) => item.audit_id === auditId ? session : item) : [session, ...items];
        });
      } else {
        const values = await backend.listAudits(repoId);
        setSessions(values);
        setSelectedId((current) => current && values.some((item) => item.audit_id === current) ? current : values[0]?.audit_id ?? null);
      }
    } catch (value) {
      setError(normalizeError(value));
    }
  };

  useEffect(() => {
    setSelectedFinding(null);
    setEvidence(null);
    void reconcile();
    // Repository identity, rather than view lifetime, scopes the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForAuditEvents((event) => {
      if (event.repo_id !== repoId) return;
      const prior = sequences.current.get(event.audit_id) ?? 0;
      if (event.sequence <= prior) return;
      sequences.current.set(event.audit_id, event.sequence);
      void reconcile(event.audit_id);
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch((value) => setError(normalizeError(value)));
    return () => { disposed = true; unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const session = sessions.find((item) => item.audit_id === selectedId) ?? sessions[0] ?? null;
  useEffect(() => {
    setSelectedForAgent(new Set());
  }, [session?.audit_id]);
  useEffect(() => {
    if (!session || !active(session.status)) return;
    const refresh = () => void reconcile(session.audit_id);
    const timer = window.setInterval(refresh, 2_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.audit_id, session?.status]);

  const freshness = session?.freshness === "current" && session.snapshot?.generation === generation
    ? "current"
    : session?.freshness === "unknown" ? "unknown" : "repository changed";
  const findings = useMemo(
    () => session?.findings ?? [],
    [session],
  );

  const openFinding = async (finding: AuditFinding) => {
    setSelectedFinding(finding);
    setEvidence(null);
    setAnchorCurrent(null);
    setNavigationTarget(null);
    const evidenceId = finding.evidence_ids[0];
    if (!session || !evidenceId) return;
    try {
      const [captured, navigation] = await Promise.all([
        backend.getAuditEvidence(session.audit_id, evidenceId),
        backend.resolveFindingNavigation(session.audit_id, finding.finding_id),
      ]);
      setEvidence(captured);
      setAnchorCurrent(navigation.anchor_matches_current);
      if (navigation.anchor_matches_current && navigation.file_id) {
        setNavigationTarget({ fileId: navigation.file_id, line: navigation.start_line });
      }
      if (!navigation.anchor_matches_current) {
        setError({ code: "CONTENT_CHANGED_DURING_READ", message: "The current file no longer matches this captured evidence.", retryable: false, repo_id: repoId, operation_id: null });
      }
    } catch (value) {
      setError(normalizeError(value));
    }
  };

  if (!session) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="No audits for this repository"
        detail="Freeze the loaded comparison and run a bounded, read-only static review."
        action={<button className="button button--primary" onClick={onStart}>Audit current work</button>}
      />
    );
  }

  return (
    <section className="audit-workspace" aria-label="AI audit">
      <header className="audit-header">
        <div>
          <span className={`audit-status audit-status--${session.status}`}>
            {active(session.status) ? <LoaderCircle className="spin" size={13} /> : session.status === "completed" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {session.status.replace("_", " ")}
          </span>
          <strong>Immutable audit</strong>
          <code>{session.snapshot?.content_left_oid?.slice(0, 8) ?? "empty"} → {session.snapshot?.content_right_oid?.slice(0, 8) ?? "worktree"}</code>
          <span className={freshness === "current" ? "freshness-current" : "freshness-stale"}>{freshness}</span>
        </div>
        <div className="audit-header__actions">
          <select aria-label="Audit history" value={session.audit_id} onChange={(event) => { setSelectedId(event.target.value as AuditId); setSelectedFinding(null); setEvidence(null); }}>
            {sessions.map((item) => <option key={item.audit_id} value={item.audit_id}>{new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(item.created_at_ms)} · {item.status}</option>)}
          </select>
          {(session.status === "preparing" || session.status === "running") && <button className="button button--danger" onClick={() => void backend.cancelAudit(session.audit_id)}><StopCircle size={14} /> Cancel</button>}
          {session.status === "cancelling" && <button className="button button--danger" disabled><LoaderCircle className="spin" size={14} /> Cancelling…</button>}
          {!active(session.status) && <button className="button button--ghost" onClick={onStart}><RotateCcw size={14} /> New audit</button>}
          {session.status === "completed" && (
            <button
              className="button button--primary"
              disabled={selectedForAgent.size === 0}
              onClick={() => onHandoff?.(session, [...selectedForAgent])}
            >
              <Send size={14} /> Send findings to agent
            </button>
          )}
        </div>
      </header>
      {error && <div className="audit-error"><InlineError error={error} onRetry={() => { setError(null); void reconcile(session.audit_id); }} /></div>}
      <nav className="audit-mobile-tabs" aria-label="Audit detail pane">
        <button className={mobilePane === "activity" ? "is-active" : ""} onClick={() => setMobilePane("activity")}>Activity</button>
        <button className={mobilePane === "findings" ? "is-active" : ""} onClick={() => setMobilePane("findings")}>Findings <span>{findings.length}</span></button>
      </nav>
      <div className="audit-columns">
        <aside className={`audit-activity ${mobilePane === "activity" ? "is-mobile-active" : ""}`}>
          <header>Activity</header>
          <div className="activity-current" aria-live="polite">
            <CircleDot size={14} />
            <span><strong>{session.activity.phase || "queued"}</strong><small>{session.activity.message}</small></span>
          </div>
          <progress value={session.activity.completed_operations} max={Math.max(1, session.activity.max_operations)} />
          <dl>
            <div><dt>Evidence operations</dt><dd>{session.usage.tool_operations} / {session.activity.max_operations}</dd></div>
            <div><dt>Files opened</dt><dd>{session.coverage.files_opened} / {session.coverage.files_considered}</dd></div>
            <div><dt>Evidence returned</dt><dd>{formatBytes(session.usage.evidence_bytes)}</dd></div>
            <div><dt>Tokens</dt><dd>{session.usage.input_tokens + session.usage.output_tokens || "—"}</dd></div>
            <div><dt>Provider</dt><dd>{session.usage.provider} · {session.usage.model}</dd></div>
          </dl>
          {session.coverage.limitations.length > 0 && <section className="audit-limitations"><strong>Limitations</strong>{session.coverage.limitations.map((item) => <p key={item}><AlertTriangle size={12} />{item}</p>)}</section>}
        </aside>
        <section className={`audit-findings ${mobilePane === "findings" ? "is-mobile-active" : ""}`}>
          <header><span>Findings</span><b>{findings.length}</b></header>
          <div className="finding-list">
            {findings.map((finding) => {
              const eligible = session.status === "completed" && finding.lifecycle === "confirmed";
              return (
                <div key={finding.finding_id} className={`finding-row ${selectedFinding?.finding_id === finding.finding_id ? "is-selected" : ""} ${finding.lifecycle === "withdrawn" ? "is-withdrawn" : ""}`}>
                  {eligible && (
                    <label className="finding-select" title="Select finding for remediation">
                      <input
                        type="checkbox"
                        aria-label={`Select ${finding.title} for remediation`}
                        checked={selectedForAgent.has(finding.finding_id)}
                        onChange={(event) => setSelectedForAgent((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(finding.finding_id);
                          else next.delete(finding.finding_id);
                          return next;
                        })}
                      />
                    </label>
                  )}
                  <button onClick={() => void openFinding(finding)}>
                    <span className={`severity-mark severity-mark--${finding.severity}`}>{finding.severity}</span>
                    <strong>{finding.title}</strong>
                    <small>{finding.location.path}:{finding.location.start_line}</small>
                    <span className="finding-state">{finding.lifecycle} · {finding.confidence} confidence</span>
                  </button>
                </div>
              );
            })}
            {!findings.length && <div className="finding-empty"><Ban size={18} /><strong>{active(session.status) ? "Review in progress" : "No findings"}</strong><span>The reviewer did not register a concrete defect.</span></div>}
          </div>
        </section>
        <section className="audit-evidence">
          <header>{selectedFinding ? "Captured evidence" : "Summary"}</header>
          {selectedFinding && evidence ? (
            <>
              <div className="evidence-meta">
                <FileCode2 size={14} />
                <span><strong>{evidence.path}</strong><small>{evidence.side} · lines {evidence.start_line}–{evidence.end_line}</small></span>
                {evidence.redacted && <em>redacted</em>}
                {navigationTarget && <button className="text-button" onClick={() => onNavigate?.(navigationTarget.fileId, navigationTarget.line)}>Open in Changes</button>}
              </div>
              {anchorCurrent === false && <div className="evidence-stale"><AlertTriangle size={13} /> Current source no longer matches this captured anchor. Showing immutable audit evidence.</div>}
              <article className="finding-detail"><h2>{selectedFinding.title}</h2><p>{selectedFinding.body}</p></article>
              <pre className="evidence-source" tabIndex={0} aria-label={`Captured source from ${evidence.path}`}><code>{evidence.content}</code></pre>
            </>
          ) : (
            <div className="audit-summary">
              <strong>{session.conclusion ? "Conclusion" : "Audit scope"}</strong>
              <p>{session.conclusion?.summary ?? session.request.work_description}</p>
              <dl>
                <div><dt>Comparison</dt><dd>{session.snapshot?.mode.replaceAll("_", " ") ?? "freezing"}</dd></div>
                <div><dt>Changed files</dt><dd>{session.snapshot?.changed_files.length ?? "—"}</dd></div>
                <div><dt>Depth</dt><dd>{session.request.depth}</dd></div>
              </dl>
            </div>
          )}
        </section>
      </div>
      <span className="sr-only" aria-live="polite">{session.activity.message}</span>
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
