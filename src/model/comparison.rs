use super::{ChangeKind, ComparisonId, FileId, RefId, RepoId, ResolvedRevisionSummary};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ComparisonRequest {
    Direct { left: RefId, right: RefId },
    SinceMergeBase { left: RefId, right: RefId },
    Unstaged,
    Staged,
    AllUncommitted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonMode {
    Direct,
    SinceMergeBase,
    Unstaged,
    Staged,
    AllUncommitted,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangedFile {
    pub file_id: FileId,
    pub display_path: String,
    pub old_display_path: Option<String>,
    pub status: ChangeKind,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
    pub submodule: bool,
    pub similarity: Option<u8>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ChangeTotals {
    pub files: usize,
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
    pub renamed: usize,
    pub conflicted: usize,
    pub lines_added: usize,
    pub lines_deleted: usize,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComparisonResult {
    pub comparison_id: ComparisonId,
    pub repo_id: RepoId,
    pub generation: u64,
    pub mode: ComparisonMode,
    pub resolved_left: Option<ResolvedRevisionSummary>,
    pub resolved_right: Option<ResolvedRevisionSummary>,
    /// The immutable object used for the left content endpoint. For
    /// `since_merge_base` this is the actual merge-base, not the selected ref.
    pub content_left_oid: Option<String>,
    /// The immutable object used for the right content endpoint.
    pub content_right_oid: Option<String>,
    pub merge_base_oid: Option<String>,
    pub files: Vec<ChangedFile>,
    pub totals: ChangeTotals,
}
