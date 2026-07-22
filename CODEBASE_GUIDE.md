# Git Branch Comparator Codebase Guide

This document explains how the Rust library is organized, how its main operations work, and how to use it from another Rust program or a future desktop frontend.

## 1. Purpose and scope

The crate is a read-only Git comparison backend. It treats the locally installed Git executable as the source of truth instead of implementing Git object parsing itself.

It can:

- Open and monitor multiple non-bare repositories.
- Discover local branches and remote-tracking branches.
- Report staged, unstaged, untracked, renamed, copied, conflicted, and submodule changes.
- Compare two revisions directly or compare one revision from their merge base.
- Load the left and right content of a changed file on demand.
- Model text, binary data, oversized content, missing files, symbolic links, submodules, and unsupported encodings.
- Handle normal repositories, nested input paths, linked worktrees, detached HEAD, unborn HEAD, shallow repositories, and SHA-1 or SHA-256 object IDs.
- Expose serializable data transfer objects suitable for a Tauri or other desktop frontend.

It deliberately does not:

- Fetch, pull, push, checkout, reset, stage, commit, merge, or modify Git configuration.
- Accept arbitrary revision strings from the frontend for comparisons.
- Render a line-by-line diff. It supplies typed left and right file content so the caller can render the diff.
- Persist project definitions itself. The project model contains serializable DTOs, but storage is left to the application.
- Include a Tauri dependency or a full graphical interface. The Backend type is the boundary a Tauri command layer can call.

## 2. High-level architecture

The authored Rust code is split into four layers:

    Application or frontend
              |
              v
        commands::Backend
              |
              v
      service::RepositoryRegistry
        |          |          |
        v          v          v
      git::*     model::*   RepositoryWatcher
        |
        v
    installed git executable

- The model layer defines stable request and response types.
- The git layer constructs a closed set of read-only Git commands and parses their output.
- The service layer owns open repositories, generations, caches, concurrency limits, content loading, and watchers.
- The command layer is a thin application-facing adapter.

The crate root re-exports the main public API, so callers normally import types directly from github_diff rather than from individual modules.

## 3. How the implementation works

### 3.1 Opening and refreshing a repository

RepositoryRegistry::open_repository performs the following workflow:

1. Canonicalizes the supplied directory. A nested folder inside a repository is accepted.
2. Probes Git for the worktree root, Git directory, common Git directory, bare status, shallow status, object format, and HEAD state.
3. Rejects bare repositories.
4. Deduplicates an already-open repository by canonical worktree root.
5. Runs reference discovery, porcelain-v2 status, and repository probing concurrently.
6. Parses the results into a RepositorySnapshot.
7. Builds private maps from opaque RefId and FileId values to trusted internal names and paths.
8. Starts a best-effort filesystem watcher.

Each open repository has a RepositoryHandle containing its current snapshot, reference map, status-path map, comparison cache, cancellation token, refresh lock, watcher, and atomic generation.

A refresh is serialized per repository. The service records the generation before starting, checks it again after Git finishes, retries once if the repository changed during the operation, and otherwise reports StaleGeneration. This prevents a caller from receiving a snapshot assembled from inconsistent repository states.

Opening the same canonical worktree twice returns the existing logical repository rather than creating a duplicate handle.

### 3.2 Runtime IDs and generations

RepoId, RefId, ComparisonId, FileId, and OperationId are opaque UUID-backed string types.

These IDs are a security and consistency boundary:

- A frontend selects a reference using a RefId returned by the current snapshot.
- The service resolves that ID through its private map.
- Free-form user input is never inserted into a Git revision expression.
- ComparisonId and FileId values are valid only for a cached comparison.

IDs are runtime data and should not be persisted as project configuration. Persistent preferences use full reference names through SavedComparisonPreference and must be resolved again after reopening a repository.

Every repository-derived response carries a generation number. A filesystem event increments the repository generation immediately, publishes a RepositoryUpdate, and schedules a refresh. Results created for an older generation are rejected as stale. Frontends should retain the newest generation they have seen and discard older asynchronous responses.

### 3.3 Reference discovery

References are obtained with Git for-each-ref over refs/heads and refs/remotes. The format terminates every field with NUL, allowing spaces and newlines in relevant paths without line-based parsing errors.

The parser captures:

- Full and short reference names.
- Commit object IDs.
- Upstream references.
- Whether the reference is HEAD.
- Whether a branch is checked out in a worktree.

Remote HEAD aliases are filtered out. If short display names collide, the service replaces the ambiguous display names with full reference names.

