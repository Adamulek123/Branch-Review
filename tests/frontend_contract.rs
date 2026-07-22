use github_diff::{
    ComparisonRequest, ComparisonResult, FileComparison, FileContent, FileSourceSummary,
    FrontendError, HeadState, ProjectDefinition, RepositorySnapshot,
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
