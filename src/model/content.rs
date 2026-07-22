use super::{ComparisonId, FileId, RepoId};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileContent {
    Text {
        text: String,
        encoding: String,
        size: u64,
    },
    Binary {
        size: u64,
    },
    TooLarge {
        size: u64,
        limit: u64,
    },
    Missing,
    Symlink {
        target: String,
    },
    Submodule {
        commit_oid: Option<String>,
    },
    UnsupportedEncoding {
        size: u64,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FileSourceSummary {
    Commit { commit_oid: String },
    Index,
    Worktree,
    Empty,
    ConflictStage { stage: u8 },
    Submodule,
}
#[derive(Debug, Clone)]
pub enum ContentSource {
    Commit {
        commit_oid: String,
        repo_path: PathBuf,
    },
    Index {
        repo_path: PathBuf,
    },
    Worktree {
        repo_path: PathBuf,
    },
    Empty,
    ConflictStage {
        stage: u8,
        repo_path: PathBuf,
    },
    Submodule {
        commit_oid: Option<String>,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSide {
    pub label: String,
    pub source: FileSourceSummary,
    pub content: FileContent,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileComparison {
    pub repo_id: RepoId,
    pub comparison_id: ComparisonId,
    pub file_id: FileId,
    pub generation: u64,
    pub left: FileSide,
    pub right: FileSide,
}
#[derive(Debug, Clone)]
pub struct FileDescriptor {
    pub file_id: FileId,
    pub left: ContentSource,
    pub right: ContentSource,
}
