# Branch Review desktop application

Branch Review is a dark, compact Tauri 2 desktop UI over the repository’s read-only comparison backend. It supports saved projects, multiple concurrently open repositories, working-tree and branch comparisons, AI-assisted audit, opt-in remediation, live watcher invalidation, keyboard navigation, and typed handling for text, binary, oversized, missing, symlink, submodule, and unsupported-encoding content.

## Security and data boundaries

- Comparison stays local. AI Audit sends a bounded snapshot through the user's signed-in Codex account; changed files and unchanged tracked or unignored repository context can be included.
- Audit path exclusions omit matching files and directories from the snapshot. Heuristic path filtering cannot guarantee detection of inline secrets in ordinary source files.
- Remediation is opt-in and runs Codex with repository-scoped workspace write access, network disabled, and Git metadata protected.
- Git operations are restricted by the backend’s closed set of read-only commands.
- The renderer has no filesystem or shell permissions. The folder picker is a Rust command.
- The main capability grants Tauri core/event access plus updater and process-restart permissions; it grants no filesystem or shell capability.
- Projects and minimal remediation thread mappings are stored in the OS application config directory. Private audit bundles are stored in the application cache until deletion or the next startup; Codex owns remediation transcripts.
- Monaco is loaded from the packaged application only when text content is selected; no CDN is used.

## Development

Use pnpm 11.9.0. The global npm installation is not required.

```text
pnpm install
pnpm inspect
```

`pnpm inspect` creates a disposable Git repository with committed, modified, and
untracked files, then opens the real Tauri application against it. The fixture
and project configuration live under the ignored `app/.wdio-data/` directory,
so this mode never reads or overwrites your normal saved projects. Frontend
changes hot-reload while the window is open.

Use `pnpm tauri dev` instead when you intentionally want to run against your
normal local Branch Review configuration.

The desktop window has a 1024×680 minimum. The repository and file pane sizes are stored as disposable local preferences. Saved project membership and comparison defaults are written by the Rust project store.

## Tests

```text
pnpm test:watch
pnpm check:local
pnpm check:full
pnpm test:visual
```

`pnpm test:watch` is the tight frontend feedback loop. `pnpm check:local`
matches the automated release checks: type checking, lint, renderer tests, the
Rust workspace, and the Tauri command layer. `pnpm check:full` adds mocked
end-to-end coverage and the native desktop smoke test.

`pnpm test:visual` builds the debug desktop executable, creates the same
isolated repository used by `pnpm inspect`, drives the native Windows WebView2
application, and writes a screenshot to
`app/test-results/desktop-smoke.png`. Open that file after the run to inspect
the rendered result or compare it with a previous run. On a clean machine, the
WebDriver service may install `tauri-driver` and download a matching Edge
driver on its first run.

## Packaging

```text
pnpm tauri build
```

The Windows MSI and NSIS installers are emitted under `src-tauri/target/release/bundle/`. The release application does not include WebDriver plugins or test capabilities.

## Keyboard reference

- `Ctrl/Cmd+O`: add a local repository
- `Ctrl/Cmd+K`: open commands
- `Ctrl/Cmd+F`: focus the changed-file filter
- `Ctrl/Cmd+R`: refresh the active repository
- `J` / `K` or arrow keys: navigate changed files
- `Alt+Up` / `Alt+Down`: change repository
- `Shift+D`: toggle split/unified diff
- `?`: show keyboard shortcuts
