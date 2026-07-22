use super::RefId;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    LocalBranch,
    RemoteBranch,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitReference {
    pub id: RefId,
    pub full_name: String,
    pub display_name: String,
    pub kind: ReferenceKind,
    pub commit_oid: String,
    pub upstream_full_name: Option<String>,
    pub is_head: bool,
    pub checked_out_worktree: Option<PathBuf>,
}
#[derive(Debug, Clone)]
pub struct ResolvedRevision {
    pub full_ref: String,
    pub commit_oid: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolvedRevisionSummary {
    pub display_name: String,
    pub commit_oid: String,
}
