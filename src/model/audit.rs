use super::{
    ChangedFile, ComparisonId, ComparisonMode, FileComparison, FileId, RepoId,
    ResolvedRevisionSummary,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

macro_rules! audit_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4().to_string())
            }
        }
    };
}

audit_id!(AuditId);
audit_id!(EvidenceId);
audit_id!(FindingId);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditDepth {
    Quick,
    Thorough,
}

impl AuditDepth {
    pub fn max_seconds(self) -> u64 {
        match self {
            Self::Quick => 5 * 60,
            Self::Thorough => 20 * 60,
        }
    }
    pub fn max_operations(self) -> u32 {
        match self {
            Self::Quick => 40,
            Self::Thorough => 160,
        }
    }
    pub fn max_evidence_bytes(self) -> u64 {
        match self {
            Self::Quick => 2 * 1024 * 1024,
            Self::Thorough => 12 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditRequest {
    pub repo_id: RepoId,
    pub comparison_id: ComparisonId,
    pub work_description: String,
    pub acceptance_criteria: String,
    pub additional_context: String,
    pub depth: AuditDepth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSnapshot {
    pub repo_id: RepoId,
    pub comparison_id: ComparisonId,
    pub generation: u64,
    pub mode: ComparisonMode,
    pub resolved_left: Option<ResolvedRevisionSummary>,
    pub resolved_right: Option<ResolvedRevisionSummary>,
    pub content_left_oid: Option<String>,
    pub content_right_oid: Option<String>,
    pub merge_base_oid: Option<String>,
    pub changed_files: Vec<ChangedFile>,
    pub instruction_hashes: Vec<InstructionHash>,
    pub bundle_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstructionHash {
    pub path: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditStatus {
    Preparing,
    Running,
    Cancelling,
    Cancelled,
    Completed,
    Incomplete,
    Failed,
}

impl AuditStatus {
    pub fn is_active(self) -> bool {
        matches!(self, Self::Preparing | Self::Running | Self::Cancelling)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditFreshness {
    Current,
    RepositoryChanged,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Critical,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingLifecycle {
    Provisional,
    Confirmed,
    Withdrawn,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingLocation {
    pub path: String,
    pub side: AuditFileSide,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditFileSide {
    Old,
    New,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingAnchor {
    pub sha256: String,
    pub excerpt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditFinding {
    pub finding_id: FindingId,
    pub title: String,
    pub body: String,
    pub severity: FindingSeverity,
    pub confidence: FindingConfidence,
    pub lifecycle: FindingLifecycle,
    pub location: FindingLocation,
    pub anchor: FindingAnchor,
    pub evidence_ids: Vec<EvidenceId>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditActivity {
    pub phase: String,
    pub message: String,
    pub completed_operations: u32,
    pub max_operations: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditCoverage {
    pub files_considered: usize,
    pub files_opened: usize,
    pub paths_searched: usize,
    pub limitations: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct AuditUsage {
    pub provider: String,
    pub model: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub evidence_bytes: u64,
    pub tool_operations: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditConclusion {
    pub summary: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditSession {
    pub schema_version: u32,
    pub audit_id: AuditId,
    pub repo_id: RepoId,
    pub request: AuditRequest,
    pub snapshot: Option<AuditSnapshot>,
    pub status: AuditStatus,
    pub freshness: AuditFreshness,
    pub activity: AuditActivity,
    pub coverage: AuditCoverage,
    pub findings: Vec<AuditFinding>,
    pub conclusion: Option<AuditConclusion>,
    pub usage: AuditUsage,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvidence {
    pub evidence_id: EvidenceId,
    pub audit_id: AuditId,
    pub path: String,
    pub side: AuditFileSide,
    pub start_line: u32,
    pub end_line: u32,
    pub content: String,
    pub sha256: String,
    pub redacted: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FindingNavigation {
    pub audit_id: AuditId,
    pub finding_id: FindingId,
    pub path: String,
    pub file_id: Option<FileId>,
    pub side: AuditFileSide,
    pub start_line: u32,
    pub end_line: u32,
    pub anchor_matches_current: bool,
    pub evidence_id: EvidenceId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuditEventKind {
    SessionUpdated { status: AuditStatus },
    Activity { phase: String, message: String },
    FindingChanged { finding_id: FindingId },
    EvidenceAdded { evidence_id: EvidenceId },
    Terminal { status: AuditStatus },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub schema_version: u32,
    pub audit_id: AuditId,
    pub repo_id: RepoId,
    pub sequence: u64,
    #[serde(flatten)]
    pub event: AuditEventKind,
}

/// Internal, trusted capture returned by the repository registry. The
/// worktree root is never serialized across the frontend boundary.
#[derive(Debug, Clone)]
pub struct AuditCapture {
    pub snapshot: AuditSnapshot,
    pub files: Vec<CapturedAuditFile>,
    pub instructions: Vec<CapturedInstruction>,
    pub context: Vec<CapturedContextFile>,
    pub worktree_root: PathBuf,
    pub git_common_dir: PathBuf,
    pub git_common_dir_identity: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedAuditFile {
    pub file_id: FileId,
    pub path: String,
    pub old_path: Option<String>,
    pub comparison: FileComparison,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedInstruction {
    pub path: String,
    pub content: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapturedContextFile {
    pub path: String,
    pub content: super::FileContent,
}
