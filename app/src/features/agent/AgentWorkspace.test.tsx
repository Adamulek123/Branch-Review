import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../api/backend";
import type { AuditId, FindingId, RemediationSession, RepoId } from "../../api/types";
import { AgentWorkspace } from "./AgentWorkspace";

vi.mock("../../api/events", () => ({
  listenForRemediationEvents: vi.fn(async () => () => undefined),
}));

const repoId = "repo-agent" as RepoId;
const session = {
  schema_version: 1,
  remediation_id: "remediation-1",
  repo_id: repoId,
  audit_id: "audit-1" as AuditId,
  finding_ids: ["finding-1" as FindingId],
  codex_thread_id: "019fake-thread",
  turn_id: "019fake-turn",
  status: "waiting_approval",
  permission_profile: {
    sandbox: "workspace-write",
    writable_root: "C:/repo",
    network_access: false,
    web_search: false,
    approval_policy: "on-request",
    git_metadata: "protected / read-only",
  },
  audited_revision: "1111111111111111111111111111111111111111",
  audit_generation: 7,
  timeline: [{
    entry_id: "entry-1",
    kind: "command",
    title: "Command started",
    detail: "",
    status: "in_progress",
    command: "pnpm test",
    cwd: "C:/repo/app",
    affected_paths: [],
    created_at_ms: 1,
  }],
  plan: [{ step: "Revalidate the finding", status: "in_progress" }],
  pending_requests: [{
    request_id: "request-1",
    kind: "command",
    title: "Command approval",
    detail: "Run the focused tests.",
    command: "pnpm test",
    cwd: "C:/repo/app",
    affected_paths: [],
    network_target: null,
    questions: [],
    approval_allowed: true,
    blocked_reason: null,
    created_at_ms: 2,
  }],
  validation: [],
  limitations: ["No commit or push is permitted."],
  created_at_ms: 1,
  updated_at_ms: 2,
  error: null,
} satisfies RemediationSession;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("agent workspace", () => {
  it("shows initial history failures with a working retry", async () => {
    const failure = {
      code: "IO" as const,
      message: "Agent history could not be loaded",
      retryable: true,
      repo_id: repoId,
      operation_id: null,
    };
    vi.spyOn(backend, "listRemediations")
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce([]);
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(failure.message);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(backend.listRemediations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No agent handoffs")).toBeInTheDocument();
  });

  it("shows exact permissions and routes approval decisions to the backend", async () => {
    vi.spyOn(backend, "listRemediations").mockResolvedValue([session]);
    vi.spyOn(backend, "respondRemediationRequest").mockResolvedValue({
      ...session,
      status: "running",
      pending_requests: [],
    });
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    expect(await screen.findByText("Agent can edit workspace")).toBeInTheDocument();
    expect(screen.getByText(/network off/, { selector: "small" })).toBeInTheDocument();
    expect(screen.getAllByText("pnpm test").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Approve once" }));
    await waitFor(() =>
      expect(backend.respondRemediationRequest).toHaveBeenCalledWith(
        "remediation-1",
        "request-1",
        "approve",
        {},
      ),
    );
  });

  it("never offers an approval control for a denied-by-default network request", async () => {
    vi.spyOn(backend, "listRemediations").mockResolvedValue([{
      ...session,
      pending_requests: [{
        ...session.pending_requests[0],
        kind: "network",
        network_target: "api.example.com",
        approval_allowed: false,
        blocked_reason: "Network access is disabled.",
      }],
    }]);
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={8}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    expect(await screen.findByText("api.example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve once" })).toBeDisabled();
    expect(screen.getByText(/can only be denied/)).toBeInTheDocument();
    expect(screen.getByText("Workspace changed")).toBeInTheDocument();
  });

  it("makes every narrow-layout pane reachable with native tab controls", async () => {
    vi.spyOn(backend, "listRemediations").mockResolvedValue([session]);
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    await screen.findByText("Agent can edit workspace");
    const plan = screen.getByRole("button", { name: "Plan" });
    const conversation = screen.getByRole("button", { name: "Conversation" });
    const result = screen.getByRole("button", { name: "Result" });
    expect(conversation).toHaveAttribute("aria-current", "page");
    fireEvent.click(plan);
    expect(plan).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("#agent-pane-plan")).toHaveClass("is-mobile-active");
    fireEvent.click(result);
    expect(result).toHaveAttribute("aria-current", "page");
    expect(document.querySelector("#agent-pane-result")).toHaveClass("is-mobile-active");
    expect(screen.getByText("Validation reported")).toBeInTheDocument();
  });

  it("surfaces Stop failures and reconciles authoritative state", async () => {
    vi.spyOn(backend, "listRemediations").mockResolvedValue([session]);
    vi.spyOn(backend, "stopRemediation").mockRejectedValue({
      code: "IO",
      message: "Agent could not be stopped",
      retryable: true,
      repo_id: repoId,
      operation_id: null,
    });
    vi.spyOn(backend, "getRemediationSession").mockResolvedValue(session);
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Agent could not be stopped");
    expect(backend.getRemediationSession).toHaveBeenCalledWith("remediation-1");
  });

  it("surfaces reconnect failures instead of leaving an unhandled promise", async () => {
    const disconnected = { ...session, status: "disconnected" as const };
    vi.spyOn(backend, "listRemediations").mockResolvedValue([disconnected]);
    vi.spyOn(backend, "resumeRemediation").mockRejectedValue({
      code: "IO",
      message: "Codex app-server could not reconnect",
      retryable: true,
      repo_id: repoId,
      operation_id: null,
    });
    vi.spyOn(backend, "getRemediationSession").mockResolvedValue(disconnected);
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Codex app-server could not reconnect",
    );
    expect(backend.resumeRemediation).toHaveBeenCalledWith("remediation-1", repoId);
  });

  it("submits a custom Other answer from request_user_input", async () => {
    const questionSession: RemediationSession = {
      ...session,
      status: "waiting_input",
      pending_requests: [{
        request_id: "question-1",
        kind: "question",
        title: "Agent question",
        detail: "Choose a strategy.",
        command: null,
        cwd: null,
        affected_paths: [],
        network_target: null,
        questions: [{
          id: "strategy",
          header: "Strategy",
          question: "How should this be handled?",
          options: [{ label: "Focused", description: "Change only the failing path." }],
          is_other: true,
          secret: false,
        }],
        approval_allowed: true,
        blocked_reason: null,
        created_at_ms: 2,
      }],
    };
    vi.spyOn(backend, "listRemediations").mockResolvedValue([questionSession]);
    vi.spyOn(backend, "respondRemediationRequest").mockResolvedValue({
      ...questionSession,
      status: "running",
      pending_requests: [],
    });
    render(
      <AgentWorkspace
        repoId={repoId}
        generation={7}
        onReturnToChanges={vi.fn()}
        onReviewChanges={vi.fn()}
      />,
    );
    const select = await screen.findByLabelText("Strategy");
    fireEvent.change(select, { target: { value: "__branch_review_other__" } });
    fireEvent.change(screen.getByLabelText("Strategy custom answer"), {
      target: { value: "Use a migration-safe fallback" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() =>
      expect(backend.respondRemediationRequest).toHaveBeenCalledWith(
        "remediation-1",
        "question-1",
        undefined,
        { strategy: ["Use a migration-safe fallback"] },
      ),
    );
  });
});
