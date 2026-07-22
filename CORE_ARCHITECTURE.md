# Git Branch Comparator Core Architecture

## 1. Document status

This document defines the target architecture for the desktop frontend that consumes the
`github_diff` Rust crate. It describes the responsibilities, boundaries, data flow, state model,
and implementation order for the first production version.

The selected application stack is:

- **Desktop runtime:** Tauri 2
- **Frontend language:** TypeScript with strict type checking
- **UI framework:** React
- **Frontend build tool:** Vite
- **Asynchronous backend-state cache:** TanStack Query
- **Text diff renderer:** Monaco Diff Editor, loaded on demand
- **Styling:** CSS Modules and global CSS custom properties
- **Backend:** the existing `github_diff` Rust crate

This is a local desktop application. It does not require an HTTP server, a Node.js server, a
database, or a cloud service.

## 2. Product responsibility

The application lets a user open one or more local Git repositories and inspect:

- Local and remote-tracking branches already present on disk.
- Staged, unstaged, untracked, renamed, copied, conflicted, and submodule changes.
- Direct comparisons between two branches.
- Changes on one branch since its merge base with another branch.
- The two sides of an individual changed file.

The initial application remains read-only. It must not fetch, pull, push, checkout, stage,
commit, reset, merge, edit files, or change Git configuration.

## 3. Architectural principles

### 3.1 Rust owns repository truth

The Rust backend is the only layer allowed to:

- Execute Git.
- Resolve repository paths.
- Resolve references and object IDs.
- Read worktree, index, or committed file content.
- Decide whether an identifier is current and valid.
- Enforce file-size, output-size, timeout, and path-safety limits.

The frontend must never assemble Git commands, revision expressions, blob expressions, or trusted
filesystem paths.

### 3.2 The frontend owns presentation

The React frontend is responsible for:

- Repository, reference, and comparison selection.
- Loading and empty states.
- Filtering and arranging changed files.
- Choosing split or unified diff presentation.
- Rendering all `FileContent` variants.
- Keyboard, focus, theme, and accessibility behavior.
- Discarding asynchronous responses that belong to an older repository generation.

### 3.3 Tauri is a narrow boundary

The Tauri Rust crate is an adapter, not a second business-logic layer. It:

- Owns one long-lived `github_diff::Backend` instance.
- Exposes a closed set of typed commands.
- Converts `AppError` into `FrontendError`.
- Converts repository updates into serializable Tauri events.
- Opens native folder dialogs.
- Loads and saves application-level project configuration.
- Controls desktop-window lifecycle and permissions.

Git behavior must not be reimplemented in Tauri commands.

### 3.4 Runtime identifiers are temporary capabilities

`RepoId`, `RefId`, `ComparisonId`, and `FileId` are opaque runtime values. The frontend may keep
them in memory, but must not manufacture, reinterpret, or persist them.

Persistent project preferences use repository paths and full reference names. They are resolved
to fresh runtime IDs whenever the application opens a repository.

### 3.5 Repository generations determine freshness

Completion order does not determine whether an asynchronous response is current. Every
repository-derived response must be accepted only when its `generation` is at least the newest
generation already observed for that repository.

When the repository changes, cached comparisons and file IDs may expire. The frontend must treat
this as normal lifecycle behavior, not as an exceptional application failure.

## 4. System overview

```text
+------------------------- Desktop application --------------------------+
|                                                                         |
|  React components                                                       |
|       |                                                                 |
|       v                                                                 |
|  UI state + TanStack Query cache                                        |
|       |                                                                 |
|       v                                                                 |
|  Typed TypeScript backend client                                        |
|       | Tauri commands                       ^ repository update event   |
|       v                                      |                           |
|  Tauri command/event adapter ---------------------------------------+   |
|       |                                                              |   |
|       v                                                              |   |
|  github_diff::Backend                                                |   |
|       |                                                              |   |
|       v                                                              |   |
|  RepositoryRegistry <---------------- RepositoryWatcher -------------+   |
|       |                                                                  |
|       v                                                                  |
|  Installed Git executable and local repository files                     |
|                                                                         |
+-------------------------------------------------------------------------+
```

The primary request flow is:

