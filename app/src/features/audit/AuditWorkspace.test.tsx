import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backend } from "../../api/backend";
import type {
  AuditId,
  AuditSession,
  ComparisonId,
  ComparisonResult,
  EvidenceId,
  FileId,
  FindingId,
  RepoId,
  RepositorySnapshot,
} from "../../api/types";
import { AuditSetupDialog } from "./AuditSetupDialog";
import { AuditWorkspace } from "./AuditWorkspace";

vi.mock("../../api/events", () => ({
  listenForAuditEvents: vi.fn(async () => () => undefined),
}));

const repoId = "repo-audit" as RepoId;
const fileId = "file-1" as FileId;
const comparison = {
  comparison_id: "comparison-1" as ComparisonId,
  repo_id: repoId,
  generation: 7,
  mode: "all_uncommitted",
  resolved_left: null,
  resolved_right: null,
  content_left_oid: "1111111111111111111111111111111111111111",
  content_right_oid: null,
  merge_base_oid: null,
  files: [{ file_id: fileId, display_path: "src/audit.rs", old_display_path: null, status: "modified", staged: false, unstaged: true, conflicted: false, submodule: false, similarity: null }],
  totals: { files: 1, added: 0, modified: 1, deleted: 0, renamed: 0, conflicted: 0, lines_added: 1, lines_deleted: 1 },
} satisfies ComparisonResult;

const snapshot = {
  repo_id: repoId,
  generation: 7,
  info: {
    id: repoId,
    display_name: "audit-repo",
    worktree_root: "C:/repo",
    git_dir: "C:/repo/.git",
    git_common_dir: "C:/repo/.git",
    is_shallow: false,
    object_format: "sha1",
    head: { kind: "branch", full_ref: "refs/heads/main", commit_oid: "1111111111111111111111111111111111111111" },
    generation: 7,
  },
  head: { kind: "branch", full_ref: "refs/heads/main", commit_oid: "1111111111111111111111111111111111111111" },
  references: [],
  status: { generation: 7, branch_oid: null, branch_head: "main", entries: [] },
} satisfies RepositorySnapshot;

const session = {
  schema_version: 1,
  audit_id: "audit-1" as AuditId,
  repo_id: repoId,
  request: {
    repo_id: repoId,
    comparison_id: comparison.comparison_id,
    work_description: "Keep comparison immutable",
    acceptance_criteria: "Evidence remains navigable",
    additional_context: "",
    depth: "quick",
  },
  snapshot: {
    repo_id: repoId,
    comparison_id: comparison.comparison_id,
    generation: 7,
    mode: "all_uncommitted",
    resolved_left: null,
    resolved_right: null,
    content_left_oid: comparison.content_left_oid,
    content_right_oid: null,
    merge_base_oid: null,
    changed_files: comparison.files,
    instruction_hashes: [],
    bundle_bytes: 120,
  },
  status: "completed",
  freshness: "current",
  activity: { phase: "complete", message: "Audit completed", completed_operations: 4, max_operations: 40 },
  coverage: { files_considered: 1, files_opened: 1, paths_searched: 0, limitations: [] },
  findings: [{
    finding_id: "finding-1" as FindingId,
    title: "Stale evidence can be mistaken for current code",
    body: "Verify the content anchor before navigating.",
    severity: "medium",
    confidence: "high",
    lifecycle: "confirmed",
    location: { path: "src/audit.rs", side: "new", start_line: 10, end_line: 12 },
    anchor: { sha256: "abc", excerpt: "let stale = true;" },
    evidence_ids: ["evidence-1" as EvidenceId],
  }],
  conclusion: { summary: "One confirmed finding.", success: true },
  usage: { provider: "Codex", model: "Codex account default", input_tokens: 100, output_tokens: 30, evidence_bytes: 120, tool_operations: 4 },
  created_at_ms: 1,
  updated_at_ms: 2,
  error: null,
} satisfies AuditSession;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("audit workflow", () => {
  it("shows the cloud boundary and focuses the first invalid setup field", async () => {
    vi.spyOn(backend, "getAuditProviderSettings").mockResolvedValue({
      configured: true,
      provider: "Codex",
      model: "Codex account default",
      disclosure: "Codex app-server is installed and authenticated.",
      secret_paths: [],
    });
    vi.spyOn(backend, "startAudit").mockResolvedValue(session);
    render(<AuditSetupDialog open snapshot={snapshot} comparison={comparison} onClose={vi.fn()} onStarted={vi.fn()} />);
    expect(await screen.findByText(/reviewed through your signed-in Codex account/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start audit" }));
    const work = screen.getByLabelText(/Work description/);
    expect(work).toHaveFocus();
    fireEvent.change(work, { target: { value: "Audit the immutable comparison" } });
    fireEvent.click(screen.getByRole("button", { name: "Start audit" }));
    const acceptance = screen.getByLabelText(/Acceptance criteria/);
    expect(acceptance).toHaveFocus();
    fireEvent.change(acceptance, { target: { value: "No stale evidence" } });
    fireEvent.click(screen.getByRole("button", { name: "Start audit" }));
    await waitFor(() => expect(backend.startAudit).toHaveBeenCalledOnce());
  });

  it("reconciles authoritative session state and opens verified evidence", async () => {
    vi.spyOn(backend, "listAudits").mockResolvedValue([session]);
    vi.spyOn(backend, "getAuditEvidence").mockResolvedValue({
      evidence_id: "evidence-1" as EvidenceId,
      audit_id: session.audit_id,
      path: "src/audit.rs",
      side: "new",
      start_line: 10,
      end_line: 12,
      content: "let stale = true;",
      sha256: "abc",
      redacted: false,
      truncated: false,
    });
    vi.spyOn(backend, "resolveFindingNavigation").mockResolvedValue({
      audit_id: session.audit_id,
      finding_id: session.findings[0].finding_id,
      path: "src/audit.rs",
      file_id: fileId,
      side: "new",
      start_line: 10,
      end_line: 12,
      anchor_matches_current: true,
      evidence_id: "evidence-1" as EvidenceId,
    });
    render(<AuditWorkspace repoId={repoId} generation={7} onStart={vi.fn()} />);
    const finding = await screen.findByRole("button", { name: /Stale evidence can be mistaken/ });
    fireEvent.click(finding);
    expect(await screen.findByText("let stale = true;")).toBeInTheDocument();
    expect(screen.getByText("confirmed · high confidence")).toBeInTheDocument();
  });

  it("hands off only explicitly selected confirmed findings", async () => {
    vi.spyOn(backend, "listAudits").mockResolvedValue([session]);
    const onHandoff = vi.fn();
    render(<AuditWorkspace repoId={repoId} generation={7} onStart={vi.fn()} onHandoff={onHandoff} />);
    const send = await screen.findByRole("button", { name: "Send findings to agent" });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Select Stale evidence/ }));
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(onHandoff).toHaveBeenCalledWith(session, [session.findings[0].finding_id]);
  });
});
