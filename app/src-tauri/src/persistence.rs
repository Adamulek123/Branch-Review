use std::{io::ErrorKind, path::PathBuf};

use github_diff::{ErrorCode, FrontendError, ProjectDefinition};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

const PROJECT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
struct ProjectsDocument {
    schema_version: u32,
    projects: Vec<ProjectDefinition>,
}

pub struct ProjectStore {
    path: PathBuf,
    gate: Mutex<()>,
}

impl ProjectStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            gate: Mutex::new(()),
        }
    }

    pub async fn load(&self) -> Result<Vec<ProjectDefinition>, FrontendError> {
        let _guard = self.gate.lock().await;
        self.load_unlocked().await
    }

    pub async fn save(&self, project: ProjectDefinition) -> Result<(), FrontendError> {
        validate_project(&project)?;
        let _guard = self.gate.lock().await;
        let mut projects = self.load_unlocked().await?;
        if let Some(existing) = projects
            .iter_mut()
            .find(|item| item.project_id == project.project_id)
        {
            *existing = project;
        } else {
            projects.push(project);
        }
        self.write_unlocked(projects).await
    }

    pub async fn delete(&self, project_id: &str) -> Result<(), FrontendError> {
        let _guard = self.gate.lock().await;
        let mut projects = self.load_unlocked().await?;
        projects.retain(|project| project.project_id != project_id);
        self.write_unlocked(projects).await
    }

    async fn load_unlocked(&self) -> Result<Vec<ProjectDefinition>, FrontendError> {
        let bytes = match tokio::fs::read(&self.path).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let backup_path = self.path.with_extension("json.bak");
                match tokio::fs::read(&backup_path).await {
                    Ok(bytes) => {
                        let _ = tokio::fs::rename(&backup_path, &self.path).await;
                        bytes
                    }
                    Err(backup_error) if backup_error.kind() == ErrorKind::NotFound => {
                        return Ok(Vec::new());
                    }
                    Err(_) => return Err(storage_error("Saved projects could not be read")),
                }
            }
            Err(_) => return Err(storage_error("Saved projects could not be read")),
        };
        let document: ProjectsDocument = serde_json::from_slice(&bytes)
            .map_err(|_| storage_error("Saved project data is invalid"))?;
        if document.schema_version != PROJECT_SCHEMA_VERSION {
            return Err(storage_error(format!(
                "Project schema {} is not supported",
                document.schema_version
            )));
        }
        for project in &document.projects {
            validate_project(project)?;
        }
        Ok(document.projects)
    }

    async fn write_unlocked(
        &self,
        mut projects: Vec<ProjectDefinition>,
    ) -> Result<(), FrontendError> {
        projects.sort_by(|left, right| left.name.cmp(&right.name));
        let document = ProjectsDocument {
            schema_version: PROJECT_SCHEMA_VERSION,
            projects,
        };
        let bytes = serde_json::to_vec_pretty(&document)
            .map_err(|_| storage_error("Saved projects could not be encoded"))?;
        let parent = self
            .path
            .parent()
            .ok_or_else(|| storage_error("Project storage path has no parent"))?;
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|_| storage_error("Project storage could not be created"))?;

        let temp_path = parent.join(format!("projects-{}.tmp", Uuid::new_v4()));
        tokio::fs::write(&temp_path, bytes)
            .await
            .map_err(|_| storage_error("Saved projects could not be written"))?;

        // Rename is atomic on platforms that allow replacing the destination. Windows does not,
        // so retain the previous document as a short-lived recovery file during replacement.
        let backup_path = parent.join("projects.json.bak");
        if tokio::fs::try_exists(&self.path).await.unwrap_or(false) {
            let _ = tokio::fs::remove_file(&backup_path).await;
            tokio::fs::rename(&self.path, &backup_path)
                .await
                .map_err(|_| storage_error("Saved projects could not be replaced"))?;
        }
        if tokio::fs::rename(&temp_path, &self.path).await.is_err() {
            let _ = tokio::fs::rename(&backup_path, &self.path).await;
            let _ = tokio::fs::remove_file(&temp_path).await;
            return Err(storage_error("Saved projects could not be replaced"));
        }
        let _ = tokio::fs::remove_file(backup_path).await;
        Ok(())
    }
}

fn validate_project(project: &ProjectDefinition) -> Result<(), FrontendError> {
    if project.schema_version != PROJECT_SCHEMA_VERSION {
        return Err(storage_error("Only project schema version 1 is supported"));
    }
    if project.project_id.trim().is_empty() || project.name.trim().is_empty() {
        return Err(storage_error("Project ID and name are required"));
    }
    let mut ids = std::collections::HashSet::new();
    let mut orders = std::collections::HashSet::new();
    for repository in &project.repositories {
        if repository.project_repo_id.trim().is_empty()
            || repository.display_name.trim().is_empty()
            || repository.path.as_os_str().is_empty()
            || !ids.insert(&repository.project_repo_id)
            || !orders.insert(repository.display_order)
        {
            return Err(storage_error(
                "Repository IDs, names, paths, and display order must be valid and unique",
            ));
        }
    }
    Ok(())
}

pub fn storage_error(message: impl Into<String>) -> FrontendError {
    FrontendError {
        code: ErrorCode::Io,
        message: message.into(),
        retryable: false,
        repo_id: None,
        operation_id: None,
    }
}

#[cfg(test)]
mod tests {
    use github_diff::{ProjectDefinition, ProjectLayout};

    use super::ProjectStore;

    fn project(id: &str, name: &str) -> ProjectDefinition {
        ProjectDefinition {
            schema_version: 1,
            project_id: id.into(),
            name: name.into(),
            repositories: Vec::new(),
            layout: ProjectLayout::Tabs,
        }
    }

    #[tokio::test]
    async fn projects_upsert_and_delete_without_leaving_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("projects.json");
        let store = ProjectStore::new(path);
        store.save(project("one", "One")).await.unwrap();
        store.save(project("one", "Renamed")).await.unwrap();
        store.save(project("two", "Two")).await.unwrap();
        let loaded = store.load().await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert!(loaded.iter().any(|item| item.name == "Renamed"));
        store.delete("one").await.unwrap();
        assert_eq!(store.load().await.unwrap().len(), 1);
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn invalid_schema_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("projects.json");
        std::fs::write(&path, r#"{"schema_version":2,"projects":[]}"#).unwrap();
        let error = ProjectStore::new(path).load().await.unwrap_err();
        assert!(error.message.contains("not supported"));
    }

    #[tokio::test]
    async fn interrupted_replacement_recovers_the_backup_document() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("projects.json");
        let store = ProjectStore::new(path.clone());
        store.save(project("one", "Recovered")).await.unwrap();
        std::fs::rename(&path, path.with_extension("json.bak")).unwrap();

        let loaded = store.load().await.unwrap();
        assert_eq!(loaded[0].name, "Recovered");
        assert!(path.exists());
    }
}