1. A React feature calls a typed function in the frontend backend client.
2. The client invokes one named Tauri command.
3. The Tauri command delegates to the shared Rust `Backend`.
4. The backend returns a serializable DTO or a typed error.
5. The frontend cache stores the result under a generation-aware key.
6. Components render the typed result.

Repository invalidation flows in the opposite direction as a small event. File content and
comparison results continue to use request/response commands; they are not pushed through events.

## 5. Suggested repository structure

The existing crate remains independently testable and reusable. The desktop application lives in
a separate child directory.

```text
github_diff/
|-- Cargo.toml                     # Existing backend crate
|-- src/                           # Existing backend implementation
|-- tests/                         # Existing backend integration tests
|-- CODEBASE_GUIDE.md
|-- CORE_ARCHITECTURE.md
`-- app/
    |-- package.json
    |-- vite.config.ts
    |-- tsconfig.json
    |-- index.html
    |-- src/
    |   |-- api/
    |   |   |-- backend.ts         # The only module that calls Tauri invoke
    |   |   |-- events.ts          # Tauri event registration and cleanup
    |   |   `-- types.ts           # TypeScript transport DTOs
    |   |-- app/
    |   |   |-- App.tsx
    |   |   |-- providers.tsx
    |   |   `-- query-client.ts
    |   |-- components/            # Shared presentational components
    |   |-- features/
    |   |   |-- repositories/
    |   |   |-- comparisons/
    |   |   |-- file-diff/
    |   |   `-- projects/
    |   |-- state/                 # UI-only state
    |   |-- styles/
    |   `-- main.tsx
    `-- src-tauri/
        |-- Cargo.toml             # Depends on github_diff by path
        |-- tauri.conf.json
        |-- capabilities/
        `-- src/
            |-- commands.rs
            |-- events.rs
            |-- persistence.rs
            |-- state.rs
            `-- lib.rs
```

The frontend must not import `@tauri-apps/api` throughout feature components. All IPC calls stay
behind `api/backend.ts` and `api/events.ts`. This makes components easier to test in a browser-like
environment with a fake client.

## 6. Tauri application boundary

### 6.1 Managed state

Tauri application state contains one cloneable backend handle:

```rust,ignore
struct AppState {
    backend: github_diff::Backend,
}
```

`Backend::system()` is created once during application setup. A new registry must not be created
for each command because open repositories, opaque ID maps, cached comparisons, watchers, and
generations all belong to the long-lived registry.

### 6.2 Commands

The first version exposes these commands:

| Command | Input | Output | Purpose |
| --- | --- | --- | --- |
| `get_backend_capabilities` | none | `BackendCapabilities` | Verify Git and API capabilities at startup. |
| `open_repository` | path | `RepositorySnapshot` | Open or deduplicate a local worktree. |
| `close_repository` | `RepoId` | unit | Remove a repository from the live registry. |
| `list_open_repositories` | none | `RepositoryInfo[]` | Recover live state when needed. |
| `refresh_repository` | `RepoId` | `RepositorySnapshot` | Refresh after invalidation or manual action. |
| `get_repository_snapshot` | `RepoId` | `RepositorySnapshot` | Read the last consistent snapshot. |
| `create_comparison` | `RepoId`, `ComparisonRequest` | `ComparisonResult` | Produce changed-file metadata. |
| `get_file_comparison` | repository, comparison, and file IDs | `FileComparison` | Lazily load both sides of one file. |
| `pick_repository_directory` | none | path or cancellation | Open a native folder picker. |
| `load_projects` | none | `ProjectDefinition[]` | Load stable application configuration. |
| `save_project` | `ProjectDefinition` | unit | Validate and persist a project. |
| `delete_project` | project ID | unit | Delete one saved project definition. |

Each command returns a DTO on success and a frontend-safe error on failure. The shell maps
`AppError` into `FrontendError`; raw Git stderr and raw I/O details must never be sent into the
webview.

Use explicit argument structs at the command boundary instead of commands with many unrelated
parameters. The TypeScript API client hides transport naming and exposes normal typed functions to
the rest of the frontend.

### 6.3 Update event

The shell subscribes once to `Backend::registry().subscribe()` and forwards each update as a
window-scoped event named:

