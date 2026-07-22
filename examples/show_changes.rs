use github_diff::{ComparisonRequest, RepositoryRegistry};
use std::{env, path::PathBuf};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let repository = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: show_changes <repository-path>")?;

    let backend = RepositoryRegistry::system();
    let snapshot = backend.open_repository(&repository).await?;

    println!("Repository: {}", snapshot.info.display_name);
    println!("Path: {}", snapshot.info.worktree_root.display());

    let comparison = backend
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await?;

    if comparison.files.is_empty() {
        println!("No uncommitted changes.");
    } else {
        println!("\n{} changed file(s):", comparison.totals.files);

        for file in &comparison.files {
            let location = match (file.staged, file.unstaged) {
                (true, true) => "staged + unstaged",
                (true, false) => "staged",
                (false, true) => "unstaged",
                (false, false) => "",
            };

            println!("{:?}\t{}\t{}", file.status, file.display_path, location);
        }
    }

    backend.close_repository(&snapshot.repo_id).await?;
    Ok(())
}
