use std::path::{Path, PathBuf};

use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, Result},
    model::{HeadState, ObjectFormat, RepoId, RepositoryInfo},
};

use super::runner::{GitRunner, args};

pub async fn probe_repository(
    runner: &GitRunner,
    path: impl AsRef<Path>,
    cancel: &CancellationToken,
) -> Result<RepositoryInfo> {
    let path = path.as_ref();
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => AppError::PathNotFound(path.to_owned()),
            std::io::ErrorKind::PermissionDenied => AppError::PermissionDenied,
            _ => AppError::Io(error),
        })?;
    if !metadata.is_dir() {
        return Err(AppError::NotDirectory(path.to_owned()));
    }
    let canonical_path = tokio::fs::canonicalize(path).await.map_err(AppError::Io)?;
    let path = canonical_path.as_path();

    let bare = git_line(runner, path, &["rev-parse", "--is-bare-repository"], cancel)
        .await
        .map_err(map_not_repository)?;
    if bare == "true" {
        return Err(AppError::BareRepositoryUnsupported);
    }
    if bare != "false" {
        return Err(AppError::MalformedGitOutput(format!(
            "invalid bare flag: {bare}"
        )));
    }

    let worktree_root = absolute_git_path(
        path,
        &git_line(runner, path, &["rev-parse", "--show-toplevel"], cancel).await?,
    )?;
    let git_dir = absolute_git_path(
        path,
        &git_line(runner, path, &["rev-parse", "--absolute-git-dir"], cancel).await?,
    )?;
    let common_raw = git_line(runner, path, &["rev-parse", "--git-common-dir"], cancel).await?;
    let git_common_dir = absolute_git_path(path, &common_raw)?;
    let is_shallow = git_line(
        runner,
        path,
        &["rev-parse", "--is-shallow-repository"],
        cancel,
    )
    .await?
    .parse::<bool>()
    .map_err(|_| AppError::MalformedGitOutput("invalid shallow flag".into()))?;
    let object_format =
        match git_line(runner, path, &["rev-parse", "--show-object-format"], cancel).await {
            Ok(value) if value == "sha1" => ObjectFormat::Sha1,
            Ok(value) if value == "sha256" => ObjectFormat::Sha256,
            Ok(_) => ObjectFormat::Unknown,
            Err(AppError::GitCommandFailed { .. }) => ObjectFormat::Sha1,
            Err(error) => return Err(error),
        };
    let head = probe_head(runner, path, cancel).await?;
    let display_name = worktree_root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("repository")
        .to_owned();

    Ok(RepositoryInfo {
        id: RepoId::new(),
        display_name,
        worktree_root,
        git_dir,
        git_common_dir,
        is_shallow,
        object_format,
        head,
        generation: 0,
    })
}

async fn probe_head(
    runner: &GitRunner,
    path: &Path,
    cancel: &CancellationToken,
) -> Result<HeadState> {
    let symbolic = git_line(runner, path, &["symbolic-ref", "-q", "HEAD"], cancel).await;
    let oid = git_line(runner, path, &["rev-parse", "--verify", "HEAD"], cancel).await;
    match (symbolic, oid) {
        (Ok(full_ref), Ok(commit_oid)) => Ok(HeadState::Branch {
            full_ref,
            commit_oid: validate_oid(commit_oid)?,
        }),
        (Err(AppError::GitCommandFailed { exit_code: 1, .. }), Ok(commit_oid)) => {
            Ok(HeadState::Detached {
                commit_oid: validate_oid(commit_oid)?,
            })
        }
        (Ok(full_ref), Err(AppError::GitCommandFailed { .. })) => Ok(HeadState::Unborn {
            full_ref: Some(full_ref),
        }),
        (
            Err(AppError::GitCommandFailed { exit_code: 1, .. }),
            Err(AppError::GitCommandFailed { .. }),
        ) => Ok(HeadState::Unborn { full_ref: None }),
        (Err(error), _) | (_, Err(error)) => Err(error),
    }
}

async fn git_line(
    runner: &GitRunner,
    cwd: &Path,
    argv: &[&str],
    cancel: &CancellationToken,
) -> Result<String> {
    let text = runner.run_text(Some(cwd), args(argv), cancel).await?;
    let text = text.trim_end_matches(['\r', '\n']);
    if text.contains('\n') || text.contains('\r') || text.is_empty() {
        return Err(AppError::MalformedGitOutput(format!(
            "unexpected output from git {}",
            argv.join(" ")
        )));
    }
    Ok(text.to_owned())
}

fn absolute_git_path(cwd: &Path, value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    let path = if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    };
    std::fs::canonicalize(path).map_err(AppError::Io)
}

fn validate_oid(value: String) -> Result<String> {
    if (4..=128).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(value)
    } else {
        Err(AppError::MalformedGitOutput("invalid object id".into()))
    }
}

fn map_not_repository(error: AppError) -> AppError {
    match error {
        AppError::GitCommandFailed { ref stderr, .. }
            if stderr.contains("not a git repository")
                || stderr.contains("not a git directory") =>
        {
            AppError::NotRepository
        }
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_both_object_id_widths() {
        assert!(validate_oid("a".repeat(40)).is_ok());
        assert!(validate_oid("F".repeat(64)).is_ok());
        assert!(validate_oid("z".repeat(40)).is_err());
    }

    #[test]
    fn maps_standard_not_repository_diagnostic() {
        let error = AppError::GitCommandFailed {
            exit_code: 128,
            stderr: "fatal: not a git repository".into(),
        };
        assert!(matches!(map_not_repository(error), AppError::NotRepository));
    }
}