```text
repository://updated
```

The event payload is owned by the Tauri shell:

```rust,ignore
#[derive(Clone, serde::Serialize)]
struct RepositoryUpdatedPayload {
    repo_id: String,
    generation: u64,
}
```

Mapping into a shell-owned event DTO avoids adding Tauri-specific serialization requirements to
the reusable backend's `RepositoryUpdate` type.

Events carry invalidation signals only. They must not carry snapshots or file bodies. Tauri events
are suitable for small notifications, while commands provide a clearer typed request/response
boundary for substantive data.

The frontend registers the event listener once near the application root and always calls the
returned unlisten function during cleanup.

### 6.4 Capabilities and security

The main webview receives only the capabilities required for:

- Calling the declared application commands.
- Receiving the repository update event.
- Using the native dialog functionality selected by the shell.
- Normal window behavior.

Do not expose a shell plugin, arbitrary process execution, unrestricted filesystem access, or
remote web content. Keep a restrictive Content Security Policy and package frontend assets with
the application.

## 7. TypeScript transport model

TypeScript uses strict mode and models Rust tagged enums as discriminated unions. Transport DTO
property names should match the serialized Rust names, which are currently snake case.

Representative types:

```ts
type RepoId = string;
type RefId = string;
type ComparisonId = string;
type FileId = string;

type ComparisonRequest =
  | { mode: "direct"; left: RefId; right: RefId }
  | { mode: "since_merge_base"; left: RefId; right: RefId }
  | { mode: "unstaged" }
  | { mode: "staged" }
  | { mode: "all_uncommitted" };

type FileContent =
  | { kind: "text"; text: string; encoding: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "too_large"; size: number; limit: number }
  | { kind: "missing" }
  | { kind: "symlink"; target: string }
  | { kind: "submodule"; commit_oid: string | null }
  | { kind: "unsupported_encoding"; size: number };

type FrontendError = {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  repo_id: string | null;
  operation_id: string | null;
};
```

Opaque IDs may initially be aliases of `string`. Branded TypeScript types are recommended once the
API layer is in place because they prevent accidentally passing a `FileId` where a `RefId` is
required.

Do not scatter unchecked type assertions around the UI. Maintain a single authoritative transport
type file, and add contract tests comparing representative Rust JSON with frontend expectations.
Type generation may be introduced later, but it should not make the reusable backend crate depend
on a frontend framework.

## 8. Frontend state ownership

### 8.1 Backend-derived state

TanStack Query owns asynchronous values returned from Rust:

- Backend capabilities.
- Repository snapshots.
- Comparison results.
- File comparisons.
- Saved project definitions.

Recommended query keys are:

```ts
["capabilities"]
["repository", repoId, generation]
["comparison", repoId, generation, comparisonDescriptor]
["file", repoId, generation, comparisonId, fileId]
["projects"]
```

`comparisonDescriptor` must be a stable, serializable representation of the selected mode and
references. The active generation belongs in every repository-derived key so data from two
repository states cannot occupy the same cache entry.

Recommended query behavior:

- Disable polling.
- Disable automatic refetch on window focus.
- Do not retry non-retryable `FrontendError` values.
- Retry retryable errors at most once by default.
- Fetch file content only when a file is selected.
- Optionally prefetch the next file after selection behavior is measured.
- Remove repository-specific cached data when the repository is closed.

### 8.2 UI-only state

React context with `useReducer`, or a small dedicated store, owns ephemeral presentation state:

- Active project and repository.
- Active file.
- Split or unified diff mode.
- Sidebar and file-list widths.
- File filters and search text.
- Theme.
- Expanded tree nodes.
- Keyboard-navigation position.

Do not copy snapshots, comparisons, or file bodies into the UI store. A single owner for each kind
of state prevents the query cache and UI store from disagreeing.

### 8.3 Persisted state

Persist only stable preferences:

- Project ID and name.
- Repository paths, labels, order, and layout.
- Default comparison mode.
- Full reference names for branch preferences.
- Theme and non-sensitive presentation preferences.

Never persist runtime IDs, repository generations, comparison results, file content, or Git object
data.

## 9. Repository lifecycle

