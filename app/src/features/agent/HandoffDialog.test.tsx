import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../api/backend";
import type {
  AuditId,
  AuditSession,
  ComparisonId,
  EvidenceId,
  FindingId,
  RepoId,
} from "../../api/types";
import { HandoffDialog } from "./HandoffDialog";

const repoId = "repo-handoff" as RepoId;
const findingId = "finding-handoff" as FindingId;
const audit = {
  schema_version: 1,
  audit_id: "audit-handoff" as AuditId,
  repo_id: repoId,
  request: {
    repo_id: repoId,
    comparison_id: "comparison-handoff" as ComparisonId,
    work_description: "Fix the audited work",
    acceptance_criteria: "Tests pass",
    additional_context: "",
    depth: "quick",
  },
  snapshot: {
    repo_id: repoId,
    comparison_id: "comparison-handoff" as ComparisonId,
    generation: 4,
    mode: "all_uncommitted",
    resolved_left: null,
    resolved_right: null,
    content_left_oid: "1111111111111111111111111111111111111111",
    content_right_oid: null,
    merge_base_oid: null,
    changed_files: [],
    instruction_hashes: [],
    bundle_bytes: 100,
  },
  status: "completed",
  freshness: "current",
  activity: { phase: "complete", message: "Done", completed_operations: 1, max_operations: 40 },
  coverage: { files_considered: 1, files_opened: 1, paths_searched: 0, limitations: [] },
  findings: [{
    finding_id: findingId,
    title: "A confirmed defect",
    body: "Revalidate it.",
    severity: "high",
    confidence: "high",
    lifecycle: "confirmed",
    location: { path: "src/lib.rs", side: "new", start_line: 8, end_line: 9 },
    anchor: { sha256: "abc", excerpt: "broken()" },
    evidence_ids: ["evidence-handoff" as EvidenceId],
  }],
  conclusion: { summary: "One finding", success: true },
  usage: { provider: "Codex", model: "Codex account default", input_tokens: 1, output_tokens: 1, evidence_bytes: 10, tool_operations: 1 },
  created_at_ms: 1,
  updated_at_ms: 2,
  error: null,
} satisfies AuditSession;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("agent handoff confirmation", () => {
  it("discloses drift and exact permissions before starting a fresh thread", async () => {
    vi.spyOn(backend, "getCodexAvailability").mockResolvedValue({
      installed: true,
      app_server_supported: true,
      authenticated: true,
      version: "codex-cli 0.145.0",
      message: "Ready",
    });
    vi.spyOn(backend, "startRemediation").mockResolvedValue({} as never);
    const onStarted = vi.fn();
    render(
      <HandoffDialog
        open
        repoId={repoId}
        generation={5}
        selection={{ audit, findingIds: [findingId] }}
        onClose={vi.fn()}
        onStarted={onStarted}
      />,
    );
    expect(await screen.findByText(/Changed since audit/)).toBeInTheDocument();
    expect(screen.getByText(/Workspace write/)).toBeInTheDocument();
    expect(screen.getByText(/Network off/)).toBeInTheDocument();
    expect(screen.getByText(/\.git/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start agent" }));
    await waitFor(() =>
      expect(backend.startRemediation).toHaveBeenCalledWith({
        repo_id: repoId,
        audit_id: audit.audit_id,
        finding_ids: [findingId],
      }),
    );
    expect(onStarted).toHaveBeenCalledOnce();
  });

  it("blocks start when Codex is missing or signed out", async () => {
    vi.spyOn(backend, "getCodexAvailability").mockResolvedValue({
      installed: false,
      app_server_supported: false,
      authenticated: false,
      version: null,
      message: "Install Codex and sign in.",
    });
    render(
      <HandoffDialog
        open
        repoId={repoId}
        generation={4}
        selection={{ audit, findingIds: [findingId] }}
        onClose={vi.fn()}
        onStarted={vi.fn()}
      />,
    );
    expect(await screen.findByText("Install Codex and sign in.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start agent" })).toBeDisabled();
  });
});
