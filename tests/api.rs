use std::path::PathBuf;

use github_diff::{
    AppError, ComparisonRequest, ErrorCode, FrontendError, ProjectDefinition, ProjectLayout,
    ProjectRepositoryDefinition, RefId,
};

#[test]
fn comparison_enums_use_explicit_stable_tags() {
    let value = serde_json::to_value(ComparisonRequest::Direct {
        left: RefId("left".into()),
        right: RefId("right".into()),
    })
    .unwrap();
    assert_eq!(value["mode"], "direct");
    assert_eq!(value["left"], "left");
}

#[test]
fn project_definitions_round_trip_without_runtime_git_data() {
    let project = ProjectDefinition {
        schema_version: 1,
        project_id: "project-1".into(),
        name: "Customer Portal".into(),
        repositories: vec![ProjectRepositoryDefinition {
            project_repo_id: "frontend".into(),
            display_name: "Frontend".into(),
            path: PathBuf::from("C:/work/frontend"),
            display_order: 0,
            default_comparison: None,
        }],
        layout: ProjectLayout::Tabs,
    };
    let json = serde_json::to_string(&project).unwrap();
    let decoded: ProjectDefinition = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.schema_version, 1);
    assert_eq!(decoded.repositories[0].project_repo_id, "frontend");
}

#[test]
fn frontend_errors_do_not_expose_git_stderr_paths() {
    let error: FrontendError = AppError::GitCommandFailed {
        exit_code: 128,
        stderr: "fatal: secret path C:/private/source.rs".into(),
    }
    .into();
    assert_eq!(error.code, ErrorCode::GitCommandFailed);
    assert!(!error.message.contains("private"));
    assert!(!error.message.contains("source.rs"));
}