### 9.1 Application startup

1. Create the Tauri-managed `Backend`.
2. Start the repository-update forwarding task.
3. Mount the React application and its providers.
4. Register the frontend update listener.
5. Call `get_backend_capabilities`.
6. Load saved projects.
7. Open repositories belonging to the selected project.
8. Match saved full reference names against each new snapshot.
9. Select a valid default comparison or fall back to all uncommitted changes.

A Git-not-found or unsupported-Git result produces a blocking setup screen. Failure to open one
saved repository must not prevent other repositories from opening.

### 9.2 Opening a repository

1. The user invokes the native directory picker.
2. Cancellation ends the flow without an error toast.
3. The selected path is sent to `open_repository`.
4. The returned snapshot supplies all initial repository state and runtime IDs.
5. The repository is added to the active project only after opening succeeds.
6. If the backend deduplicates an already-open worktree, the UI selects the existing repository.

The frontend displays the canonical worktree root returned by Rust rather than assuming the picked
directory is the repository root.

### 9.3 Closing a repository

1. Stop initiating new requests for the repository.
2. Call `close_repository`.
3. Remove repository-specific query entries and UI selection.
4. Select another open repository or show the empty state.
5. Separately update the project definition if the user intended permanent removal.

Closing a live repository and removing it from a saved project are distinct operations.

## 10. Comparison lifecycle

### 10.1 Mode selection

The UI supports exactly the modes represented by `ComparisonRequest`:

| Mode | Required selection | UI meaning |
| --- | --- | --- |
| `direct` | left and right references | Compare the two branch tips. |
| `since_merge_base` | left and right references | Show changes made on the right since divergence. |
| `unstaged` | none | Compare index with worktree. |
| `staged` | none | Compare HEAD, or empty HEAD, with index. |
| `all_uncommitted` | none | Compare HEAD, or empty HEAD, with the worktree and include untracked files. |

Only reference IDs from the latest accepted snapshot may be submitted. Disable comparison actions
while required selections are missing.

Remote-tracking branches must be labelled as local cached state; selecting one does not contact a
remote server.

### 10.2 Comparison result

`create_comparison` returns changed-file metadata, totals, resolved revision summaries, and a
`ComparisonId`. It deliberately does not return all file bodies.

The frontend uses the result to render:

- Total and per-status counts.
- A filterable changed-file list.
- Rename or copy origin paths.
- Conflict, staging, and submodule indicators.
- Resolved commit labels for branch comparisons.

If a newly created comparison does not contain the previously selected file, select the first
visible file or show the no-file-selected state.

### 10.3 File content

Call `get_file_comparison` only for the selected changed file. Render content by variant:

| Content kind | Presentation |
| --- | --- |
| `text` | Read-only Monaco diff model. |
| `binary` | Binary-file panel with size; no attempt to decode. |
| `too_large` | Size and configured limit with an explanation. |
| `missing` | Empty/deleted-side treatment. |
| `symlink` | Link-target comparison. |
| `submodule` | Old/new submodule commit IDs. |
| `unsupported_encoding` | Encoding-not-supported message with size. |

Monaco should be dynamically imported the first time text content is displayed. Models must be
disposed when no longer used. Both sides are read-only; the application is a comparator, not an
editor.

Use filename extension only as a presentation hint for Monaco language selection. It has no role
in backend content classification or security.

## 11. Generation and invalidation algorithm

Maintain `latestGenerationByRepo` outside individual components.

When any command returns repository-derived data:

1. Read its `repo_id` and `generation`.
2. Compare the generation with the latest observed value for that repository.
3. Discard the result if its generation is lower.
4. Otherwise record the generation and allow the cache update.

When `repository://updated` arrives:

1. Ignore the event if its generation is not newer than the recorded generation.
2. Record the newer generation immediately.
3. Mark the visible comparison as refreshing or outdated.
4. Invalidate old repository, comparison, and file queries.
5. Coalesce multiple events for the same repository into one refresh operation.
6. Call `refresh_repository`.
7. Accept only a snapshot that is not older than the recorded generation.
8. Re-resolve saved full reference names using the new reference list.
9. Recreate the active comparison.
10. Reload the selected file if it still exists.

