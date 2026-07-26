use std::{fs, path::Path, process::Command};

use github_diff::{
    AppError, ChangeKind, ComparisonRequest, FileContent, HeadState, RepositoryRegistry,
};
use tempfile::TempDir;

fn git(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-c")
        .arg("core.autocrlf=false")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .expect("git must be installed");
    assert!(
        output.status.success(),
        "git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn init() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Backend Tests"]);
    git(
        dir.path(),
        &["config", "user.email", "backend@example.invalid"],
    );
    dir
}

fn write(root: &Path, path: &str, text: &str) {
    let path = root.join(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, text).unwrap();
}

fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "-A"]);
    git(root, &["commit", "-m", message]);
}

fn text(content: &FileContent) -> Option<&str> {
    match content {
        FileContent::Text { text, .. } => Some(text),
        _ => None,
    }
}

#[tokio::test]
async fn opens_from_nested_directory_and_close_invalidates_every_operation() {
    let repo = init();
    write(repo.path(), "deep/inside/file.txt", "hello\n");
    commit_all(repo.path(), "initial");

    let registry = RepositoryRegistry::system();
    let snapshot = registry
        .open_repository(repo.path().join("deep/inside"))
        .await
        .unwrap();
    assert_eq!(
        fs::canonicalize(&snapshot.info.worktree_root).unwrap(),
        fs::canonicalize(repo.path()).unwrap()
    );
    assert!(matches!(snapshot.head, HeadState::Branch { .. }));
    assert_eq!(registry.list_open_repositories().await.len(), 1);

    let id = snapshot.repo_id;
    registry.close_repository(&id).await.unwrap();
    assert!(registry.list_open_repositories().await.is_empty());
    assert!(matches!(
        registry.get_repository_snapshot(&id).await,
        Err(AppError::InvalidRepositoryId)
    ));
    assert!(matches!(
        registry
            .create_comparison(&id, ComparisonRequest::Unstaged)
            .await,
        Err(AppError::InvalidRepositoryId)
    ));
    assert!(matches!(
        registry.close_repository(&id).await,
        Err(AppError::InvalidRepositoryId)
    ));
}

#[tokio::test]
async fn direct_and_merge_base_comparisons_have_different_semantics() {
    let repo = init();
    write(repo.path(), "base.txt", "base\n");
    commit_all(repo.path(), "base");
    git(repo.path(), &["switch", "-c", "feature"]);
    write(repo.path(), "feature.txt", "feature\n");
    commit_all(repo.path(), "feature work");
    git(repo.path(), &["switch", "main"]);
    write(repo.path(), "main.txt", "main\n");
    commit_all(repo.path(), "main work");

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let feature = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/feature")
        .unwrap();

    let direct = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct {
                left: feature.id.clone(),
                right: main.id.clone(),
            },
        )
        .await
        .unwrap();
    let since_base = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::SinceMergeBase {
                left: feature.id.clone(),
                right: main.id.clone(),
            },
        )
        .await
        .unwrap();
    assert!(
        direct
            .files
            .iter()
            .any(|f| f.display_path == "feature.txt" && f.status == ChangeKind::Deleted)
    );
    assert!(
        direct
            .files
            .iter()
            .any(|f| f.display_path == "main.txt" && f.status == ChangeKind::Added)
    );
    assert_eq!(since_base.files.len(), 1);
    assert_eq!(since_base.files[0].display_path, "main.txt");
    assert_eq!(since_base.files[0].status, ChangeKind::Added);
}