Object IDs are treated as opaque hexadecimal values with variable length rather than assuming a fixed 40-character SHA-1 hash.

### 3.4 Working-tree status

Status comes from Git porcelain v2 with NUL termination. The parser understands:

- Ordinary changed entries.
- Rename and copy records, including similarity scores and original paths.
- Unmerged/conflicted entries.
- Untracked entries.
- Branch OID and branch-name headers.
- Index, worktree, and HEAD modes and object IDs.
- Submodule flags.

Raw repository paths remain PathBuf values internally. A lossy display string is used only in DTO fields intended for presentation. Private FileId-to-PathBuf maps preserve the trusted path used for later operations.

### 3.5 Comparison modes

ComparisonRequest provides the complete public set of comparison operations:

| Mode | Logical left side | Logical right side | Notes |
| --- | --- | --- | --- |
| Direct | selected left commit | selected right commit | Equivalent to comparing the two resolved commit OIDs. |
| SinceMergeBase | merge base of selected refs | selected right commit | Shows what the right side changed since the histories diverged. Returns NoMergeBase for unrelated histories. |
| Unstaged | Git index | worktree | Does not include untracked files. |
| Staged | HEAD, or empty for unborn HEAD | Git index | Supports a repository before its first commit. |
| AllUncommitted | HEAD, or empty for unborn HEAD | worktree | Combines tracked differences with untracked status entries. |

The diff module creates command plans only for these modes. Output is requested as NUL-delimited name-status data with rename detection, external diff drivers disabled, and text conversion disabled.

For every changed path, the registry creates a private FileDescriptor describing where to load the left and right sides. Added files have an empty left side, deleted files have an empty right side, renames use the old path on the left, and conflicts use index stages 2 and 3.

The public ComparisonResult contains presentation metadata and opaque file IDs, but not all file bodies. This keeps the initial operation bounded and lets a frontend load content only for the file the user opens.

The registry retains at most 32 comparisons per repository. Older comparisons are evicted, and all comparisons become stale when the repository generation changes.

### 3.6 Loading file content

RepositoryRegistry::get_file_comparison looks up the trusted descriptor associated with a ComparisonId and FileId, loads both sides concurrently, and returns FileComparison.

Possible sources are:

- A blob from a commit.
- A blob from the index.
- A worktree file.
- An empty side.
- Conflict stage 2 or 3.
- A submodule commit.

Before committed or indexed content is transferred, the service asks Git for the object type and size. Blobs larger than 5 MiB become FileContent::TooLarge without loading the body. Git mode 120000 becomes FileContent::Symlink and mode 160000 becomes FileContent::Submodule.

Worktree reads:

- Require a path lexically inside the repository.
- Inspect symlinks without following them.
- Enforce the 5 MiB allocation limit.
- Compare metadata before and after reading to detect concurrent modification.

Content classification recognizes UTF-8, UTF-8 with BOM, binary content containing a NUL byte, common UTF-16/UTF-32 BOMs as unsupported encodings, oversized content, and missing content.

### 3.7 Process safety and concurrency

GitRunner invokes Git directly through tokio::process::Command. It never invokes a shell, so shell metacharacters in paths remain literal arguments.

Every command receives:

- --no-pager and --no-optional-locks.
- A null stdin.
- Piped stdout and stderr drained concurrently.
- A 30-second timeout in the system configuration.
- A 10 MiB stdout limit for metadata commands.
- A 64 KiB retained stderr limit.
- Cancellation with child termination and reaping.
- Noninteractive prompt and credential-manager settings.
- A deterministic C locale and disabled pagers.

Repository-related Git environment variables and all GIT_CONFIG_* variables are removed before spawning the process. This prevents inherited environment state from redirecting an operation to a different repository or injecting configuration.

RepositoryRegistry::system limits the whole process to four simultaneous Git child processes with a Tokio semaphore. Each repository also has a refresh mutex, while independent repositories can otherwise progress concurrently.

Tracing records operation names, durations, exit codes, and byte counts rather than file contents or repository paths.

### 3.8 Watching for changes

RepositoryWatcher uses the notify crate. It watches:

- The worktree recursively.
- The worktree-specific Git directory.
- The common Git directory.
- HEAD and the index.
- refs recursively.
- packed-refs.

Read/access-only notifications are ignored. Other events are debounced for 350 milliseconds before invoking the registry callback.

Watcher setup is best effort when opening a repository. If the platform watcher is unavailable, repository operations still work and refresh_repository can be called manually.

### 3.9 Error handling

