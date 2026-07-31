use std::sync::Arc;

use github_diff::Backend;

use crate::audit::AuditService;
use crate::persistence::ProjectStore;
use crate::remediation::RemediationService;

#[derive(Clone)]
pub struct AppState {
    pub backend: Backend,
    pub projects: Arc<ProjectStore>,
    pub audits: Arc<AuditService>,
    pub remediation: Arc<RemediationService>,
}
