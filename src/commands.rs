//! Thin application-boundary adapter. Tauri commands can delegate to these methods
//! without constructing Git arguments or reading repository files.

use std::{path::PathBuf, sync::Arc};

use crate::{
    BackendCapabilities, ComparisonId, ComparisonRequest, ComparisonResult, FileComparison, FileId,
    RepoId, RepositoryInfo, RepositoryRegistry, RepositorySnapshot, Result,
};

#[derive(Clone)]
pub struct Backend {
    registry: Arc<RepositoryRegistry>,
}

impl Backend {
    pub fn new(registry: Arc<RepositoryRegistry>) -> Self {
        Self { registry }
    }
    pub fn system() -> Self {
        Self::new(RepositoryRegistry::system())
    }
    pub fn registry(&self) -> &Arc<RepositoryRegistry> {
        &self.registry
    }

    pub async fn get_backend_capabilities(&self) -> Result<BackendCapabilities> {
        self.registry.capabilities().await
    }
    pub async fn open_repository(&self, path: PathBuf) -> Result<RepositorySnapshot> {
        self.registry.open_repository(path).await
    }
    pub async fn close_repository(&self, repo_id: RepoId) -> Result<()> {
        self.registry.close_repository(&repo_id).await
    }
    pub async fn list_open_repositories(&self) -> Vec<RepositoryInfo> {
        self.registry.list_open_repositories().await
    }
    pub async fn refresh_repository(&self, repo_id: RepoId) -> Result<RepositorySnapshot> {
        self.registry.refresh_repository(&repo_id).await
    }
    pub async fn get_repository_snapshot(&self, repo_id: RepoId) -> Result<RepositorySnapshot> {
        self.registry.get_repository_snapshot(&repo_id).await
    }
    pub async fn create_comparison(
        &self,
        repo_id: RepoId,
        request: ComparisonRequest,
    ) -> Result<ComparisonResult> {
        self.registry.create_comparison(&repo_id, request).await
    }
    pub async fn get_file_comparison(
        &self,
        repo_id: RepoId,
        comparison_id: ComparisonId,
        file_id: FileId,
    ) -> Result<FileComparison> {
        self.registry
            .get_file_comparison(&repo_id, &comparison_id, &file_id)
            .await
    }
}