AppError is the internal typed error enum and ErrorCode is its stable serializable code. Errors distinguish invalid IDs, closed repositories, stale generations, missing merge bases, unsafe repositories, timeout, cancellation, output limits, malformed Git data, content problems, watcher failures, and I/O failures.

FrontendError converts internal errors into a frontend-safe payload:

- code identifies the stable error category.
- message is suitable for display.
- retryable tells the caller whether retrying may succeed.
- repo_id and operation_id are available for boundary-layer context.

Raw Git stderr and raw I/O details are not exposed through the generic frontend messages for those error classes.

## 4. Using the library

### 4.1 Requirements

- Rust with Cargo.
- A locally installed git executable available on PATH.
- A non-bare local Git repository.
- A Tokio runtime, because the public operations are asynchronous.

The current package already declares all required dependencies in Cargo.toml.

### 4.2 Run the included example

The included example reports all staged, unstaged, and untracked changes:

    cd C:\rust\projects\github_diff
    cargo run --example show_changes -- "C:\python\games\website\backend"

For a clean repository it prints:

    Repository: backend
    Path: C:\python\games\website\backend
    No uncommitted changes.

### 4.3 Open a repository and list all uncommitted changes

    use github_diff::{ComparisonRequest, RepositoryRegistry};

    #[tokio::main]
    async fn main() -> Result<(), Box<dyn std::error::Error>> {
        let registry = RepositoryRegistry::system();
        let snapshot = registry
            .open_repository(r"C:\python\games\website\backend")
            .await?;

        let result = registry
            .create_comparison(
                &snapshot.repo_id,
                ComparisonRequest::AllUncommitted,
            )
            .await?;

        for file in &result.files {
            println!("{:?}: {}", file.status, file.display_path);
        }

        registry.close_repository(&snapshot.repo_id).await?;
        Ok(())
    }

Keep the returned RepoId and use it in every later call concerning that open repository.

### 4.4 Compare two branches

Do not construct RefId values yourself. Select them from RepositorySnapshot::references:

    let left = snapshot
        .references
        .iter()
        .find(|reference| reference.full_name == "refs/heads/main")
        .expect("main branch was not found")
        .id
        .clone();

    let right = snapshot
        .references
        .iter()
        .find(|reference| reference.full_name == "refs/heads/feature")
        .expect("feature branch was not found")
        .id
        .clone();

    let result = registry
        .create_comparison(
            &snapshot.repo_id,
            ComparisonRequest::Direct { left, right },
        )
        .await?;

Use ComparisonRequest::SinceMergeBase with the same IDs to show only changes made on the right branch since its common ancestor with the left branch.

This library never fetches remote state. A remote-tracking reference such as refs/remotes/origin/main represents the state already stored in the local repository.

### 4.5 Load the two sides of one file

    if let Some(file) = result.files.first() {
        let comparison = registry
            .get_file_comparison(
                &snapshot.repo_id,
                &result.comparison_id,
                &file.file_id,
            )
            .await?;

        println!("left source: {:?}", comparison.left.source);
        println!("right source: {:?}", comparison.right.source);

        if let github_diff::FileContent::Text { text, .. } =
            &comparison.right.content
        {
            println!("{text}");
        }
    }

The UI can match on FileContent instead of assuming every side is displayable text.

### 4.6 Receive repository update notifications

Subscribe before or after opening repositories:

    let registry = RepositoryRegistry::system();
    let mut updates = registry.subscribe();

    tokio::spawn(async move {
        while let Ok(update) = updates.recv().await {
            println!(
                "repository {} moved to generation {}",
                update.repo_id.0,
                update.generation
            );
        }
    });

After receiving an update, refresh the repository and replace older UI state with the returned snapshot.

### 4.7 Use the application boundary

Backend wraps an Arc<RepositoryRegistry> and exposes owned argument types that map cleanly to desktop command handlers:

    use github_diff::{Backend, ComparisonRequest};
    use std::path::PathBuf;

    let backend = Backend::system();
    let snapshot = backend
        .open_repository(PathBuf::from(r"C:\work\project"))
        .await?;
    let result = backend
        .create_comparison(
            snapshot.repo_id.clone(),
            ComparisonRequest::Unstaged,
        )
        .await?;

A Tauri layer can delegate commands to these methods and convert AppError into FrontendError without exposing Git argument construction to the frontend.

## 5. File-by-file guide

### Crate root and application boundary

#### src/lib.rs

