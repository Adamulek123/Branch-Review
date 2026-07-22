use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDefinition {
    pub schema_version: u32,
    pub project_id: String,
    pub name: String,
    pub repositories: Vec<ProjectRepositoryDefinition>,
    pub layout: ProjectLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRepositoryDefinition {
    pub project_repo_id: String,
    pub display_name: String,
    pub path: PathBuf,
    pub display_order: u32,
    pub default_comparison: Option<SavedComparisonPreference>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLayout {
    Tabs,
    Columns,
    Cards,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedComparisonPreference {
    pub mode: SavedComparisonMode,
    pub left_full_ref: Option<String>,
    pub right_full_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SavedComparisonMode {
    Direct,
    SinceMergeBase,
    Unstaged,
    Staged,
    AllUncommitted,
}