An older promise resolving after step 2 must not replace the newer state.

Treat these errors as lifecycle signals:

- `STALE_GENERATION`: refresh and recreate the operation once.
- `INVALID_COMPARISON_ID`: recreate the comparison, then retry file loading once.
- `INVALID_REFERENCE_ID` or `REFERENCE_MOVED_OR_DELETED`: refresh references and require a new
  selection if the saved full name no longer exists.
- `REPOSITORY_CLOSED`: remove the repository from live UI state.

Retries must be bounded so a repository changing continuously cannot create an infinite loop.

## 12. Primary interface composition

The main window uses a three-pane desktop layout:

```text
+------------------+-------------------------+-----------------------------+
| Repositories     | Changed files           | File comparison             |
|                  |                         |                             |
| Project A        | Filter and totals       | Left label | Right label    |
| - repository-1   | M src/main.rs           |                             |
| - repository-2   | A src/new_file.rs       | Split or unified diff       |
|                  | R old.rs -> new.rs      |                             |
| + Add repository |                         |                             |
+------------------+-------------------------+-----------------------------+
| Comparison mode | Left reference | Right reference | Refresh | Status  |
+------------------------------------------------------------------------+
```

The precise visual design may evolve, but the core areas are:

- **Repository navigation:** open repositories, HEAD state, dirty indicator, and project grouping.
- **Comparison toolbar:** mode, branch selectors, manual refresh, resolved commits, and update state.
- **Changed-file navigator:** search, status filters, totals, rename paths, and keyboard selection.
- **Content viewer:** text diff or a typed non-text presentation.
- **Notification layer:** scoped errors, retry action, and non-blocking watcher warnings.

Use virtual scrolling if repositories with thousands of changed files are a supported target.
Preserve keyboard focus when a background refresh replaces data.

## 13. Error handling

The API client normalizes rejected Tauri invocations into `FrontendError`. Components should not
parse error messages to decide behavior; they switch on `code` and use `retryable` for policy.

Present errors at the narrowest useful scope:

- Startup capability failures: full-window setup state.
- Repository open failures: repository picker or add-repository flow.
- Comparison failures: comparison panel with retry or selection guidance.
- File failures: content pane without hiding the changed-file list.
- Watcher unavailable: non-blocking warning plus a manual refresh action.

Log error code, operation ID, and application context. Do not log file bodies, arbitrary repository
paths, raw Git output, or secrets. User-facing messages come from `FrontendError.message`, with
specific additional guidance selected by error code.

## 14. Project persistence

The existing `ProjectDefinition` model is the persistent schema. The Tauri shell owns storage in
the operating system's application configuration directory.

Persistence requirements:

- Validate `schema_version` before use.
- Preserve unknown future data only if an explicit migration design supports it.
- Write to a temporary file and atomically replace the prior file where the platform allows.
- Serialize paths without treating them as Git revisions or shell input.
- Resolve project repository paths through `open_repository` at runtime.
- Resolve `left_full_ref` and `right_full_ref` against the current snapshot.
- Surface unavailable repositories without deleting their saved definitions.

The frontend may use browser storage for disposable presentation details, but project definitions
must use the Rust persistence boundary.

## 15. Performance rules

- Never eagerly load every changed file's body.
- Dynamically load Monaco.
- Dispose Monaco models after use.
- Cache the currently selected file comparison by all runtime IDs and generation.
- Cancel or ignore obsolete frontend work when selection changes.
- Keep filesystem-update events small.
- Debounce UI-triggered search and coalesce refreshes, while respecting the backend's own watcher
  debounce.
- Virtualize large file lists after measuring the simple implementation.
- Do not duplicate large text values across multiple frontend stores.
- Show progressive loading states instead of blocking the entire window.

The backend enforces a 5 MiB content limit, but the frontend should still measure diff-rendering
costs for large text files and may use a lower presentation threshold if necessary.

## 16. Accessibility and desktop behavior

Core workflows must be keyboard-operable:

- Move between repositories and changed files.
- Open branch selectors.
- Switch comparison mode.
- Toggle split and unified diff views.
- Focus the file filter.
- Trigger manual refresh.

