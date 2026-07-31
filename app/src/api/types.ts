export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type RepoId = Brand<string, "RepoId">;
export type RefId = Brand<string, "RefId">;
export type FileId = Brand<string, "FileId">;
export type ComparisonId = Brand<string, "ComparisonId">;
export type AuditId = Brand<string, "AuditId">;
export type EvidenceId = Brand<string, "EvidenceId">;
export type FindingId = Brand<string, "FindingId">;

export type ObjectFormat = "sha1" | "sha256" | "unknown";
export type HeadState =
  | { kind: "branch"; full_ref: string; commit_oid: string }
  | { kind: "detached"; commit_oid: string }
  | { kind: "unborn"; full_ref: string | null };

export type ReferenceKind = "local_branch" | "remote_branch";
export interface GitReference {
  id: RefId;
  full_name: string;
  display_name: string;
  kind: ReferenceKind;
  commit_oid: string;
  upstream_full_name: string | null;
  is_head: boolean;
  checked_out_worktree: string | null;
}

export type ChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "type_changed"
  | "unmerged"
  | "untracked"
  | "unknown";

export interface StatusEntry {
  file_id: FileId;
  display_path: string;
  old_display_path: string | null;
  status: ChangeKind;
  index_status: string | null;
  worktree_status: string | null;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  submodule: boolean;
  similarity: number | null;
  head_mode: string | null;
  index_mode: string | null;
  worktree_mode: string | null;
  head_oid: string | null;
  index_oid: string | null;
}

export interface WorkingTreeStatus {
  generation: number;
  branch_oid: string | null;
  branch_head: string | null;
  entries: StatusEntry[];
}

export interface RepositoryInfo {
  id: RepoId;
  display_name: string;
  worktree_root: string;
  git_dir: string;
  git_common_dir: string;
  is_shallow: boolean;
  object_format: ObjectFormat;
  head: HeadState;
  generation: number;
}

export interface RepositorySnapshot {
  repo_id: RepoId;
  generation: number;
  info: RepositoryInfo;
  head: HeadState;
  references: GitReference[];
  status: WorkingTreeStatus;
}

export interface BackendCapabilities {
  api_version: number;
  git_version: string;
  supports_sha256: boolean;
  max_metadata_bytes: number;
  max_file_bytes: number;
}

export type ComparisonMode =
  | "direct"
  | "since_merge_base"
  | "unstaged"
  | "staged"
  | "all_uncommitted";

export type ComparisonRequest =
  | { mode: "direct"; left: RefId; right: RefId }
  | { mode: "since_merge_base"; left: RefId; right: RefId }
  | { mode: "unstaged" }
  | { mode: "staged" }
  | { mode: "all_uncommitted" };

export interface ChangedFile {
  file_id: FileId;
  display_path: string;
  old_display_path: string | null;
  status: ChangeKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
  submodule: boolean;
  similarity: number | null;
}

export interface ChangeTotals {
  files: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  conflicted: number;
  lines_added: number;
  lines_deleted: number;
}

export interface ResolvedRevisionSummary {
  display_name: string;
  commit_oid: string;
}

export interface ComparisonResult {
  comparison_id: ComparisonId;
  repo_id: RepoId;
  generation: number;
  mode: ComparisonMode;
  resolved_left: ResolvedRevisionSummary | null;
  resolved_right: ResolvedRevisionSummary | null;
  content_left_oid: string | null;
  content_right_oid: string | null;
  merge_base_oid: string | null;
  files: ChangedFile[];
  totals: ChangeTotals;
}

