use std::{fs, path::Path, process::Command};

use github_diff::{AppError, ComparisonRequest, FileContent, RefId, RepositoryRegistry};
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
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn init() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    git(dir.path(), &["init", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Edge Tests"]);
    git(
        dir.path(),
        &["config", "user.email", "edge@example.invalid"],
    );
    dir
}

fn commit_all(root: &Path, message: &str) {
    git(root, &["add", "-A"]);
    git(root, &["commit", "-m", message]);
}

#[tokio::test]
async fn unrelated_histories_report_no_merge_base() {
    let repo = init();
    fs::write(repo.path().join("main.txt"), "main\n").unwrap();
    commit_all(repo.path(), "main root");
    git(repo.path(), &["switch", "--orphan", "unrelated"]);
    fs::write(repo.path().join("other.txt"), "other\n").unwrap();
    commit_all(repo.path(), "unrelated root");

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let other = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/unrelated")
        .unwrap();
    assert!(matches!(
        registry
            .create_comparison(
                &snapshot.repo_id,
                ComparisonRequest::SinceMergeBase {
                    left: main.id.clone(),
                    right: other.id.clone()
                },
            )
            .await,
        Err(AppError::NoMergeBase)
    ));
}

#[tokio::test]
async fn binary_and_oversized_worktree_content_are_bounded() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    fs::write(repo.path().join("binary.dat"), b"abc\0def").unwrap();
    fs::write(
        repo.path().join("huge.dat"),
        vec![b'x'; 5 * 1024 * 1024 + 1],
    )
    .unwrap();

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let comparison = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    let binary = comparison
        .files
        .iter()
        .find(|f| f.display_path == "binary.dat")
        .unwrap();
    let binary_sides = registry
        .get_file_comparison(
            &snapshot.repo_id,
            &comparison.comparison_id,
            &binary.file_id,
        )
        .await
        .unwrap();
    assert!(matches!(
        binary_sides.right.content,
        FileContent::Binary { size: 7 }
    ));

    let huge = comparison
        .files
        .iter()
        .find(|f| f.display_path == "huge.dat")
        .unwrap();
    let huge_sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &huge.file_id)
        .await
        .unwrap();
    assert!(
        matches!(huge_sides.right.content, FileContent::TooLarge { size, limit } if size > limit)
    );
}

#[tokio::test]
async fn unusual_filenames_round_trip_without_shell_interpretation() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    #[allow(unused_mut)]
    let mut names = vec![
        "has spaces.txt",
        "zażółć-世界.txt",
        "-leading.txt",
        "semi;colon.txt",
        "dollar$paren(thing).txt",
        "amp&quote'.txt",
    ];
    #[cfg(unix)]
    names.extend(["has\ttab.txt", "pipe|backtick`.txt"]);
    for name in &names {
        fs::write(repo.path().join(name), format!("{name}\n"))
            .unwrap_or_else(|e| panic!("cannot create {name:?}: {e}"));
    }

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let comparison = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    for name in names {
        let file = comparison
            .files
            .iter()
            .find(|f| f.display_path == name)
            .unwrap_or_else(|| panic!("missing {name:?}"));
        let sides = registry
            .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file.file_id)
            .await
            .unwrap();
        assert!(matches!(sides.right.content, FileContent::Text { .. }));
    }
}

#[tokio::test]
async fn opens_a_linked_worktree() {
    let parent = tempfile::tempdir().unwrap();
    let primary = parent.path().join("primary");
    let linked = parent.path().join("linked worktree");
    fs::create_dir(&primary).unwrap();
    git(&primary, &["init", "-b", "main"]);
    git(&primary, &["config", "user.name", "Edge Tests"]);
    git(&primary, &["config", "user.email", "edge@example.invalid"]);
    fs::write(primary.join("tracked.txt"), "tracked\n").unwrap();
    commit_all(&primary, "base");
    git(
        &primary,
        &[
            "worktree",
            "add",
            "-b",
            "linked-branch",
            linked.to_str().unwrap(),
        ],
    );

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(&linked).await.unwrap();
    assert_eq!(
        fs::canonicalize(&snapshot.info.worktree_root).unwrap(),
        fs::canonicalize(&linked).unwrap()
    );
    assert_ne!(snapshot.info.git_dir, snapshot.info.git_common_dir);
    assert!(
        snapshot
            .references
            .iter()
            .any(|r| r.full_name == "refs/heads/linked-branch" && r.is_head)
    );
}

#[tokio::test]
async fn opaque_reference_ids_reject_free_form_revision_input() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    git(repo.path(), &["branch", "other"]);
    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let valid = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    for payload in [
        "main",
        "HEAD",
        "--help",
        "main; touch OWNED",
        "$(touch OWNED)",
        "refs/heads/main^{tree}",
    ] {
        let result = registry
            .create_comparison(
                &snapshot.repo_id,
                ComparisonRequest::Direct {
                    left: RefId(payload.into()),
                    right: valid.id.clone(),
                },
            )
            .await;
        assert!(
            matches!(result, Err(AppError::InvalidReferenceId)),
            "payload {payload:?}: {result:?}"
        );
    }
    assert!(!repo.path().join("OWNED").exists());
}

