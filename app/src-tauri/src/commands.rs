use std::path::PathBuf;

use github_diff::{
    AuditEvidence, AuditId, AuditRequest, AuditSession, BackendCapabilities, ComparisonId,
    ComparisonRequest, ComparisonResult, EvidenceId, FileComparison, FileId, FindingId,
    FindingNavigation, FrontendError, ProjectDefinition, RepoId, RepositoryInfo,
    RepositorySnapshot,
};
use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::{DialogExt, FilePath};

use crate::audit::{AuditProviderSettings, AuditProviderTest, SetAuditSecretPaths};
use crate::remediation::{
    CodexAvailability, RemediationId, RemediationSession, RespondRemediationRequest,
    StartRemediationRequest,
};
use crate::state::AppState;

#[derive(Deserialize)]
pub struct PathArgs {
    path: PathBuf,
}

#[derive(Deserialize)]
pub struct RepoArgs {
    repo_id: RepoId,
    #[serde(default)]
    allow_active_work: bool,
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

#[derive(Deserialize)]
pub struct AuditIdArgs {
    audit_id: AuditId,
}

#[derive(Deserialize)]
pub struct ListAuditsArgs {
    repo_id: RepoId,
}

#[derive(Deserialize)]
pub struct StartAuditArgs {
    request: AuditRequest,
}

#[derive(Deserialize)]
pub struct EvidenceArgs {
    audit_id: AuditId,
    evidence_id: EvidenceId,
}

#[derive(Deserialize)]
pub struct FindingNavigationArgs {
    audit_id: AuditId,
    finding_id: FindingId,
}

#[derive(Deserialize)]
pub struct RemediationIdArgs {
    remediation_id: RemediationId,
}

#[derive(Deserialize)]
pub struct ListRemediationsArgs {
    repo_id: RepoId,
}

#[derive(Deserialize)]
pub struct StartRemediationArgs {
    request: StartRemediationRequest,
}

#[derive(Deserialize)]
pub struct ResumeRemediationArgs {
    remediation_id: RemediationId,
    repo_id: RepoId,
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
    if state.audits.has_preparing(&repo_id.0).await {
        return Err(FrontendError {
            code: github_diff::ErrorCode::Io,
            message: "Wait for the audit snapshot to finish before closing this repository.".into(),
            retryable: false,
            repo_id: Some(repo_id.0.clone()),
            operation_id: None,
        });
    }
    if (state.audits.has_active(&repo_id.0).await || state.remediation.has_active(&repo_id.0).await)
        && !args.allow_active_work
    {
        return Err(FrontendError {
            code: github_diff::ErrorCode::Io,
            message:
                "This repository has active audit or agent work. Confirm closing it explicitly."
                    .into(),
            retryable: false,
            repo_id: Some(repo_id.0.clone()),
            operation_id: None,
        });
    }
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

#[tauri::command]
pub async fn get_audit_provider_settings(
    state: State<'_, AppState>,
) -> Result<AuditProviderSettings, FrontendError> {
    Ok(state.audits.provider_settings().await)
}

#[tauri::command]
pub async fn test_audit_provider(
    state: State<'_, AppState>,
) -> Result<AuditProviderTest, FrontendError> {
    state.audits.test_provider().await
}

#[tauri::command]
pub async fn set_audit_secret_paths(
    state: State<'_, AppState>,
    args: SetAuditSecretPaths,
) -> Result<(), FrontendError> {
    state.audits.set_secret_paths(args.paths).await
}

#[tauri::command]
pub async fn start_audit(
    state: State<'_, AppState>,
    args: StartAuditArgs,
) -> Result<AuditSession, FrontendError> {
    state.audits.start(args.request).await
}

#[tauri::command]
pub async fn list_audits(
    state: State<'_, AppState>,
    args: ListAuditsArgs,
) -> Result<Vec<AuditSession>, FrontendError> {
    Ok(state.audits.list(&args.repo_id.0).await)
}

#[tauri::command]
pub async fn get_audit_session(
    state: State<'_, AppState>,
    args: AuditIdArgs,
) -> Result<AuditSession, FrontendError> {
    state.audits.get(&args.audit_id).await
}

#[tauri::command]
pub async fn cancel_audit(
    state: State<'_, AppState>,
    args: AuditIdArgs,
) -> Result<AuditSession, FrontendError> {
    state.audits.cancel(&args.audit_id).await
}

#[tauri::command]
pub async fn delete_audit(
    state: State<'_, AppState>,
    args: AuditIdArgs,
) -> Result<(), FrontendError> {
    state.audits.delete(&args.audit_id).await
}

#[tauri::command]
pub async fn get_audit_evidence(
    state: State<'_, AppState>,
    args: EvidenceArgs,
) -> Result<AuditEvidence, FrontendError> {
    state
        .audits
        .evidence(&args.audit_id, &args.evidence_id)
        .await
}

#[tauri::command]
pub async fn resolve_finding_navigation(
    state: State<'_, AppState>,
    args: FindingNavigationArgs,
) -> Result<FindingNavigation, FrontendError> {
    state
        .audits
        .resolve_navigation(&args.audit_id, &args.finding_id)
        .await
}

#[tauri::command]
pub async fn get_codex_availability(
    state: State<'_, AppState>,
) -> Result<CodexAvailability, FrontendError> {
    Ok(state.remediation.availability().await)
}

#[tauri::command]
pub async fn start_remediation(
    state: State<'_, AppState>,
    args: StartRemediationArgs,
) -> Result<RemediationSession, FrontendError> {
    let live = state
        .backend
        .get_repository_snapshot(args.request.repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &args.request.repo_id))?;
    let packet = state
        .audits
        .handoff_packet(&args.request.audit_id, &args.request.finding_ids)
        .await?;
    crate::remediation::validate_handoff_repository(&packet, &live.info)?;
    state.remediation.start(args.request, packet).await
}

#[tauri::command]
pub async fn list_remediations(
    state: State<'_, AppState>,
    args: ListRemediationsArgs,
) -> Result<Vec<RemediationSession>, FrontendError> {
    let snapshot = state
        .backend
        .get_repository_snapshot(args.repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &args.repo_id))?;
    Ok(state
        .remediation
        .list_for_repository(
            &args.repo_id,
            &snapshot.info.worktree_root,
            &snapshot.info.git_common_dir,
            snapshot.generation,
        )
        .await)
}

#[tauri::command]
pub async fn get_remediation_session(
    state: State<'_, AppState>,
    args: RemediationIdArgs,
) -> Result<RemediationSession, FrontendError> {
    state.remediation.get(&args.remediation_id).await
}

#[tauri::command]
pub async fn stop_remediation(
    state: State<'_, AppState>,
    args: RemediationIdArgs,
) -> Result<RemediationSession, FrontendError> {
    state.remediation.stop(&args.remediation_id).await
}

#[tauri::command]
pub async fn resume_remediation(
    state: State<'_, AppState>,
    args: ResumeRemediationArgs,
) -> Result<RemediationSession, FrontendError> {
    let snapshot = state
        .backend
        .get_repository_snapshot(args.repo_id.clone())
        .await
        .map_err(|error| with_repo(error.into(), &args.repo_id))?;
    state
        .remediation
        .resume(
            &args.remediation_id,
            &args.repo_id,
            &snapshot.info.worktree_root,
            &snapshot.info.git_common_dir,
        )
        .await
}

#[tauri::command]
pub async fn respond_remediation_request(
    state: State<'_, AppState>,
    args: RespondRemediationRequest,
) -> Result<RemediationSession, FrontendError> {
    state.remediation.respond(args).await
}
