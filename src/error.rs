use std::{io, path::PathBuf, time::Duration};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub type Result<T, E = AppError> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    GitNotFound,
    UnsupportedGit,
    PathNotFound,
    NotDirectory,
    NotRepository,
    BareRepositoryUnsupported,
    UnsafeRepository,
    PermissionDenied,
    RepositoryClosed,
    InvalidRepositoryId,
    InvalidReferenceId,
    ReferenceMovedOrDeleted,
    UnbornHead,
    NoMergeBase,
    InvalidFileId,
    InvalidComparisonId,
    FileOutsideRepository,
    ContentMissing,
    ContentTooLarge,
    BinaryContent,
    UnsupportedEncoding,
    ContentChangedDuringRead,
    GitTimedOut,
    GitCancelled,
    GitOutputTooLarge,
    GitCommandFailed,
    MalformedGitOutput,
    WatcherUnavailable,
    StaleGeneration,
    Io,
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Git executable was not found")]
    GitNotFound,
    #[error("unsupported Git installation: {0}")]
    UnsupportedGit(String),
    #[error("path does not exist: {0}")]
    PathNotFound(PathBuf),
    #[error("path is not a directory: {0}")]
    NotDirectory(PathBuf),
    #[error("folder is not a Git repository")]
    NotRepository,
    #[error("bare repositories are not supported")]
    BareRepositoryUnsupported,
    #[error("Git rejected this repository because of suspicious ownership")]
    UnsafeRepository,
    #[error("permission denied")]
    PermissionDenied,
    #[error("repository has been closed")]
    RepositoryClosed,
    #[error("unknown repository id")]
    InvalidRepositoryId,
    #[error("unknown reference id")]
    InvalidReferenceId,
    #[error("the selected reference moved or was deleted")]
    ReferenceMovedOrDeleted,
    #[error("this operation requires a commit, but HEAD is unborn")]
    UnbornHead,
    #[error("the selected histories have no merge base")]
    NoMergeBase,
    #[error("unknown file id")]
    InvalidFileId,
    #[error("unknown or expired comparison id")]
    InvalidComparisonId,
    #[error("file path escapes the repository")]
    FileOutsideRepository,
    #[error("file content is missing")]
    ContentMissing,
    #[error("content is too large ({size} bytes; limit {limit})")]
    ContentTooLarge { size: u64, limit: u64 },
    #[error("binary content cannot be shown as text")]
    BinaryContent,
    #[error("the file encoding is not supported")]
    UnsupportedEncoding,
    #[error("the file changed while it was being read")]
    ContentChangedDuringRead,
    #[error("Git operation timed out after {0:?}")]
    GitTimedOut(Duration),
    #[error("Git operation was cancelled")]
    GitCancelled,
    #[error("Git output exceeded the {limit}-byte limit")]
    GitOutputTooLarge { limit: usize },
    #[error("Git command failed with exit code {exit_code}: {stderr}")]
    GitCommandFailed { exit_code: i32, stderr: String },
    #[error("malformed Git output: {0}")]
    MalformedGitOutput(String),
    #[error("file watching is unavailable: {0}")]
    WatcherUnavailable(String),
    #[error("repository changed while the operation was running")]
    StaleGeneration,
    #[error("I/O error: {0}")]
    Io(#[from] io::Error),
}

impl AppError {
    pub fn code(&self) -> ErrorCode {
        use AppError::*;
        match self {
            GitNotFound => ErrorCode::GitNotFound,
            UnsupportedGit(_) => ErrorCode::UnsupportedGit,
            PathNotFound(_) => ErrorCode::PathNotFound,
            NotDirectory(_) => ErrorCode::NotDirectory,
            NotRepository => ErrorCode::NotRepository,
            BareRepositoryUnsupported => ErrorCode::BareRepositoryUnsupported,
            UnsafeRepository => ErrorCode::UnsafeRepository,
            PermissionDenied => ErrorCode::PermissionDenied,
            RepositoryClosed => ErrorCode::RepositoryClosed,
            InvalidRepositoryId => ErrorCode::InvalidRepositoryId,
            InvalidReferenceId => ErrorCode::InvalidReferenceId,
            ReferenceMovedOrDeleted => ErrorCode::ReferenceMovedOrDeleted,
            UnbornHead => ErrorCode::UnbornHead,
            NoMergeBase => ErrorCode::NoMergeBase,
            InvalidFileId => ErrorCode::InvalidFileId,
            InvalidComparisonId => ErrorCode::InvalidComparisonId,
            FileOutsideRepository => ErrorCode::FileOutsideRepository,
            ContentMissing => ErrorCode::ContentMissing,
            ContentTooLarge { .. } => ErrorCode::ContentTooLarge,
            BinaryContent => ErrorCode::BinaryContent,
            UnsupportedEncoding => ErrorCode::UnsupportedEncoding,
            ContentChangedDuringRead => ErrorCode::ContentChangedDuringRead,
            GitTimedOut(_) => ErrorCode::GitTimedOut,
            GitCancelled => ErrorCode::GitCancelled,
            GitOutputTooLarge { .. } => ErrorCode::GitOutputTooLarge,
            GitCommandFailed { .. } => ErrorCode::GitCommandFailed,
            MalformedGitOutput(_) => ErrorCode::MalformedGitOutput,
            WatcherUnavailable(_) => ErrorCode::WatcherUnavailable,
            StaleGeneration => ErrorCode::StaleGeneration,
            Io(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                ErrorCode::PermissionDenied
            }
            Io(_) => ErrorCode::Io,
        }
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self,
            Self::GitTimedOut(_)
                | Self::GitCancelled
                | Self::ContentChangedDuringRead
                | Self::StaleGeneration
                | Self::WatcherUnavailable(_)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendError {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub repo_id: Option<String>,
    pub operation_id: Option<String>,
}

impl From<AppError> for FrontendError {
    fn from(value: AppError) -> Self {
        let message = match &value {
            AppError::GitCommandFailed { .. } => {
                "Git could not complete the requested read-only operation".to_owned()
            }
            AppError::Io(_) => "A local file operation failed".to_owned(),
            AppError::MalformedGitOutput(_) => {
                "Git returned data the application could not understand".to_owned()
            }
            other => other.to_string(),
        };
        Self {
            code: value.code(),
            message,
            retryable: value.retryable(),
            repo_id: None,
            operation_id: None,
        }
    }
}
