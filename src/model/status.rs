use super::FileId;
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    TypeChanged,
    Unmerged,
    Untracked,
    Unknown,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEntry {
    pub file_id: FileId,
    pub display_path: String,
    pub old_display_path: Option<String>,
    pub status: ChangeKind,
    pub index_status: Option<char>,
    pub worktree_status: Option<char>,
    pub staged: bool,
    pub unstaged: bool,
    pub conflicted: bool,
    pub submodule: bool,
    pub similarity: Option<u8>,
    pub head_mode: Option<String>,
    pub index_mode: Option<String>,
    pub worktree_mode: Option<String>,
    pub head_oid: Option<String>,
    pub index_oid: Option<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorkingTreeStatus {
    pub generation: u64,
    pub branch_oid: Option<String>,
    pub branch_head: Option<String>,
    pub entries: Vec<StatusEntry>,
}
