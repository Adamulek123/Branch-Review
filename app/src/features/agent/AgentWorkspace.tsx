import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleStop,
  FileCode2,
  ListChecks,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import { backend, normalizeError } from "../../api/backend";
import { listenForRemediationEvents } from "../../api/events";
import type {
  AgentPendingRequest,
  FrontendError,
  RemediationId,
  RemediationSession,
  RepoId,
} from "../../api/types";
import { EmptyState } from "../../components/EmptyState";
import { InlineError } from "../../components/InlineError";

const active = (status: RemediationSession["status"]) =>
  ["starting", "running", "waiting_approval", "waiting_input", "stopping"].includes(status);

export function AgentWorkspace({
  repoId,
  generation,
  onReturnToChanges,
  onReviewChanges,
}: {
  repoId: RepoId;
  generation: number;
  onReturnToChanges(): void;
  onReviewChanges(): Promise<void>;
}) {
  const [sessions, setSessions] = useState<RemediationSession[]>([]);
  const [selectedId, setSelectedId] = useState<RemediationId | null>(null);
  const [error, setError] = useState<FrontendError | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState(false);
  const [controlBusy, setControlBusy] = useState<"stop" | "resume" | null>(null);
  const [mobilePane, setMobilePane] = useState<"plan" | "timeline" | "result">("timeline");
  const sequences = useRef(new Map<string, number>());

  const reconcile = async (id?: RemediationId) => {
    try {
      if (id) {
        const session = await backend.getRemediationSession(id);
        setSessions((current) => {
          const exists = current.some((item) => item.remediation_id === id);
          return exists
            ? current.map((item) => (item.remediation_id === id ? session : item))
            : [session, ...current];
        });
      } else {
        const current = await backend.listRemediations(repoId);
        setSessions(current);
        setSelectedId((selected) =>
          selected && current.some((item) => item.remediation_id === selected)
            ? selected
            : current[0]?.remediation_id ?? null,
        );
      }
      setError(null);
    } catch (value) {
      setError(normalizeError(value));
    } finally {
      if (!id) setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    void reconcile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void listenForRemediationEvents((event) => {
      if (event.repo_id !== repoId) return;
      const prior = sequences.current.get(event.remediation_id) ?? 0;
      if (event.sequence <= prior) return;
      sequences.current.set(event.remediation_id, event.sequence);
      void reconcile(event.remediation_id);
    }).then((value) => {
      if (disposed) value();
      else cleanup = value;
    }).catch((value) => setError(normalizeError(value)));
    return () => {
      disposed = true;
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  const session =
    sessions.find((item) => item.remediation_id === selectedId) ?? sessions[0] ?? null;
  useEffect(() => {
    if (!session || !active(session.status)) return;
    const poll = () => void reconcile(session.remediation_id);
    const timer = window.setInterval(poll, 2_000);
    window.addEventListener("focus", poll);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.remediation_id, session?.status]);

  if (!session) {
    return (
      <section className="agent-empty-state" aria-label="Remediation agent">
        {error && (
          <InlineError
            error={error}
            onRetry={() => {
              setError(null);
              setLoading(true);
              void reconcile();
            }}
          />
        )}
        <EmptyState
          icon={loading ? LoaderCircle : Bot}
          title={loading ? "Loading agent handoffs…" : "No agent handoffs"}
          detail={error
            ? "Branch Review could not load the repository's agent history. Retry above or return to Audit."
            : "Complete an audit, select confirmed findings, then send them to the built-in agent."}
          action={<button className="button button--primary" onClick={onReturnToChanges}>Return to Audit</button>}
        />
      </section>
    );
  }

  const drifted = session.audit_generation !== generation;
  const reviewChanges = async () => {
    setReviewing(true);
    try {
      await onReviewChanges();
    } catch (value) {
      setError(normalizeError(value));
    } finally {
      setReviewing(false);
    }
  };
  const runControl = async (kind: "stop" | "resume") => {
    setControlBusy(kind);
    setError(null);
    try {
      const updated = kind === "stop"
        ? await backend.stopRemediation(session.remediation_id)
        : await backend.resumeRemediation(session.remediation_id, repoId);
      setSessions((current) =>
        current.map((item) =>
          item.remediation_id === updated.remediation_id ? updated : item
        ),
      );
    } catch (value) {
      const controlError = normalizeError(value);
      await reconcile(session.remediation_id);
      setError(controlError);
    } finally {
      setControlBusy(null);
    }
  };

  return (
    <section className="agent-workspace" aria-label="Remediation agent">
      <header className="agent-header">
        <div className="agent-security-state">
          <Bot size={16} />
          <span>
            <strong>Agent can edit workspace</strong>
            <small><LockKeyhole size={11} /> .git protected · <Network size={11} /> network off</small>
          </span>
        </div>
        <div>
          <span className={`agent-status agent-status--${session.status}`}>
            {active(session.status) ? <LoaderCircle className="spin" size={13} /> : session.status === "completed" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {session.status.replace("_", " ")}
          </span>
          {drifted && <span className="freshness-stale">Workspace changed</span>}
          <select
            aria-label="Agent history"
            value={session.remediation_id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {sessions.map((item) => (
              <option key={item.remediation_id} value={item.remediation_id}>
                {new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(item.created_at_ms)} · {item.status}
              </option>
            ))}
          </select>
          {active(session.status) && (
            <button className="button button--danger" disabled={session.status === "stopping" || controlBusy !== null} onClick={() => void runControl("stop")}>
              <CircleStop size={14} /> {session.status === "stopping" || controlBusy === "stop" ? "Stopping…" : "Stop"}
            </button>
          )}
          {session.status === "disconnected" && (
            <button className="button button--primary" disabled={controlBusy !== null} onClick={() => void runControl("resume")}>
              {controlBusy === "resume" ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} {controlBusy === "resume" ? "Reconnecting…" : "Reconnect"}
            </button>
          )}
          {!active(session.status) && session.status !== "disconnected" && (
            <button className="button button--primary" disabled={reviewing} onClick={() => void reviewChanges()}>
              {reviewing ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} Review agent changes
            </button>
          )}
        </div>
      </header>
      {error && <div className="agent-error"><InlineError error={error} onRetry={() => { setError(null); void reconcile(session.remediation_id); }} /></div>}
      {session.error && <div className="agent-terminal-error"><AlertTriangle size={14} />{session.error}</div>}
      <div className="agent-layout">
        <nav className="agent-mobile-tabs" aria-label="Agent workspace panes">
          {([
            ["plan", "Plan"],
            ["timeline", "Conversation"],
            ["result", "Result"],
          ] as const).map(([pane, label]) => (
            <button
              key={pane}
              type="button"
              className={mobilePane === pane ? "is-active" : ""}
              aria-current={mobilePane === pane ? "page" : undefined}
              aria-controls={`agent-pane-${pane}`}
              onClick={() => setMobilePane(pane)}
            >
              {label}
            </button>
          ))}
        </nav>
        <aside id="agent-pane-plan" className={`agent-pane agent-plan ${mobilePane === "plan" ? "is-mobile-active" : ""}`}>
          <header><ListChecks size={14} />Plan</header>
          {session.plan.length ? (
            <ol>
              {session.plan.map((item, index) => (
                <li key={`${index}-${item.step}`} data-status={item.status}>
                  <span>{index + 1}</span>
                  <div><strong>{item.step}</strong><small>{item.status.replace("_", " ")}</small></div>
                </li>
              ))}
            </ol>
          ) : (
            <p>{active(session.status) ? "Waiting for the agent plan…" : "No structured plan was reported."}</p>
          )}
          <section>
            <strong>Security boundary</strong>
            <dl>
              <div><dt>Sandbox</dt><dd>{session.permission_profile.sandbox}</dd></div>
              <div><dt>Network</dt><dd>{session.permission_profile.network_access ? "enabled" : "off"}</dd></div>
              <div><dt>Approvals</dt><dd>{session.permission_profile.approval_policy}</dd></div>
              <div><dt>Git metadata</dt><dd>{session.permission_profile.git_metadata}</dd></div>
            </dl>
          </section>
        </aside>
        <main id="agent-pane-timeline" className={`agent-pane agent-timeline ${mobilePane === "timeline" ? "is-mobile-active" : ""}`}>
          <header><MessageSquareText size={14} />Conversation and execution</header>
          <div className="agent-pending-list">
            {session.pending_requests.map((request) => (
              <PendingRequestCard
                key={request.request_id}
                sessionId={session.remediation_id}
                request={request}
                onResolved={() => void reconcile(session.remediation_id)}
                onError={(value) => setError(normalizeError(value))}
              />
            ))}
          </div>
          <div className="agent-timeline-list" aria-live="polite">
            {session.timeline.map((entry) => (
              <article key={entry.entry_id} className={`agent-event agent-event--${entry.kind}`}>
                <span className="agent-event__icon">
                  {entry.kind === "command" ? <TerminalSquare size={14} /> : entry.kind === "file_change" ? <FileCode2 size={14} /> : entry.kind === "error" ? <AlertTriangle size={14} /> : entry.kind === "validation" ? <ShieldCheck size={14} /> : <Play size={13} />}
                </span>
                <div>
                  <header><strong>{entry.title}</strong>{entry.status && <span>{entry.status}</span>}</header>
                  {entry.command && <pre><code>{entry.command}</code></pre>}
                  {entry.cwd && <small>cwd: {entry.cwd}</small>}
                  {entry.affected_paths.length > 0 && <ul>{entry.affected_paths.map((path) => <li key={path}>{path}</li>)}</ul>}
                  {entry.detail && <p>{entry.detail}</p>}
                </div>
              </article>
            ))}
          </div>
        </main>
        <aside id="agent-pane-result" className={`agent-pane agent-summary ${mobilePane === "result" ? "is-mobile-active" : ""}`}>
          <header>Result</header>
          <dl>
            <div><dt>Audit</dt><dd><code>{session.audited_revision.slice(0, 12)}</code></dd></div>
            <div><dt>Findings handed off</dt><dd>{session.finding_ids.length}</dd></div>
            <div><dt>Thread</dt><dd><code>{session.codex_thread_id?.slice(0, 12) ?? "starting"}</code></dd></div>
          </dl>
          <section>
            <strong>Validation reported</strong>
            {session.validation.length ? <ul>{session.validation.map((item) => <li key={item}>{item}</li>)}</ul> : <p>No validation result has been reported yet.</p>}
          </section>
          <section>
            <strong>Limitations</strong>
            <ul>{session.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </section>
          {!active(session.status) && (
            <p className="agent-result-note">
              Stopping is not proof of success. Review current workspace changes and the validation above.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function PendingRequestCard({
  sessionId,
  request,
  onResolved,
  onError,
}: {
  sessionId: RemediationId;
  request: AgentPendingRequest;
  onResolved(): void;
  onError(value: unknown): void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherAnswers, setOtherAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const otherValue = "__branch_review_other__";
  const answerFor = (id: string) =>
    answers[id] === otherValue ? otherAnswers[id] ?? "" : answers[id] ?? "";
  const respond = async (
    decision?: "approve" | "approve_session" | "deny" | "cancel",
  ) => {
    try {
      setBusy(true);
      const mapped = Object.fromEntries(
        request.questions.map((question) => [question.id, [answerFor(question.id)]]),
      );
      await backend.respondRemediationRequest(
        sessionId,
        request.request_id,
        decision,
        mapped,
      );
      onResolved();
    } catch (value) {
      onError(value);
    } finally {
      setBusy(false);
    }
  };
  const isQuestion = request.kind === "question";
  const ready = !isQuestion || request.questions.every((question) => answerFor(question.id).trim());
  return (
    <section className={`agent-request agent-request--${request.kind}`}>
      <header>
        {request.kind === "network" ? <Network size={15} /> : request.kind === "command" ? <TerminalSquare size={15} /> : request.kind === "file_change" ? <FileCode2 size={15} /> : <MessageSquareText size={15} />}
        <strong>{request.title}</strong>
      </header>
      <p>{request.detail}</p>
      {request.command && <pre><code>{request.command}</code></pre>}
      {request.cwd && <small>cwd: {request.cwd}</small>}
      {request.network_target && <div className="network-target"><Network size={12} />{request.network_target}</div>}
      {request.affected_paths.length > 0 && <ul>{request.affected_paths.map((path) => <li key={path}>{path}</li>)}</ul>}
      {request.blocked_reason && <div className="network-denied">{request.blocked_reason}</div>}
      {request.questions.map((question) => (
        <div className="field" key={question.id}>
          <label htmlFor={`agent-question-${request.request_id}-${question.id}`}>{question.header}</label>
          <small>{question.question}</small>
          {question.options.length ? (
            <select
              id={`agent-question-${request.request_id}-${question.id}`}
              value={answers[question.id] ?? ""}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            >
              <option value="">Select an answer…</option>
              {question.options.map((option) => <option key={option.label} value={option.label}>{option.label} — {option.description}</option>)}
              {question.is_other && <option value={otherValue}>Other — enter a custom answer</option>}
            </select>
          ) : (
            <input
              id={`agent-question-${request.request_id}-${question.id}`}
              type={question.secret ? "password" : "text"}
              autoComplete="off"
              value={answers[question.id] ?? ""}
              onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          )}
          {question.is_other && answers[question.id] === otherValue && (
            <input
              type={question.secret ? "password" : "text"}
              autoComplete="off"
              aria-label={`${question.header} custom answer`}
              value={otherAnswers[question.id] ?? ""}
              onChange={(event) => setOtherAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
            />
          )}
        </div>
      ))}
      <footer>
        {isQuestion ? (
          <button className="button button--primary" disabled={!ready || busy} onClick={() => void respond()}>
            Submit answers
          </button>
        ) : (
          <>
            <button className="button button--primary" disabled={busy || !request.approval_allowed} onClick={() => void respond("approve")}>Approve once</button>
            <button className="button button--ghost" disabled={busy || !request.approval_allowed} onClick={() => void respond("approve_session")}>Approve for session</button>
            <button className="button button--danger" disabled={busy} onClick={() => void respond("deny")}>Deny</button>
          </>
        )}
        {!request.approval_allowed && <span className="network-denied">This request can only be denied.</span>}
      </footer>
    </section>
  );
}