Status must not be communicated by color alone. Pair colors with text or icons and accessible
labels. Maintain visible focus, sufficient contrast, scalable typography, reduced-motion behavior,
and screen-reader labels for icon-only controls.

Window resizing must preserve a usable content pane. Store pane sizes as presentation preferences,
not as part of project repository data.

## 17. Testing strategy

### 17.1 Rust backend

Keep the existing real-Git integration suite as the source of truth for Git behavior. Continue to
run:

```text
cargo fmt --all -- --check
cargo test --all
cargo clippy --all-targets --all-features -- -D warnings
```

### 17.2 Tauri boundary

Test that:

- Each command delegates to the shared backend.
- Every `AppError` becomes a sanitized `FrontendError`.
- Repository updates map to the documented event payload.
- Project writes and schema validation behave correctly.
- Only intended commands and capabilities are exposed.

### 17.3 TypeScript and React

Use Vitest and React Testing Library for:

- Exhaustive rendering of every tagged content variant.
- Comparison-mode validation.
- Error-code presentation.
- Generation rejection and out-of-order completion.
- Update-event cleanup.
- Query invalidation and bounded retry behavior.
- Repository and file keyboard navigation.

The TypeScript build must run `tsc --noEmit` because Vite transpiles TypeScript but does not replace
static type checking.

### 17.4 Contract fixtures

Rust tests should serialize representative DTOs to JSON fixtures. TypeScript tests load those
fixtures and verify their expected shapes. Include every tagged-enum variant and nullable field.
This detects accidental changes in enum tags, field names, and optional-value representation.

### 17.5 End-to-end scenarios

At minimum, cover:

- Open and close a repository.
- Direct and merge-base comparisons.
- Staged, unstaged, and all-uncommitted views.
- Added, deleted, renamed, conflicted, binary, large, symlink, and submodule files.
- Watcher invalidation during an in-flight comparison.
- Missing saved branch or repository.
- Detached and unborn HEAD.
- Two repositories changing independently.

## 18. Implementation phases

### Phase 1: application shell

- Create the React, TypeScript, and Vite application.
- Create the Tauri 2 shell as a path-dependent consumer of `github_diff`.
- Register managed backend state and the eight existing backend commands.
- Add strict TypeScript transport types and error normalization.
- Verify capabilities and open one repository.

### Phase 2: primary comparison workflow

- Build repository navigation and the comparison toolbar.
- Render changed-file metadata and totals.
- Load one selected file on demand.
- Render every non-text content type.
- Integrate a lazy, read-only Monaco Diff Editor.

### Phase 3: live repository lifecycle

- Forward repository-update events.
- Implement generation tracking and stale-response rejection.
- Refresh and recreate comparisons after updates.
- Support multiple repositories without cross-repository cache collisions.

### Phase 4: projects and polish

- Add project persistence and reference preference resolution.
- Add native folder selection and repository recovery states.
- Add filters, resizable panes, theme, keyboard navigation, and accessibility refinement.
- Add contract and end-to-end coverage.

## 19. Decisions deliberately deferred

The following are not required for the core architecture and should be decided only when a real
need appears:

- Automatic fetching of remotes.
- Editing, staging, committing, or other mutating Git operations.
- Multiple application windows.
- Cloud synchronization of project definitions.
- Plugin architecture.
- A database.
- Background indexing or search across file contents.
- Automatic TypeScript generation from Rust DTOs.
- Three-way merge editing.

Adding any mutating Git feature requires a separate security and product design. It must not be
implemented by weakening the existing read-only command boundary.

## 20. Definition of architectural success

The first production architecture is successful when:

- The existing Rust crate remains usable without Tauri.
- React never executes Git or reads repository files directly.
- All IPC is routed through one typed frontend client and a small Tauri adapter.
- Old asynchronous results cannot overwrite a newer repository generation.
- Runtime IDs are never persisted.
- File content is loaded lazily and every content variant has a deliberate UI.
- Multiple repositories remain isolated in backend and frontend state.
- Project storage contains only stable paths, full reference names, and preferences.
- The packaged app operates locally without an HTTP server or network dependency.
- The read-only security guarantees described in `CODEBASE_GUIDE.md` remain intact.
