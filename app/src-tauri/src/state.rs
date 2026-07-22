use std::sync::Arc;

use github_diff::Backend;

use crate::persistence::ProjectStore;

#[derive(Clone)]
pub struct AppState {
    pub backend: Backend,
    pub projects: Arc<ProjectStore>,
}