#[cfg(any(unix, windows))]
#[tokio::test]
async fn worktree_symlink_is_returned_as_a_symlink_without_following_it() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    let target = repo.path().join("target.txt");
    fs::write(&target, "secret target\n").unwrap();
    let link = repo.path().join("link.txt");
    #[cfg(unix)]
    std::os::unix::fs::symlink("target.txt", &link).unwrap();
    #[cfg(windows)]
    if std::os::windows::fs::symlink_file("target.txt", &link).is_err() {
        return; // Windows Developer Mode or symlink privilege is not always available.
    }

    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let comparison = registry
        .create_comparison(&snapshot.repo_id, ComparisonRequest::AllUncommitted)
        .await
        .unwrap();
    let file = comparison
        .files
        .iter()
        .find(|f| f.display_path == "link.txt")
        .unwrap();
    let sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file.file_id)
        .await
        .unwrap();
    assert!(
        matches!(sides.right.content, FileContent::Symlink { ref target } if target == "target.txt")
    );
}

#[tokio::test]
async fn duplicate_open_is_deduplicated_by_canonical_worktree_root() {
    let repo = init();
    fs::create_dir_all(repo.path().join("nested")).unwrap();
    fs::write(repo.path().join("nested/file.txt"), "x\n").unwrap();
    commit_all(repo.path(), "initial");
    let registry = RepositoryRegistry::system();
    let first = registry.open_repository(repo.path()).await.unwrap();
    let second = registry
        .open_repository(repo.path().join("nested"))
        .await
        .unwrap();
    assert_eq!(first.repo_id, second.repo_id);
    assert_eq!(registry.list_open_repositories().await.len(), 1);
    registry.close_repository(&first.repo_id).await.unwrap();
    assert!(
        registry
            .get_repository_snapshot(&second.repo_id)
            .await
            .is_ok()
    );
    registry.close_repository(&second.repo_id).await.unwrap();
    assert!(
        registry
            .get_repository_snapshot(&second.repo_id)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn oversized_committed_blob_is_reported_without_transferring_it() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    git(repo.path(), &["switch", "-c", "large"]);
    fs::write(
        repo.path().join("large.txt"),
        vec![b'x'; 5 * 1024 * 1024 + 1],
    )
    .unwrap();
    commit_all(repo.path(), "large");
    git(repo.path(), &["switch", "main"]);
    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let large = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/large")
        .unwrap();
    let comparison = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct {
                left: main.id.clone(),
                right: large.id.clone(),
            },
        )
        .await
        .unwrap();
    let file = comparison
        .files
        .iter()
        .find(|f| f.display_path == "large.txt")
        .unwrap();
    let sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file.file_id)
        .await
        .unwrap();
    assert!(matches!(sides.right.content, FileContent::TooLarge { .. }));
}

#[tokio::test]
async fn committed_git_symlink_mode_is_returned_as_symlink_content() {
    let repo = init();
    fs::write(repo.path().join("base.txt"), "base\n").unwrap();
    commit_all(repo.path(), "base");
    git(repo.path(), &["switch", "-c", "link"]);
    fs::write(repo.path().join("link-file"), "target/path").unwrap();
    let oid = git(repo.path(), &["hash-object", "-w", "link-file"]);
    git(
        repo.path(),
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("120000,{oid},link-file"),
        ],
    );
    git(repo.path(), &["commit", "-m", "symlink mode"]);
    git(repo.path(), &["switch", "main"]);
    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(repo.path()).await.unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let link = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/link")
        .unwrap();
    let comparison = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct {
                left: main.id.clone(),
                right: link.id.clone(),
            },
        )
        .await
        .unwrap();
    let file = comparison
        .files
        .iter()
        .find(|f| f.display_path == "link-file")
        .unwrap();
    let sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file.file_id)
        .await
        .unwrap();
    assert!(
        matches!(sides.right.content, FileContent::Symlink { ref target } if target == "target/path")
    );
}

#[tokio::test]
async fn committed_gitlink_is_returned_as_submodule_content() {
    let child = init();
    fs::write(child.path().join("child.txt"), "child\n").unwrap();
    commit_all(child.path(), "child");
    let parent = init();
    fs::write(parent.path().join("base.txt"), "base\n").unwrap();
    commit_all(parent.path(), "base");
    git(parent.path(), &["switch", "-c", "with-submodule"]);
    let child_path = child.path().to_string_lossy().into_owned();
    git(
        parent.path(),
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            &child_path,
            "module",
        ],
    );
    commit_all(parent.path(), "add submodule");
    git(parent.path(), &["switch", "main"]);
    let registry = RepositoryRegistry::system();
    let snapshot = registry.open_repository(parent.path()).await.unwrap();
    let main = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/main")
        .unwrap();
    let with_submodule = snapshot
        .references
        .iter()
        .find(|r| r.full_name == "refs/heads/with-submodule")
        .unwrap();
    let comparison = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct {
                left: main.id.clone(),
                right: with_submodule.id.clone(),
            },
        )
        .await
        .unwrap();
    let file = comparison
        .files
        .iter()
        .find(|f| f.display_path == "module")
        .unwrap();
    assert!(file.submodule);
    let sides = registry
        .get_file_comparison(&snapshot.repo_id, &comparison.comparison_id, &file.file_id)
        .await
        .unwrap();
    assert!(matches!(
        sides.right.content,
        FileContent::Submodule {
            commit_oid: Some(_)
        }
    ));
}
