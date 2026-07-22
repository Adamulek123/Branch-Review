use std::{path::Path, sync::Arc, time::Duration};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tokio_util::sync::CancellationToken;

use crate::{AppError, RepositoryInfo, Result};

pub struct RepositoryWatcher {
    _watcher: RecommendedWatcher,
    cancellation: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

impl RepositoryWatcher {
    pub fn start(info: &RepositoryInfo, on_change: Arc<dyn Fn() + Send + Sync>) -> Result<Self> {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let mut watcher =
            notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
                if let Ok(event) = event
                    && !matches!(event.kind, EventKind::Access(_))
                {
                    let _ = tx.send(());
                }
            })
            .map_err(|e| AppError::WatcherUnavailable(e.to_string()))?;

        watch_if_exists(&mut watcher, &info.worktree_root, RecursiveMode::Recursive)?;
        watch_if_exists(&mut watcher, &info.git_dir, RecursiveMode::NonRecursive)?;
        watch_if_exists(
            &mut watcher,
            &info.git_common_dir,
            RecursiveMode::NonRecursive,
        )?;
        watch_if_exists(
            &mut watcher,
            &info.git_dir.join("HEAD"),
            RecursiveMode::NonRecursive,
        )?;
        watch_if_exists(
            &mut watcher,
            &info.git_dir.join("index"),
            RecursiveMode::NonRecursive,
        )?;
        watch_if_exists(
            &mut watcher,
            &info.git_common_dir.join("refs"),
            RecursiveMode::Recursive,
        )?;
        watch_if_exists(
            &mut watcher,
            &info.git_common_dir.join("packed-refs"),
            RecursiveMode::NonRecursive,
        )?;

        let cancellation = CancellationToken::new();
        let token = cancellation.clone();
        let task = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = token.cancelled() => break,
                    event = rx.recv() => {
                        if event.is_none() { break; }
                        let delay = tokio::time::sleep(Duration::from_millis(350));
                        tokio::pin!(delay);
                        loop {
                            tokio::select! {
                                _ = token.cancelled() => return,
                                _ = &mut delay => break,
                                event = rx.recv() => if event.is_none() { return; },
                            }
                        }
                        on_change();
                    }
                }
            }
        });
        Ok(Self {
            _watcher: watcher,
            cancellation,
            task,
        })
    }
}

impl Drop for RepositoryWatcher {
    fn drop(&mut self) {
        self.cancellation.cancel();
        self.task.abort();
    }
}

fn watch_if_exists(
    watcher: &mut RecommendedWatcher,
    path: &Path,
    mode: RecursiveMode,
) -> Result<()> {
    if path.exists() {
        watcher
            .watch(path, mode)
            .map_err(|e| AppError::WatcherUnavailable(e.to_string()))?;
    }
    Ok(())
}