#[tokio::test]
async fn reports_staged_unstaged_untracked_and_all_uncommitted() {
    let repo = init();
    write(repo.path(), "staged.txt", "old staged\n");
    write(repo.path(), "unstaged.txt", "old unstaged\n");
    write(repo.path(), "both.txt", "old both\n");
    commit_all(repo.path(), "base");
    write(repo.path(), "staged.txt", "new staged\n");
    write(repo.path(), "both.txt", "indexed both\n");
    git(repo.path(), &["add", "staged.txt", "both.txt"]);
    write(repo.path(), "unstaged.txt", "new unstaged\n");
    write(repo.path(), "both.txt", "worktree both\n");
    write(repo.path(), "untracked.txt", "untracked\n");

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let status = &snapshot.status.entries;
    assert!(
        status
            .iter()
            .any(|e| e.display_path == "staged.txt" && e.staged && !e.unstaged)
    );
    assert!(
        status
            .iter()
            .any(|e| e.display_path == "unstaged.txt" && !e.staged && e.unstaged)
    );
    assert!(
        status
            .iter()
            .any(|e| e.display_path == "both.txt" && e.staged && e.unstaged)
    );
    assert!(
        status
            .iter()
            .any(|e| e.display_path == "untracked.txt" && e.status == ChangeKind::Untracked)
    );

    let staged = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::Staged)
        .await
        .unwrap();
    let unstaged = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::Unstaged)
        .await
        .unwrap();
    let all = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    assert_eq!(
        staged
            .files
            .iter()
            .map(|f| f.display_path.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        ["both.txt", "staged.txt"].into_iter().collect()
    );
    assert_eq!(
        unstaged
            .files
            .iter()
            .map(|f| f.display_path.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        ["both.txt", "unstaged.txt"].into_iter().collect()
    );
    assert_eq!(
        all.files
            .iter()
            .map(|f| f.display_path.as_str())
            .collect::<std::collections::BTreeSet<_>>(),
        ["both.txt", "staged.txt", "unstaged.txt", "untracked.txt"]
            .into_iter()
            .collect()
    );
}

#[tokio::test]
async fn loads_added_deleted_and_renamed_file_sides() {
    let repo = init();
    write(repo.path(), "delete.txt", "deleted contents\n");
    write(repo.path(), "old-name.txt", "renamed contents\n");
    commit_all(repo.path(), "before");
    git(repo.path(), &["branch", "before"]);
    fs::remove_file(repo.path().join("delete.txt")).unwrap();
    git(repo.path(), &["mv", "old-name.txt", "new-name.txt"]);
    write(repo.path(), "added.txt", "added contents\n");
    commit_all(repo.path(), "after");

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let before = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/before")
        .unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let comparison = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct {
                left: before.id.clone(),
                right: main.id.clone(),
            },
        )
        .await
        .unwrap();

    let added = comparison
        .files
        .iter()
        .find(|f| f.display_path == "added.txt")
        .unwrap();
    let deleted = comparison
        .files
        .iter()
        .find(|f| f.display_path == "delete.txt")
        .unwrap();
    let renamed = comparison
        .files
        .iter()
        .find(|f| f.display_path == "new-name.txt")
        .unwrap();
    assert_eq!(added.status, ChangeKind::Added);
    assert_eq!(deleted.status, ChangeKind::Deleted);
    assert_eq!(renamed.status, ChangeKind::Renamed);
    assert_eq!(renamed.old_display_path.as_deref(), Some("old-name.txt"));

    let added_sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &added.file_id)
        .await
        .unwrap();
    assert!(matches!(added_sides.left.content, FileContent::Missing));
    assert_eq!(text(&added_sides.right.content), Some("added contents\n"));
    let deleted_sides = registry
        .get_file_comparison(
            &snapshot.repo_id,
            &comparison.comparison_id,
            &deleted.file_id,
        )
        .await
        .unwrap();
    assert_eq!(
        text(&deleted_sides.left.content),
        Some("deleted contents\n")
    );
    assert!(matches!(deleted_sides.right.content, FileContent::Missing));
    let renamed_sides = registry
        .get_file_comparison(
            &snapshot.repo_id,
            &comparison.comparison_id,
            &renamed.file_id,
        )
        .await
        .unwrap();
    assert_eq!(
        text(&renamed_sides.left.content),
        Some("renamed contents\n")
    );
    assert_eq!(
        text(&renamed_sides.right.content),
        Some("renamed contents\n")
    );
}

#[tokio::test]
async fn detached_and_unborn_heads_are_modeled_and_bare_repositories_are_rejected() {
    let detached = init();
    write(detached.path(), "file.txt", "content\n");
    commit_all(detached.path(), "commit");
    git(detached.path(), &["checkout", "--detach"]);
    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(detached.path()).await.unwrap();
    assert!(matches!(snapshot.head, HeadState::Detached { .. }));

    let unborn = init();
    write(unborn.path(), "new.txt", "new\n");
    let unborn_registry = RepositoryRegistry::system();
    let snapshot = unborn_registry
        .open_repository(unborn.path())
        .await
        .unwrap();
    assert!(matches!(snapshot.head, HeadState::Unborn { .. }));
    let comparison = unborn_registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    assert_eq!(comparison.files.len(), 1);
    assert_eq!(comparison.files[0].status, ChangeKind::Untracked);

    let bare = tempfile::tempdir().unwrap();
    git(bare.path(), &["init", "--bare"]);
    let bare_registry = RepositoryRegistry::system();
    assert!(matches!(
        bare_registry.open_repository(bare.path()).await,
        Err(AppError::BareRepositoryUnsupported)
    ));
}