The crate root declares the commands, error, git, model, and service modules. It re-exports Backend, the error types, every public model, RepositoryRegistry, and RepositoryUpdate, giving consumers a compact top-level API.

#### src/commands.rs

Defines the cloneable Backend adapter. It owns an Arc<RepositoryRegistry> and forwards capability, open, close, list, refresh, snapshot, comparison, and file-content requests. It contains no Git parsing or argument construction. This is the intended seam for Tauri commands or another IPC layer.

#### src/error.rs

Defines:

- Result as the crate result alias.
- ErrorCode as a stable serialized error classification.
- AppError as the detailed internal error type.
- AppError::code and AppError::retryable.
- FrontendError as a sanitized serializable error payload.

The conversion to FrontendError hides potentially sensitive Git stderr and I/O details.

### Model files

#### src/model/mod.rs

Declares all model submodules and re-exports their public types. Other layers generally import model types through crate-level re-exports.

#### src/model/repository.rs

Defines UUID-backed opaque ID types and the repository-level DTOs:

- RepoId, FileId, RefId, ComparisonId, and OperationId.
- ObjectFormat for SHA-1, SHA-256, or unknown formats.
- HeadState for branch, detached, or unborn HEAD.
- RepositoryInfo for canonical paths and repository capabilities.
- RepositorySnapshot for a generation-consistent set of info, refs, and status.
- BackendCapabilities for API version, Git version, and size limits.

#### src/model/reference.rs

Defines local/remote ReferenceKind, public GitReference records, the internal ResolvedRevision, and the public ResolvedRevisionSummary returned with comparisons.

#### src/model/status.rs

Defines ChangeKind, StatusEntry, and WorkingTreeStatus. StatusEntry carries presentation paths, staged/unstaged/conflict/submodule flags, rename similarity, Git modes, and relevant object IDs.

#### src/model/comparison.rs

Defines:

- ComparisonRequest, the tagged request enum for the five supported modes.
- ComparisonMode, the mode recorded in a result.
- ChangedFile, lightweight metadata for each changed path.
- ChangeTotals, aggregate counts.
- ComparisonResult, including opaque IDs, generation, resolved revision summaries, files, and totals.

#### src/model/content.rs

Defines the content-loading model:

- FileContent represents text, binary, too-large, missing, symlink, submodule, or unsupported-encoding results.
- FileSourceSummary describes where a public file side came from.
- ContentSource is the trusted internal loading instruction.
- FileSide and FileComparison are public left/right results.
- FileDescriptor privately binds a FileId to two trusted ContentSource values.

#### src/model/project.rs

Defines serializable persistent project configuration:

- ProjectDefinition and ProjectRepositoryDefinition.
- ProjectLayout.
- SavedComparisonPreference and SavedComparisonMode.

These types intentionally store stable repository paths and full reference names rather than runtime RepoId or RefId values. This file defines the schema only; it does not read or write project files.

### Git integration files

#### src/git/mod.rs

Declares the blob, diff, probe, refs, runner, and status Git submodules.

#### src/git/runner.rs

Implements the only subprocess execution layer. GitRunner detects Git, constructs direct process invocations, sanitizes the environment, applies timeout/cancellation/output bounds, drains stdout and stderr concurrently, maps failures, and emits content-safe tracing metadata.

Its unit tests cover bounded output, pre-cancellation, timeout, literal shell characters, and unsafe-repository error classification.

#### src/git/probe.rs

Validates an input directory and probes its canonical Git structure. It detects worktree, Git and common directories, bare/shallow state, object format, display name, and branch/detached/unborn HEAD. It also normalizes common not-a-repository failures and validates variable-width object IDs.

#### src/git/refs.rs

Defines the NUL-delimited for-each-ref format and parses reference records. It preserves worktree paths, classifies local versus remote refs, assigns RefId values, and validates object IDs. It also contains a parser for resolved revision records.

#### src/git/status.rs

Parses git status --porcelain=v2 -z. It handles branch headers, ordinary changes, renames/copies with a second NUL-delimited path, unmerged entries, untracked entries, and valid ignored records. It retains raw PathBuf values internally and converts parsed entries into public StatusEntry DTOs with new FileId values.

#### src/git/diff.rs

Defines DiffEndpoint and DiffPlan, produces the closed set of allowed diff command lines, parses NUL-delimited name-status output, and converts each entry into a FileDescriptor. It contains the logic for empty added/deleted sides, old rename paths, and conflict stages 2 and 3.

#### src/git/blob.rs

