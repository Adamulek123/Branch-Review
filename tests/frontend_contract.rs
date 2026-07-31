use github_diff::{
    AuditActivity, AuditCoverage, AuditDepth, AuditFreshness, AuditId, AuditRequest, AuditSession,
    AuditStatus, AuditUsage, ComparisonId, ComparisonRequest, ComparisonResult, FileComparison,
    FileContent, FileSourceSummary, FrontendError, HeadState, ProjectDefinition, RepoId,
    RepositorySnapshot,
};
use serde::Deserialize;

#[derive(Deserialize)]
struct ContractFixture {
    comparison_requests: Vec<ComparisonRequest>,
    file_contents: Vec<FileContent>,
    file_sources: Vec<FileSourceSummary>,
    head_states: Vec<HeadState>,
    snapshot: RepositorySnapshot,
    comparison: ComparisonResult,
    file_comparison: FileComparison,
    project: ProjectDefinition,
    error: FrontendError,
}

#[test]
fn audit_contract_round_trips_with_stable_snake_case_enums() {
    let session = AuditSession {
        schema_version: 1,
        audit_id: AuditId("audit-1".into()),
        repo_id: RepoId("repo-1".into()),
        request: AuditRequest {
            repo_id: RepoId("repo-1".into()),
            comparison_id: ComparisonId("comparison-1".into()),
            work_description: "Preserve behavior".into(),
            acceptance_criteria: "No regression".into(),
            additional_context: String::new(),
            depth: AuditDepth::Thorough,
        },
        snapshot: None,
        status: AuditStatus::Incomplete,
        freshness: AuditFreshness::RepositoryChanged,
        activity: AuditActivity::default(),
        coverage: AuditCoverage::default(),
        findings: Vec::new(),
        conclusion: None,
        usage: AuditUsage::default(),
        created_at_ms: 1,
        updated_at_ms: 2,
        error: None,
    };
    let value = serde_json::to_value(&session).unwrap();
    assert_eq!(value["request"]["depth"], "thorough");
    assert_eq!(value["status"], "incomplete");
    assert_eq!(value["freshness"], "repository_changed");
    let decoded: AuditSession = serde_json::from_value(value).unwrap();
    assert_eq!(decoded.audit_id.0, "audit-1");
}

#[test]
fn frontend_contract_fixture_covers_tagged_variants_and_nullable_fields() {
    let fixture: ContractFixture =
        serde_json::from_str(include_str!("../app/src/api/fixtures/contracts.json"))
            .expect("frontend contract fixture must match Rust transport types");
    assert_eq!(fixture.comparison_requests.len(), 5);
    assert_eq!(fixture.file_contents.len(), 7);
    assert_eq!(fixture.file_sources.len(), 6);
    assert_eq!(fixture.head_states.len(), 3);
    assert_eq!(fixture.snapshot.generation, 4);
    assert_eq!(fixture.comparison.files.len(), 1);
    assert_eq!(fixture.file_comparison.left.label, "HEAD");
    assert_eq!(fixture.project.schema_version, 1);
    assert_eq!(fixture.error.repo_id.as_deref(), Some("repo-1"));
}
