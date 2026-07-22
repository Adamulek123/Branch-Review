use std::path::PathBuf;

use github_diff::{
    BackendCapabilities, ComparisonId, ComparisonRequest, ComparisonResult, FileComparison, FileId,
    FrontendError, ProjectDefinition, RepoId, RepositoryInfo, RepositorySnapshot,
};
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::state::AppState;

#[derive(Deserialize)]
pub struct PathArgs {
    path: PathBuf,
}

#[derive(Deserialize)]
pub struct RepoArgs {
    repo_id: RepoId,
}

#[derive(Deserialize)]
pub struct ComparisonArgs {
    repo_id: RepoId,
    request: ComparisonRequest,
}

#[derive(Deserialize)]
pub struct FileComparisonArgs {
    repo_id: RepoId,
    comparison_id: ComparisonId,
    file_id: FileId,
}

#[derive(Deserialize)]
pub struct SaveProjectArgs {
    project: ProjectDefinition,
}

#[derive(Deserialize)]
pub struct DeleteProjectArgs {
    project_id: String,
}

fn with_repo(mut error: FrontendError, repo_id: &RepoId) -> FrontendError {
    error.repo_id = Some(repo_id.0.clone());
    error
}

#[cfg(test)]
mod tests {
    use github_diff::{AppError, ErrorCode, FrontendError, RepoId};

    use super::with_repo;

    #[test]
    fn command_errors_attach_only_the_public_repository_id() {
        let error: FrontendError = AppError::GitCommandFailed {
            exit_code: 128,
            stderr: "C:/private/repository/secret.txt".into(),
        }
        .into();
        let error = with_repo(error, &RepoId("repo-public".into()));
        assert_eq!(error.code, ErrorCode::GitCommandFailed);
        assert_eq!(error.repo_id.as_deref(), Some("repo-public"));
        assert!(!error.message.contains("private"));
    }
}

#[tauri::command]
pub async fn get_backend_capabilities(
    state: State<'_, AppState>,
) -> Result<BackendCapabilities, FrontendError> {
    state
        .backend
        .get_backend_capabilities()
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn open_repository(
    state: State<'_, AppState>,
    args: PathArgs,
) -> Result<RepositorySnapshot, FrontendError> {
    state
        .backend
        .open_repository(args.path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn close_repository(
    state: State<'_, AppState>,
    args: RepoArgs,
) -> Result<(), FrontendError> {
    let repo_id = args.repo_id;
    state
        .backend
        .close_repository(repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &repo_id))
}

#[tauri::command]
pub async fn list_open_repositories(
    state: State<'_, AppState>,
) -> Result<Vec<RepositoryInfo>, FrontendError> {
    Ok(state.backend.list_open_repositories().await)
}

#[tauri::command]
pub async fn refresh_repository(
    state: State<'_, AppState>,
    args: RepoArgs,
) -> Result<RepositorySnapshot, FrontendError> {
    let repo_id = args.repo_id;
    state
        .backend
        .refresh_repository(repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &repo_id))
}

#[tauri::command]
pub async fn get_repository_snapshot(
    state: State<'_, AppState>,
    args: RepoArgs,
) -> Result<RepositorySnapshot, FrontendError> {
    let repo_id = args.repo_id;
    state
        .backend
        .get_repository_snapshot(repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &repo_id))
}

#[tauri::command]
pub async fn create_comparison(
    state: State<'_, AppState>,
    args: ComparisonArgs,
) -> Result<ComparisonResult, FrontendError> {
    let repo_id = args.repo_id;
    state
        .backend
        .create_comparison(repo_id.clone(), args.request)
        .await
        .map_err(|error| with_repo(error.into(), &repo_id))
}

#[tauri::command]
pub async fn get_file_comparison(
    state: State<'_, AppState>,
    args: FileComparisonArgs,
) -> Result<FileComparison, FrontendError> {
    let repo_id = args.repo_id;
    state
        .backend
        .get_file_comparison(repo_id.clone(), args.comparison_id, args.file_id)
        .await
        .map_err(|error| with_repo(error.into(), &repo_id))
}

#[tauri::command]
pub async fn pick_repository_directory(app: AppHandle) -> Result<Option<String>, FrontendError> {
    let selection = app.dialog().file().blocking_pick_folder();
    match selection {
        None => Ok(None),
        Some(FilePath::Path(path)) => Ok(Some(path.to_string_lossy().into_owned())),
        Some(FilePath::Url(_)) => Err(crate::persistence::storage_error(
            "The selected location is not a local filesystem path",
        )),
    }
}

#[tauri::command]
pub async fn load_projects(
    state: State<'_, AppState>,
) -> Result<Vec<ProjectDefinition>, FrontendError> {
    state.projects.load().await
}

#[tauri::command]
pub async fn save_project(
    state: State<'_, AppState>,
    args: SaveProjectArgs,
) -> Result<(), FrontendError> {
    state.projects.save(args.project).await
}

#[tauri::command]
pub async fn delete_project(
    state: State<'_, AppState>,
    args: DeleteProjectArgs,
) -> Result<(), FrontendError> {
    state.projects.delete(&args.project_id).await
}