Builds commit and index cat-file commands from validated repository-relative paths. It implements bounded worktree reads with symlink rejection and changed-during-read detection, then classifies bytes as text, binary, oversized, or unsupported encoding.

### Service files

#### src/service/mod.rs

Keeps registry and watcher implementation modules private while re-exporting their public types.

#### src/service/registry.rs

This is the orchestration core of the library. It:

- Owns all open repository handles.
- Limits global Git process concurrency.
- Publishes RepositoryUpdate events.
- Opens, deduplicates, refreshes, lists, and closes repositories.
- Maintains generation-consistent snapshots and trusted ID maps.
- Resolves opaque references immediately before use.
- Computes merge bases and every supported comparison mode.
- Adds untracked entries to all-uncommitted comparisons.
- Detects Git links and file modes.
- Caches trusted file descriptors for on-demand loading.
- Loads commit, index, worktree, conflict, symlink, and submodule sides.
- Enforces metadata and file limits.
- Computes aggregate change totals.
- Rejects stale or unknown IDs and paths outside the repository.

Most higher-level behavior is implemented here by composing the smaller git parsers and model types.

#### src/service/watcher.rs

Wraps notify::RecommendedWatcher. It installs worktree and Git metadata watches, filters access events, debounces changes, calls a thread-safe callback, and cancels its Tokio task when dropped.

### Runnable example

#### examples/show_changes.rs

A small command-line example that accepts one repository path, opens it, creates an AllUncommitted comparison, prints changed files with their staged/unstaged state, and closes the repository.

Run it with:

    cargo run --example show_changes -- "C:\path\to\repository"

### Integration tests

#### tests/api.rs

Checks serialized API stability and boundary safety. It verifies tagged comparison enums, project-definition JSON round trips, and that FrontendError does not expose raw Git stderr paths.

#### tests/backend.rs

Creates real temporary repositories and exercises the main behavior end to end:

- Opening from a nested directory and closing.
- Direct versus merge-base semantics.
- Staged, unstaged, untracked, and all-uncommitted changes.
- Added, deleted, and renamed file sides.
- Detached, unborn, and bare repository behavior.
- Isolation between two simultaneously open repositories.
- Conflict stage 2 and 3 content.
- Watcher invalidation and manual refresh.

#### tests/edge_cases.rs

Exercises security, portability, and unusual Git states:

- Unrelated histories.
- Binary and oversized content.
- Spaces, Unicode, shell characters, tabs, and other unusual filenames.
- Linked worktrees.
- Rejection of forged opaque reference IDs.
- Worktree and committed symbolic links.
- Duplicate-open deduplication.
- Oversized committed blobs.
- Committed gitlinks/submodules.

The tests invoke real local Git commands to verify behavior against Git itself rather than mocks.

## 6. Supporting project files

### Cargo.toml

Defines the Rust 2024 crate and its dependencies:

- tokio and tokio-util for async processes, synchronization, timeouts, and cancellation.
- notify for filesystem watching.
- serde for request/response and project serialization.
- thiserror for typed errors.
- uuid for opaque runtime identifiers.
- tracing for content-safe diagnostics.
- serde_json and tempfile as test-only dependencies.

### README.md

Provides the short project overview, a compact API sample, principal capabilities, and verification commands. This guide expands on it with implementation and file-level detail.

### Cargo.lock

Pins the exact dependency graph for reproducible builds of the current project.

### target/

Contains generated Cargo build artifacts and generated dependency source fragments. Files under target are not authored source files and are intentionally excluded from the file-by-file implementation guide.

## 7. Verification and development commands

From the repository root:

    cargo fmt --all -- --check
    cargo test --all
    cargo clippy --all-targets --all-features -- -D warnings

To inspect one repository manually:

    cargo run --example show_changes -- "C:\path\to\repository"

The test suite requires Git to be available on PATH because it creates and inspects real temporary repositories.

## 8. Typical frontend integration sequence

1. Create one long-lived Backend or RepositoryRegistry.
2. Optionally query capabilities.
3. Subscribe to RepositoryUpdate events.
4. Open one or more repositories and retain each RepoId.
5. Display snapshot references and status.
6. Create a comparison using only RefId values from the latest snapshot.
7. Display ChangedFile metadata.
8. Load FileComparison only when a file is selected.
9. Refresh and replace state after watcher notifications.
10. Recreate stale comparisons after a generation change.
11. Close each repository when it is removed from the application.

This lifecycle preserves the library's main invariants: Git remains the source of truth, frontend input cannot become arbitrary Git syntax, expensive content is loaded lazily, and asynchronous results never silently cross repository generations.
