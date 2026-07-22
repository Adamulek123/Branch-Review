use super::{GitReference, WorkingTreeStatus};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;
macro_rules! string_id {
    ($name:ident) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(pub String);
        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4().to_string())
            }
        }
        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }
    };
}
string_id!(RepoId);
string_id!(FileId);
string_id!(RefId);
string_id!(ComparisonId);
string_id!(OperationId);
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectFormat {
    Sha1,
    Sha256,
    Unknown,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HeadState {
    Branch {
        full_ref: String,
        commit_oid: String,
    },
    Detached {
        commit_oid: String,
    },
    Unborn {
        full_ref: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositoryInfo {
    pub id: RepoId,
    pub display_name: String,
    pub worktree_root: PathBuf,
    pub git_dir: PathBuf,
    pub git_common_dir: PathBuf,
    pub is_shallow: bool,
    pub object_format: ObjectFormat,
    pub head: HeadState,
    pub generation: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepositorySnapshot {
    pub repo_id: RepoId,
    pub generation: u64,
    pub info: RepositoryInfo,
    pub head: HeadState,
    pub references: Vec<GitReference>,
    pub status: WorkingTreeStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackendCapabilities {
    pub api_version: u32,
    pub git_version: String,
    pub supports_sha256: bool,
    pub max_metadata_bytes: usize,
    pub max_file_bytes: u64,
}
