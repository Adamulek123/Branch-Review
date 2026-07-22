# Branch Review desktop application

Branch Review is a dark, compact Tauri 2 desktop UI over the repository’s read-only Rust backend. It supports saved projects, multiple concurrently open repositories, working-tree and branch comparisons, live watcher invalidation, keyboard navigation, and typed handling for text, binary, oversized, missing, symlink, submodule, and unsupported-encoding content.

## Security and data boundaries

- The app runs entirely locally and performs no network operations.
- Git operations are restricted by the backend’s closed set of read-only commands.
- The renderer has no filesystem or shell permissions. The folder picker is a Rust command.
- The main capability grants only Tauri core defaults and event listen/unlisten.
- Projects are schema-versioned in the OS application config directory. Runtime repository IDs, generations, comparison IDs, file IDs, results, and file bodies are never persisted.
- Monaco is loaded from the packaged application only when text content is selected; no CDN is used.

## Development

Use pnpm 11.9.0. The global npm installation is not required.

```text
pnpm install
pnpm tauri dev
```

The desktop window has a 1024×680 minimum. The repository and file pane sizes are stored as disposable local preferences. Saved project membership and comparison defaults are written by the Rust project store.

## Tests

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

`pnpm test` runs contract, lifecycle, state, component, accessibility, content-renderer, and mocked IPC renderer tests. `pnpm test:e2e` also builds a debug Tauri executable, creates an isolated real Git repository, and drives the native Windows WebView2 application with WebdriverIO. On a clean machine, the WebDriver service may install `tauri-driver` and download a matching Edge driver on its first run. The ignored `.wdio-data/` directory keeps test projects and repositories separate from personal Branch Review data.

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