export type FileContent =
  | { kind: "text"; text: string; encoding: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too_large"; size: number; limit: number }
  | { kind: "missing" }
  | { kind: "symlink"; target: string }
  | { kind: "submodule"; commit_oid: string | null }
  | { kind: "unsupported_encoding"; size: number };

export type FileSourceSummary =
  | { kind: "commit"; commit_oid: string }
  | { kind: "index" }
  | { kind: "worktree" }
  | { kind: "empty" }
  | { kind: "conflict_stage"; stage: number }
  | { kind: "submodule" };

export interface FileSide {
  label: string;
  source: FileSourceSummary;
  content: FileContent;
}

export interface FileComparison {
  repo_id: RepoId;
  comparison_id: ComparisonId;
  file_id: FileId;
  generation: number;
  left: FileSide;
  right: FileSide;
}

export type AuditDepth = "quick" | "thorough";
export type AuditStatus = "preparing" | "running" | "cancelling" | "cancelled" | "completed" | "incomplete" | "failed";
export type AuditFreshness = "current" | "repository_changed" | "unknown";
export type AuditFileSide = "old" | "new";
export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingConfidence = "high" | "medium" | "low";
export type FindingLifecycle = "provisional" | "confirmed" | "withdrawn";

export interface AuditRequest {
  repo_id: RepoId;
  comparison_id: ComparisonId;
  work_description: string;
  acceptance_criteria: string;
  additional_context: string;
  depth: AuditDepth;
}

export interface AuditSnapshot {
  repo_id: RepoId;
  comparison_id: ComparisonId;
  generation: number;
  mode: ComparisonMode;
  resolved_left: ResolvedRevisionSummary | null;
  resolved_right: ResolvedRevisionSummary | null;
  content_left_oid: string | null;
  content_right_oid: string | null;
  merge_base_oid: string | null;
  changed_files: ChangedFile[];
  instruction_hashes: { path: string; sha256: string }[];
  bundle_bytes: number;
}

export interface AuditActivity {
  phase: string;
  message: string;
  completed_operations: number;
  max_operations: number;
}

export interface AuditCoverage {
  files_considered: number;
  files_opened: number;
  paths_searched: number;
  limitations: string[];
}

export interface AuditUsage {
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  evidence_bytes: number;
  tool_operations: number;
}

export interface AuditFinding {
  finding_id: FindingId;
  title: string;
  body: string;
  severity: FindingSeverity;
  confidence: FindingConfidence;
  lifecycle: FindingLifecycle;
  location: { path: string; side: AuditFileSide; start_line: number; end_line: number };
  anchor: { sha256: string; excerpt: string };
  evidence_ids: EvidenceId[];
}

export interface AuditSession {
  schema_version: number;
  audit_id: AuditId;
  repo_id: RepoId;
  request: AuditRequest;
  snapshot: AuditSnapshot | null;
  status: AuditStatus;
  freshness: AuditFreshness;
  activity: AuditActivity;
  coverage: AuditCoverage;
  findings: AuditFinding[];
  conclusion: { summary: string; success: boolean } | null;
  usage: AuditUsage;
  created_at_ms: number;
  updated_at_ms: number;
  error: string | null;
}

export interface AuditEvidence {
  evidence_id: EvidenceId;
  audit_id: AuditId;
  path: string;
  side: AuditFileSide;
  start_line: number;
  end_line: number;
  content: string;
  sha256: string;
  redacted: boolean;
  truncated: boolean;
}

export interface FindingNavigation {
  audit_id: AuditId;
  finding_id: FindingId;
  path: string;
  file_id: FileId | null;
  side: AuditFileSide;
  start_line: number;
  end_line: number;
  anchor_matches_current: boolean;
  evidence_id: EvidenceId;
}

export interface AuditProviderSettings {
  configured: boolean;
  provider: string;
  model: string;
  disclosure: string;
  secret_paths: string[];
}

export interface AuditProviderTest {
  ok: boolean;
  message: string;
}

export type AuditEvent =
  | { schema_version: number; audit_id: AuditId; repo_id: RepoId; sequence: number; kind: "session_updated"; status: AuditStatus }
  | { schema_version: number; audit_id: AuditId; repo_id: RepoId; sequence: number; kind: "activity"; phase: string; message: string }
  | { schema_version: number; audit_id: AuditId; repo_id: RepoId; sequence: number; kind: "finding_changed"; finding_id: FindingId }
  | { schema_version: number; audit_id: AuditId; repo_id: RepoId; sequence: number; kind: "evidence_added"; evidence_id: EvidenceId }
  | { schema_version: number; audit_id: AuditId; repo_id: RepoId; sequence: number; kind: "terminal"; status: AuditStatus };

export type RemediationId = string;
export type RemediationStatus =
  | "starting"
  | "running"
  | "waiting_approval"
  | "waiting_input"
  | "stopping"
  | "interrupted"
  | "completed"
  | "failed"
  | "disconnected";
export type AgentRequestKind = "command" | "file_change" | "network" | "question";
export type AgentTimelineKind =
  | "system"
  | "agent_message"
  | "plan"
  | "command"
  | "file_change"
  | "validation"
  | "error";

export interface CodexAvailability {
  installed: boolean;
  app_server_supported: boolean;
  authenticated: boolean;
  version: string | null;
  message: string;
}

export interface StartRemediationRequest {
  repo_id: RepoId;
  audit_id: AuditId;
  finding_ids: FindingId[];
}

export interface AgentPermissionProfile {
  sandbox: string;
  writable_root: string;
  network_access: boolean;
  web_search: boolean;
  approval_policy: string;
  git_metadata: string;
}

export interface AgentTimelineEntry {
  entry_id: string;
  kind: AgentTimelineKind;
  title: string;
  detail: string;
  status: string | null;
  command: string | null;
  cwd: string | null;
  affected_paths: string[];
  created_at_ms: number;
}

export interface AgentPlanItem {
  step: string;
  status: string;
}

export interface AgentQuestion {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
  is_other: boolean;
  secret: boolean;
}

export interface AgentPendingRequest {
  request_id: string;
  kind: AgentRequestKind;
  title: string;
  detail: string;
  command: string | null;
  cwd: string | null;
  affected_paths: string[];
  network_target: string | null;
  questions: AgentQuestion[];
  approval_allowed: boolean;
  blocked_reason: string | null;
  created_at_ms: number;
}

export interface RemediationSession {
  schema_version: number;
  remediation_id: RemediationId;
  repo_id: RepoId;
  audit_id: AuditId;
  finding_ids: FindingId[];
  codex_thread_id: string | null;
  turn_id: string | null;
  status: RemediationStatus;
  permission_profile: AgentPermissionProfile;
  audited_revision: string;
  audit_generation: number;
  timeline: AgentTimelineEntry[];
  plan: AgentPlanItem[];
  pending_requests: AgentPendingRequest[];
  validation: string[];
  limitations: string[];
  created_at_ms: number;
  updated_at_ms: number;
  error: string | null;
}

export interface RemediationEvent {
  schema_version: number;
  remediation_id: RemediationId;
  repo_id: RepoId;
  sequence: number;
  status: RemediationStatus;
}

export type ErrorCode =
  | "GIT_NOT_FOUND"
  | "UNSUPPORTED_GIT"
  | "PATH_NOT_FOUND"
  | "NOT_DIRECTORY"
  | "NOT_REPOSITORY"
  | "BARE_REPOSITORY_UNSUPPORTED"
  | "UNSAFE_REPOSITORY"
  | "PERMISSION_DENIED"
  | "REPOSITORY_CLOSED"
  | "INVALID_REPOSITORY_ID"
  | "INVALID_REFERENCE_ID"
  | "REFERENCE_MOVED_OR_DELETED"
  | "UNBORN_HEAD"
  | "NO_MERGE_BASE"
  | "INVALID_FILE_ID"
  | "INVALID_COMPARISON_ID"
  | "FILE_OUTSIDE_REPOSITORY"
  | "CONTENT_MISSING"
  | "CONTENT_TOO_LARGE"
  | "BINARY_CONTENT"
  | "UNSUPPORTED_ENCODING"
  | "CONTENT_CHANGED_DURING_READ"
  | "GIT_TIMED_OUT"
  | "GIT_CANCELLED"
  | "GIT_OUTPUT_TOO_LARGE"
  | "GIT_COMMAND_FAILED"
  | "MALFORMED_GIT_OUTPUT"
  | "WATCHER_UNAVAILABLE"
  | "STALE_GENERATION"
  | "IO";

export interface FrontendError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  repo_id: string | null;
  operation_id: string | null;
}

export type ProjectLayout = "tabs" | "columns" | "cards";
export type SavedComparisonMode = ComparisonMode;
export interface SavedComparisonPreference {
  mode: SavedComparisonMode;
  left_full_ref: string | null;
  right_full_ref: string | null;
}
export interface ProjectRepositoryDefinition {
  project_repo_id: string;
  display_name: string;
  path: string;
  display_order: number;
  default_comparison: SavedComparisonPreference | null;
}
export interface ProjectDefinition {
  schema_version: number;
  project_id: string;
  name: string;
  repositories: ProjectRepositoryDefinition[];
  layout: ProjectLayout;
}

export interface RepositoryUpdatedPayload {
  repo_id: RepoId;
  generation: number;
}

export interface RuntimeRepository {
  projectRepoId: string;
  repoId: RepoId | null;
  generation: number;
  opening: boolean;
  error: FrontendError | null;
}
