import { invoke } from "@tauri-apps/api/core";
import type {
  AuditEvidence,
  AuditId,
  AuditProviderSettings,
  AuditProviderTest,
  AuditRequest,
  AuditSession,
  BackendCapabilities,
  ComparisonRequest,
  ComparisonResult,
  FileComparison,
  FileId,
  FrontendError,
  ProjectDefinition,
  RepoId,
  RepositoryInfo,
  RepositorySnapshot,
  ComparisonId,
  EvidenceId,
  FindingId,
  FindingNavigation,
  CodexAvailability,
  RemediationId,
  RemediationSession,
  StartRemediationRequest,
} from "./types";

export interface BackendClient {
  getCapabilities(): Promise<BackendCapabilities>;
  openRepository(path: string): Promise<RepositorySnapshot>;
  closeRepository(repoId: RepoId, allowActiveWork?: boolean): Promise<void>;
  listOpenRepositories(): Promise<RepositoryInfo[]>;
  refreshRepository(repoId: RepoId): Promise<RepositorySnapshot>;
  getRepositorySnapshot(repoId: RepoId): Promise<RepositorySnapshot>;
  createComparison(repoId: RepoId, request: ComparisonRequest): Promise<ComparisonResult>;
  getFileComparison(repoId: RepoId, comparisonId: ComparisonId, fileId: FileId): Promise<FileComparison>;
  pickRepositoryDirectory(): Promise<string | null>;
  loadProjects(): Promise<ProjectDefinition[]>;
  saveProject(project: ProjectDefinition): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export interface AuditBackendClient {
  getAuditProviderSettings(): Promise<AuditProviderSettings>;
  testAuditProvider(): Promise<AuditProviderTest>;
  setAuditSecretPaths(paths: string[]): Promise<void>;
  startAudit(request: AuditRequest): Promise<AuditSession>;
  listAudits(repoId: RepoId): Promise<AuditSession[]>;
  getAuditSession(auditId: AuditId): Promise<AuditSession>;
  cancelAudit(auditId: AuditId): Promise<AuditSession>;
  deleteAudit(auditId: AuditId): Promise<void>;
  getAuditEvidence(auditId: AuditId, evidenceId: EvidenceId): Promise<AuditEvidence>;
  resolveFindingNavigation(auditId: AuditId, findingId: FindingId): Promise<FindingNavigation>;
}

export interface RemediationBackendClient {
  getCodexAvailability(): Promise<CodexAvailability>;
  startRemediation(request: StartRemediationRequest): Promise<RemediationSession>;
  listRemediations(repoId: RepoId): Promise<RemediationSession[]>;
  getRemediationSession(remediationId: RemediationId): Promise<RemediationSession>;
  stopRemediation(remediationId: RemediationId): Promise<RemediationSession>;
  resumeRemediation(remediationId: RemediationId, repoId: RepoId): Promise<RemediationSession>;
  respondRemediationRequest(
    remediationId: RemediationId,
    requestId: string,
    decision?: "approve" | "approve_session" | "deny" | "cancel",
    answers?: Record<string, string[]>,
  ): Promise<RemediationSession>;
}

export function normalizeError(error: unknown): FrontendError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const candidate = error as Partial<FrontendError>;
    return {
      code: candidate.code ?? "IO",
      message: candidate.message ?? "An unexpected local operation failed",
      retryable: candidate.retryable ?? false,
      repo_id: candidate.repo_id ?? null,
      operation_id: candidate.operation_id ?? null,
    };
  }
  return {
    code: "IO",
    // Unknown failures can contain absolute paths or implementation details.
    // Only structured FrontendError payloads cross the presentation boundary.
    message: "An unexpected local operation failed",
    retryable: false,
    repo_id: null,
    operation_id: null,
  };
}

async function call<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw normalizeError(error);
  }
}

export const backend: BackendClient & AuditBackendClient & RemediationBackendClient = {
  getCapabilities: () => call("get_backend_capabilities"),
  openRepository: (path) => call("open_repository", { args: { path } }),
  closeRepository: (repoId, allowActiveWork = false) => call("close_repository", { args: { repo_id: repoId, allow_active_work: allowActiveWork } }),
  listOpenRepositories: () => call("list_open_repositories"),
  refreshRepository: (repoId) => call("refresh_repository", { args: { repo_id: repoId } }),
  getRepositorySnapshot: (repoId) => call("get_repository_snapshot", { args: { repo_id: repoId } }),
  createComparison: (repoId, request) => call("create_comparison", { args: { repo_id: repoId, request } }),
  getFileComparison: (repoId, comparisonId, fileId) =>
    call("get_file_comparison", {
      args: { repo_id: repoId, comparison_id: comparisonId, file_id: fileId },
    }),
  pickRepositoryDirectory: () => call("pick_repository_directory"),
  loadProjects: () => call("load_projects"),
  saveProject: (project) => call("save_project", { args: { project } }),
  deleteProject: (projectId) => call("delete_project", { args: { project_id: projectId } }),
  getAuditProviderSettings: () => call("get_audit_provider_settings"),
  testAuditProvider: () => call("test_audit_provider"),
  setAuditSecretPaths: (paths) =>
    call("set_audit_secret_paths", { args: { paths } }),
  startAudit: (request) => call("start_audit", { args: { request } }),
  listAudits: (repoId) => call("list_audits", { args: { repo_id: repoId } }),
  getAuditSession: (auditId) =>
    call("get_audit_session", { args: { audit_id: auditId } }),
  cancelAudit: (auditId) =>
    call("cancel_audit", { args: { audit_id: auditId } }),
  deleteAudit: (auditId) =>
    call("delete_audit", { args: { audit_id: auditId } }),
  getAuditEvidence: (auditId, evidenceId) =>
    call("get_audit_evidence", {
      args: { audit_id: auditId, evidence_id: evidenceId },
    }),
  resolveFindingNavigation: (auditId, findingId) =>
    call("resolve_finding_navigation", {
      args: { audit_id: auditId, finding_id: findingId },
    }),
  getCodexAvailability: () => call("get_codex_availability"),
  startRemediation: (request) =>
    call("start_remediation", { args: { request } }),
  listRemediations: (repoId) =>
    call("list_remediations", { args: { repo_id: repoId } }),
  getRemediationSession: (remediationId) =>
    call("get_remediation_session", { args: { remediation_id: remediationId } }),
  stopRemediation: (remediationId) =>
    call("stop_remediation", { args: { remediation_id: remediationId } }),
  resumeRemediation: (remediationId, repoId) =>
    call("resume_remediation", {
      args: { remediation_id: remediationId, repo_id: repoId },
    }),
  respondRemediationRequest: (remediationId, requestId, decision, answers = {}) =>
    call("respond_remediation_request", {
      args: {
        remediation_id: remediationId,
        request_id: requestId,
        decision: decision ?? null,
        answers,
      },
    }),
};