#[tokio::test]
async fn keeps_two_open_repositories_independent() {
    let first = init();
    let second = init();
    write(first.path(), "first.txt", "one\n");
    write(second.path(), "second.txt", "two\n");
    commit_all(first.path(), "first");
    commit_all(second.path(), "second");
    write(first.path(), "only-first.txt", "change\n");
    write(second.path(), "only-second.txt", "change\n");

    let registry = RepositoryRegistry::system();
    let a = registry.open_repository(first.path()).await.unwrap();
    let b = registry.open_repository(second.path()).await.unwrap();
    assert_ne!(a.repo_id, b.repo_id);
    assert_eq!(registry.list_open_repositories().await.len(), 2);
    let ac = registry
        .create_comparison(&a.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    let bc = registry
        .create_comparison(&b.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    assert_eq!(ac.files[0].display_path, "only-first.txt");
    assert_eq!(bc.files[0].display_path, "only-second.txt");
    registry.close_repository(&a.repo_id).await.unwrap();
    assert!(registry.get_repository_snapshot(&b.repo_id).await.is_ok());
}

#[tokio::test]
async fn conflict_entries_load_ours_and_theirs_index_stages() {
    let repo = init();
    write(repo.path(), "conflict.txt", "base\n");
    commit_all(repo.path(), "base");
    git(repo.path(), &["switch", "-c", "other"]);
    write(repo.path(), "conflict.txt", "theirs\n");
    commit_all(repo.path(), "theirs");
    git(repo.path(), &["switch", "main"]);
    write(repo.path(), "conflict.txt", "ours\n");
    commit_all(repo.path(), "ours");
    let merge = Command::new("git")
        .arg("-C")
        .arg(repo.path())
        .args(["merge", "other"])
        .output()
        .unwrap();
    assert!(!merge.status.success());

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    assert!(snapshot.status.entries.iter().any(|entry| entry.conflicted));
    let comparison = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::Unstaged)
        .await
        .unwrap();
    let conflicted = comparison
        .files
        .iter()
        .find(|file| file.conflicted)
        .unwrap();
    let sides = registry
        .get_file_comparison(
            &snapshot.repo_id,
            &comparison.comparison_id,
            &conflicted.file_id,
        )
        .await
        .unwrap();
    assert_eq!(text(&sides.left.content), Some("ours\n"));
    assert_eq!(text(&sides.right.content), Some("theirs\n"));
}

#[tokio::test]
async fn watcher_invalidates_only_the_changed_repository_and_manual_refresh_remains_available() {
    let first = init();
    let second = init();
    write(first.path(), "file.txt", "one\n");
    write(second.path(), "file.txt", "two\n");
    commit_all(first.path(), "first");
    commit_all(second.path(), "second");
    let registry = RepositoryRegistry::system();
    let first_snapshot = registry.open_repository(first.path()).await.unwrap();
    let second_snapshot = registry.open_repository(second.path()).await.unwrap();
    let mut updates = registry.subscribe();
    write(first.path(), "file.txt", "changed\n");
    let update = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let update = updates.recv().await.unwrap();
            if update.repo_id == first_snapshot.repo_id {
                break update;
            }
        }
    })
    .await
    .unwrap();
    assert!(update.generation > first_snapshot.generation);
    assert_eq!(
        registry
            .get_repository_snapshot(&first_snapshot.repo_id)
            .await
            .unwrap()
            .generation,
        update.generation
    );
    assert_eq!(
        registry
            .get_repository_snapshot(&second_snapshot.repo_id)
            .await
            .unwrap()
            .generation,
        second_snapshot.generation
    );
    let refreshed = registry
        .refresh_repository(&first_snapshot.repo_id)
        .await
        .unwrap();
    assert!(
        refreshed
            .status
            .entries
            .iter()
            .any(|entry| entry.display_path == "file.txt" && entry.unstaged)
    );
}

#[tokio::test]
async fn manual_refresh_advances_generation_and_invalidates_cached_comparisons() {
    let repo = init();
    write(repo.path(), "file.txt", "one\n");
    commit_all(repo.path(), "initial");
    write(repo.path(), "file.txt", "changed\n");

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let comparison = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::Unstaged)
        .await
        .unwrap();
    let file_id = comparison.files[0].file_id.clone();

    let refreshed = registry
        .refresh_repository(&snapshot.repo_id)
        .await
        .unwrap();

    assert!(refreshed.generation > snapshot.generation);
    let error = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file_id)
        .await
        .unwrap_err();
    assert!(matches!(error, github_diff::AppError::InvalidComparisonId));
}
