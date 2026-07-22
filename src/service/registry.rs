use std::{
    collections::{HashMap, HashSet, VecDeque},
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

use tokio::sync::{Mutex, RwLock, Semaphore, broadcast};
use tokio_util::sync::CancellationToken;

use crate::{
    error::{AppError, Result},
    git::{
        blob::{
            BlobCommand, classify_content, commit_blob_command, index_blob_command,
            read_worktree_file,
        },
        diff::{
            DiffEndpoint, NameStatusEntry, comparison_plan, descriptor_for, parse_name_status_z,
        },
        probe::probe_repository,
        refs::{FOR_EACH_REF_FORMAT, parse_for_each_ref},
        runner::{GitOutput, GitRunner},
        status::{into_working_tree_status, parse_porcelain_v2_z},
    },
    model::*,
};

use super::watcher::RepositoryWatcher;

pub const METADATA_LIMIT: usize = 10 * 1024 * 1024;
pub const FILE_LIMIT: u64 = 5 * 1024 * 1024;
const MAX_COMPARISONS: usize = 32;

#[derive(Debug, Clone)]
pub struct RepositoryUpdate {
    pub repo_id: RepoId,
    pub generation: u64,
}

struct CachedComparison {
    id: ComparisonId,
    generation: u64,
    descriptors: HashMap<FileId, FileDescriptor>,
}

struct RepositoryHandle {
    worktree_root: PathBuf,
    info: RwLock<RepositoryInfo>,
    generation: AtomicU64,
    open_count: AtomicUsize,
    refresh_lock: Mutex<()>,
    snapshot: RwLock<Option<Arc<RepositorySnapshot>>>,
    ref_ids: RwLock<HashMap<RefId, String>>,
    status_paths: RwLock<HashMap<FileId, PathBuf>>,
    comparisons: Mutex<VecDeque<CachedComparison>>,
    cancellation: CancellationToken,
    watcher: Mutex<Option<RepositoryWatcher>>,
}

impl RepositoryHandle {
    fn new(info: RepositoryInfo) -> Self {
        Self {
            worktree_root: info.worktree_root.clone(),
            info: RwLock::new(info),
            generation: AtomicU64::new(0),
            open_count: AtomicUsize::new(1),
            refresh_lock: Mutex::new(()),
            snapshot: RwLock::new(None),
            ref_ids: RwLock::new(HashMap::new()),
            status_paths: RwLock::new(HashMap::new()),
            comparisons: Mutex::new(VecDeque::new()),
            cancellation: CancellationToken::new(),
            watcher: Mutex::new(None),
        }
    }
}

pub struct RepositoryRegistry {
    repositories: RwLock<HashMap<RepoId, Arc<RepositoryHandle>>>,
    git: Arc<GitRunner>,
    global_process_limit: Arc<Semaphore>,
    updates: broadcast::Sender<RepositoryUpdate>,
}

impl RepositoryRegistry {
    pub fn new(git: GitRunner, max_git_processes: usize) -> Arc<Self> {
        let (updates, _) = broadcast::channel(128);
        Arc::new(Self {
            repositories: RwLock::new(HashMap::new()),
            git: Arc::new(git),
            global_process_limit: Arc::new(Semaphore::new(max_git_processes.max(1))),
            updates,
        })
    }

    pub fn system() -> Arc<Self> {
        Self::new(GitRunner::system(), 4)
    }
    pub fn subscribe(&self) -> broadcast::Receiver<RepositoryUpdate> {
        self.updates.subscribe()
    }

    pub async fn capabilities(&self) -> Result<BackendCapabilities> {
        let installation = self.git.detect().await?;
        Ok(BackendCapabilities {
            api_version: 1,
            git_version: installation.version,
            supports_sha256: true,
            max_metadata_bytes: METADATA_LIMIT,
            max_file_bytes: FILE_LIMIT,
        })
    }

    pub async fn open_repository(
        self: &Arc<Self>,
        path: impl AsRef<Path>,
    ) -> Result<RepositorySnapshot> {
        let cancel = CancellationToken::new();
        let info = self.probe_with_limit(path.as_ref(), &cancel).await?;
        let id = info.id.clone();
        let handle = Arc::new(RepositoryHandle::new(info));
        let existing = {
            let mut repositories = self.repositories.write().await;
            if let Some(existing) = repositories
                .values()
                .find(|existing| existing.worktree_root == handle.worktree_root)
                .cloned()
            {
                Some(existing)
            } else {
                repositories.insert(id.clone(), handle.clone());
                None
            }
        };
        if let Some(existing) = existing {
            existing.open_count.fetch_add(1, Ordering::SeqCst);
            return match self.refresh_handle(&existing).await {
                Ok(snapshot) => Ok(snapshot),
                Err(error) => {
                    let _ = self.close_repository(&id).await;
                    Err(error)
                }
            };
        }
        match self.refresh_handle(&handle).await {
            Ok(snapshot) => {
                let watcher = self.make_watcher(&id, &handle).await.ok();
                *handle.watcher.lock().await = watcher;
                Ok(snapshot)
            }
            Err(error) => {
                self.repositories.write().await.remove(&id);
                Err(error)
            }
        }
    }

    async fn make_watcher(
        self: &Arc<Self>,
        id: &RepoId,
        handle: &Arc<RepositoryHandle>,
    ) -> Result<RepositoryWatcher> {
        let info = handle.info.read().await.clone();
        let weak_registry = Arc::downgrade(self);
        let weak_handle = Arc::downgrade(handle);
        let repo_id = id.clone();
        let callback = Arc::new(move || {
            let Some(registry) = weak_registry.upgrade() else {
                return;
            };
            let Some(handle) = weak_handle.upgrade() else {
                return;
            };
            let repo_id = repo_id.clone();
            tokio::spawn(async move {
                handle.generation.fetch_add(1, Ordering::SeqCst);
                if let Ok(snapshot) = registry.refresh_repository(&repo_id).await {
                    let _ = registry.updates.send(RepositoryUpdate {
                        repo_id,
                        generation: snapshot.generation,
                    });
                }
            });
        });
        RepositoryWatcher::start(&info, callback)
    }

    pub async fn close_repository(&self, repo_id: &RepoId) -> Result<()> {
        let handle = {
            let mut repositories = self.repositories.write().await;
            let handle = repositories
                .get(repo_id)
                .cloned()
                .ok_or(AppError::InvalidRepositoryId)?;
            if handle.open_count.fetch_sub(1, Ordering::SeqCst) > 1 {
                return Ok(());
            }
            repositories.remove(repo_id);
            handle
        };
        handle.cancellation.cancel();
        handle.comparisons.lock().await.clear();
        handle.ref_ids.write().await.clear();
        handle.status_paths.write().await.clear();
        handle.watcher.lock().await.take();
        Ok(())
    }

    pub async fn list_open_repositories(&self) -> Vec<RepositoryInfo> {
        let handles: Vec<_> = self.repositories.read().await.values().cloned().collect();
        let mut result = Vec::with_capacity(handles.len());
        for handle in handles {
            result.push(handle.info.read().await.clone());
        }
        result
    }

    pub async fn get_repository_snapshot(&self, repo_id: &RepoId) -> Result<RepositorySnapshot> {
        let handle = self.handle(repo_id).await?;
        let snapshot = handle
            .snapshot
            .read()
            .await
            .clone()
            .ok_or(AppError::RepositoryClosed)?;
        Ok((*snapshot).clone())
    }

    pub async fn refresh_repository(&self, repo_id: &RepoId) -> Result<RepositorySnapshot> {
        let handle = self.handle(repo_id).await?;
        self.refresh_handle(&handle).await
    }

    async fn refresh_handle(&self, handle: &Arc<RepositoryHandle>) -> Result<RepositorySnapshot> {
        let _refresh = handle.refresh_lock.lock().await;
        for attempt in 0..2 {
            if handle.cancellation.is_cancelled() {
                return Err(AppError::RepositoryClosed);
            }
            let start = handle.generation.load(Ordering::SeqCst);
            let current = handle.info.read().await.clone();
            let root = current.worktree_root.clone();
            let refs_args = vec![
                OsString::from("for-each-ref"),
                OsString::from(format!("--format={FOR_EACH_REF_FORMAT}")),
                OsString::from("refs/heads"),
                OsString::from("refs/remotes"),
            ];
            let status_args = [
                "status",
                "--porcelain=v2",
                "-z",
                "--branch",
                "--untracked-files=all",
                "--ignore-submodules=none",
                "--no-ahead-behind",
            ];
            let (refs_out, status_out, probed) = tokio::try_join!(
                self.run_git(Some(&root), refs_args, &handle.cancellation),
                self.run_git(Some(&root), status_args, &handle.cancellation),
                self.probe_with_limit(&root, &handle.cancellation),
            )?;
            let mut references = parse_for_each_ref(&refs_out.stdout)?;
            references.retain(|r| {
                !(r.kind == ReferenceKind::RemoteBranch && r.full_name.ends_with("/HEAD"))
            });
            qualify_colliding_display_names(&mut references);
            let parsed_status = parse_porcelain_v2_z(&status_out.stdout)?;
            let status = into_working_tree_status(parsed_status.clone(), start);
            let end = handle.generation.load(Ordering::SeqCst);
            if start != end && attempt == 0 {
                continue;
            }
            if start != end {
                return Err(AppError::StaleGeneration);
            }

            let ref_map = references
                .iter()
                .map(|r| (r.id.clone(), r.full_name.clone()))
                .collect();
            let status_paths = status
                .entries
                .iter()
                .zip(parsed_status.entries.iter())
                .map(|(dto, raw)| (dto.file_id.clone(), raw.path.clone()))
                .collect();
            let mut info = probed;
            info.id = current.id.clone();
            info.generation = start;
            let snapshot = RepositorySnapshot {
                repo_id: info.id.clone(),
                generation: start,
                info: info.clone(),
                head: info.head.clone(),
                references,
                status,
            };
            *handle.info.write().await = info;
            *handle.ref_ids.write().await = ref_map;
            *handle.status_paths.write().await = status_paths;
            *handle.snapshot.write().await = Some(Arc::new(snapshot.clone()));
            return Ok(snapshot);
        }
        Err(AppError::StaleGeneration)
    }

    pub async fn create_comparison(
        &self,
        repo_id: &RepoId,
        request: ComparisonRequest,
    ) -> Result<ComparisonResult> {
        let handle = self.handle(repo_id).await?;
        let generation = handle.generation.load(Ordering::SeqCst);
        let snapshot = handle
            .snapshot
            .read()
            .await
            .clone()
            .ok_or(AppError::RepositoryClosed)?;
        if snapshot.generation != generation {
            return Err(AppError::StaleGeneration);
        }
        let (mode, left, right, left_summary, right_summary) = match request {
            ComparisonRequest::Direct { left, right } => {
                let l = self.resolve_ref(&handle, &left).await?;
                let r = self.resolve_ref(&handle, &right).await?;
                (
                    ComparisonMode::Direct,
                    Some(l.commit_oid.clone()),
                    Some(r.commit_oid.clone()),
                    Some(summary(l)),
                    Some(summary(r)),
                )
            }
            ComparisonRequest::SinceMergeBase { left, right } => {
                let l = self.resolve_ref(&handle, &left).await?;
                let r = self.resolve_ref(&handle, &right).await?;
                (
                    ComparisonMode::SinceMergeBase,
                    Some(l.commit_oid.clone()),
                    Some(r.commit_oid.clone()),
                    Some(summary(l)),
                    Some(summary(r)),
                )
            }
            ComparisonRequest::Unstaged => (ComparisonMode::Unstaged, None, None, None, None),
            ComparisonRequest::Staged => (
                ComparisonMode::Staged,
                head_oid(&snapshot.head),
                None,
                None,
                None,
            ),
            ComparisonRequest::AllUncommitted => (
                ComparisonMode::AllUncommitted,
                head_oid(&snapshot.head),
                None,
                None,
                None,
            ),
        };

        let content_left = if mode == ComparisonMode::SinceMergeBase {
            Some(
                self.merge_base(&handle, left.as_deref().unwrap(), right.as_deref().unwrap())
                    .await?,
            )
        } else {
            left.clone()
        };

        let status_paths = handle.status_paths.read().await.clone();
        let mut entries = if left.is_none() && matches!(mode, ComparisonMode::AllUncommitted) {
            status_as_name_entries(&snapshot.status, &status_paths)
        } else {
            let plan = comparison_plan(mode, left.as_deref(), right.as_deref())?;
            let out = self
                .run_git(
                    Some(&snapshot.info.worktree_root),
                    plan.args.iter().map(OsString::from),
                    &handle.cancellation,
                )
                .await?;
            parse_name_status_z(&out.stdout)?
        };
        if mode == ComparisonMode::AllUncommitted && left.is_some() {
            append_untracked(&mut entries, &snapshot.status, &status_paths);
        }
        if handle.generation.load(Ordering::SeqCst) != generation {
            return Err(AppError::StaleGeneration);
        }

        let endpoints = comparison_endpoints(mode, content_left.as_deref(), right.as_deref());
        let mut gitlink_paths = self
            .endpoint_gitlinks(
                &handle,
                &snapshot.info.worktree_root,
                &endpoints.0,
                &entries,
                true,
            )
            .await?;
        gitlink_paths.extend(
            self.endpoint_gitlinks(
                &handle,
                &snapshot.info.worktree_root,
                &endpoints.1,
                &entries,
                false,
            )
            .await?,
        );
        let comparison_id = ComparisonId::new();
        let mut descriptors = HashMap::new();
        let mut files = Vec::with_capacity(entries.len());
        for entry in entries {
            let mut descriptor = descriptor_for(
                &entry,
                &endpoints.0,
                &endpoints.1,
                &snapshot.info.worktree_root,
            );
            let file_id = descriptor.file_id.clone();
            let status_entry = snapshot
                .status
                .entries
                .iter()
                .find(|s| s.display_path == display_path(&entry.path));
            if let Some(status) = status_entry.filter(|status| status.submodule) {
                if matches!(descriptor.left, ContentSource::Worktree { .. }) {
                    descriptor.left = ContentSource::Submodule {
                        commit_oid: status.index_oid.clone().or_else(|| status.head_oid.clone()),
                    };
                }
                if matches!(descriptor.right, ContentSource::Worktree { .. }) {
                    descriptor.right = ContentSource::Submodule {
                        commit_oid: status.index_oid.clone(),
                    };
                }
            }
            files.push(ChangedFile {
                file_id: file_id.clone(),
                display_path: display_path(&entry.path),
                old_display_path: entry.old_path.as_ref().map(|p| display_path(p)),
                status: entry.kind,
                staged: status_entry.is_some_and(|s| s.staged),
                unstaged: status_entry.is_some_and(|s| s.unstaged),
                conflicted: entry.kind == ChangeKind::Unmerged,
                submodule: status_entry.is_some_and(|s| s.submodule)
                    || gitlink_paths.contains(&repo_path_from_bytes(&entry.path)),
                similarity: entry.similarity,
            });
            descriptors.insert(file_id, descriptor);
        }
        let totals = totals(&files);
        let result = ComparisonResult {
            comparison_id: comparison_id.clone(),
            repo_id: repo_id.clone(),
            generation,
            mode,
            resolved_left: left_summary,
            resolved_right: right_summary,
            files,
            totals,
        };
        let mut cache = handle.comparisons.lock().await;
        cache.push_back(CachedComparison {
            id: comparison_id,
            generation,
            descriptors,
        });
        while cache.len() > MAX_COMPARISONS {
            cache.pop_front();
        }
        Ok(result)
    }

    pub async fn get_file_comparison(
        &self,
        repo_id: &RepoId,
        comparison_id: &ComparisonId,
        file_id: &FileId,
    ) -> Result<FileComparison> {
        let handle = self.handle(repo_id).await?;
        let generation = handle.generation.load(Ordering::SeqCst);
        let descriptor = {
            let cache = handle.comparisons.lock().await;
            let comparison = cache
                .iter()
                .find(|c| &c.id == comparison_id)
                .ok_or(AppError::InvalidComparisonId)?;
            if comparison.generation != generation {
                return Err(AppError::StaleGeneration);
            }
            comparison
                .descriptors
                .get(file_id)
                .cloned()
                .ok_or(AppError::InvalidFileId)?
        };
        let root = handle.info.read().await.worktree_root.clone();
        let (left, right) = tokio::try_join!(
            self.load_side(&handle, &root, "Left", descriptor.left),
            self.load_side(&handle, &root, "Right", descriptor.right),
        )?;
        if handle.generation.load(Ordering::SeqCst) != generation {
            return Err(AppError::StaleGeneration);
        }
        Ok(FileComparison {
            repo_id: repo_id.clone(),
            comparison_id: comparison_id.clone(),
            file_id: file_id.clone(),
            generation,
            left,
            right,
        })
    }

    async fn load_side(
        &self,
        handle: &Arc<RepositoryHandle>,
        root: &Path,
        label: &str,
        source: ContentSource,
    ) -> Result<FileSide> {
        let (summary, content) = match source {
            ContentSource::Empty => (FileSourceSummary::Empty, FileContent::Missing),
            ContentSource::Submodule { commit_oid } => (
                FileSourceSummary::Submodule,
                FileContent::Submodule { commit_oid },
            ),
            ContentSource::Worktree { repo_path } => {
                let path = if repo_path.is_absolute() {
                    repo_path
                } else {
                    root.join(&repo_path)
                };
                ensure_inside(root, &path)?;
                let metadata = match std::fs::symlink_metadata(&path) {
                    Ok(v) => v,
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                        return Ok(FileSide {
                            label: label.into(),
                            source: FileSourceSummary::Worktree,
                            content: FileContent::Missing,
                        });
                    }
                    Err(e) => return Err(e.into()),
                };
                let content = if metadata.file_type().is_symlink() {
                    FileContent::Symlink {
                        target: std::fs::read_link(&path)?.to_string_lossy().into_owned(),
                    }
                } else {
                    match read_worktree_file(&path, FILE_LIMIT) {
                        Ok(bytes) => classify_content(bytes, FILE_LIMIT),
                        Err(AppError::ContentTooLarge { size, limit }) => {
                            FileContent::TooLarge { size, limit }
                        }
                        Err(AppError::ContentMissing) => FileContent::Missing,
                        Err(error) => return Err(error),
                    }
                };
                (FileSourceSummary::Worktree, content)
            }
            ContentSource::Commit {
                commit_oid,
                repo_path,
            } => {
                let metadata = self
                    .git_entry_metadata(handle, root, Some(&commit_oid), &repo_path)
                    .await?;
                let content = if metadata.as_ref().is_some_and(|(mode, _)| mode == "160000") {
                    FileContent::Submodule {
                        commit_oid: metadata.and_then(|(_, oid)| oid),
                    }
                } else {
                    let command = commit_blob_command(&commit_oid, &repo_path)?;
                    mark_symlink(
                        self.load_git_object(handle, root, command).await?,
                        metadata.as_ref().map(|(mode, _)| mode.as_str()),
                    )
                };
                (FileSourceSummary::Commit { commit_oid }, content)
            }
            ContentSource::Index { repo_path } => {
                let metadata = self
                    .git_entry_metadata(handle, root, None, &repo_path)
                    .await?;
                let content = if metadata.as_ref().is_some_and(|(mode, _)| mode == "160000") {
                    FileContent::Submodule {
                        commit_oid: metadata.and_then(|(_, oid)| oid),
                    }
                } else {
                    let command = index_blob_command(&repo_path)?;
                    mark_symlink(
                        self.load_git_object(handle, root, command).await?,
                        metadata.as_ref().map(|(mode, _)| mode.as_str()),
                    )
                };
                (FileSourceSummary::Index, content)
            }
            ContentSource::ConflictStage { stage, repo_path } => {
                let mut spec = OsString::from(format!(":{stage}:"));
                spec.push(repo_path.as_os_str());
                let command = BlobCommand {
                    args: vec![OsString::from("cat-file"), OsString::from("blob"), spec],
                };
                let content = self.load_git_object(handle, root, command).await?;
                (FileSourceSummary::ConflictStage { stage }, content)
            }
        };
        Ok(FileSide {
            label: label.into(),
            source: summary,
            content,
        })
    }

    async fn endpoint_gitlinks(
        &self,
        handle: &Arc<RepositoryHandle>,
        root: &Path,
        endpoint: &DiffEndpoint,
        entries: &[NameStatusEntry],
        left_side: bool,
    ) -> Result<HashSet<PathBuf>> {
        let mut found = HashSet::new();
        let prefix: Vec<OsString> = match endpoint {
            DiffEndpoint::Commit(oid) => vec![
                OsString::from("ls-tree"),
                OsString::from("-z"),
                OsString::from(oid),
                OsString::from("--"),
            ],
            DiffEndpoint::Index => vec![
                OsString::from("ls-files"),
                OsString::from("-s"),
                OsString::from("-z"),
                OsString::from("--"),
            ],
            DiffEndpoint::Worktree | DiffEndpoint::Empty => return Ok(found),
        };
        for chunk in entries.chunks(128) {
            let mut args = prefix.clone();
            for entry in chunk {
                let bytes = if left_side {
                    entry.old_path.as_deref().unwrap_or(&entry.path)
                } else {
                    &entry.path
                };
                args.push(repo_path_from_bytes(bytes).into_os_string());
            }
            let output = self.run_git(Some(root), args, &handle.cancellation).await?;
            for record in output
                .stdout
                .split(|byte| *byte == 0)
                .filter(|record| !record.is_empty())
            {
                let Some(tab) = record.iter().position(|byte| *byte == b'\t') else {
                    return Err(AppError::MalformedGitOutput(
                        "invalid tree/index record".into(),
                    ));
                };
                if record[..tab].starts_with(b"160000 ") {
                    found.insert(repo_path_from_bytes(&record[tab + 1..]));
                }
            }
        }
        Ok(found)
    }
    async fn git_entry_metadata(
        &self,
        handle: &Arc<RepositoryHandle>,
        root: &Path,
        commit: Option<&str>,
        path: &Path,
    ) -> Result<Option<(String, Option<String>)>> {
        let mut args = if let Some(commit) = commit {
            vec![
                OsString::from("ls-tree"),
                OsString::from("-z"),
                OsString::from(commit),
                OsString::from("--"),
            ]
        } else {
            vec![
                OsString::from("ls-files"),
                OsString::from("-s"),
                OsString::from("-z"),
                OsString::from("--"),
            ]
        };
        args.push(path.as_os_str().to_owned());
        let output = self.run_git(Some(root), args, &handle.cancellation).await?;
        if output.stdout.is_empty() {
            return Ok(None);
        }
        let mode = output
            .stdout
            .split(|byte| *byte == b' ')
            .next()
            .unwrap_or_default();
        let mode = std::str::from_utf8(mode)
            .map_err(|_| AppError::MalformedGitOutput("invalid file mode".into()))?;
        if mode.len() != 6 || !mode.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(AppError::MalformedGitOutput("invalid file mode".into()));
        }
        let header = output
            .stdout
            .split(|byte| *byte == b'\t')
            .next()
            .unwrap_or_default();
        let oid = header
            .split(|byte| byte.is_ascii_whitespace())
            .find_map(|field| {
                let text = std::str::from_utf8(field).ok()?;
                ((4..=128).contains(&text.len())
                    && text.bytes().all(|byte| byte.is_ascii_hexdigit()))
                .then(|| text.to_owned())
            });
        Ok(Some((mode.to_owned(), oid)))
    }
    async fn load_git_object(
        &self,
        handle: &Arc<RepositoryHandle>,
        root: &Path,
        command: BlobCommand,
    ) -> Result<FileContent> {
        let spec = command
            .args
            .last()
            .cloned()
            .ok_or_else(|| AppError::MalformedGitOutput("missing object expression".into()))?;
        let object_type = self
            .run_git_text(
                Some(root),
                [
                    OsString::from("cat-file"),
                    OsString::from("-t"),
                    spec.clone(),
                ],
                &handle.cancellation,
            )
            .await?;
        match object_type.trim() {
            "commit" => {
                let oid = self
                    .run_git_text(
                        Some(root),
                        [
                            OsString::from("rev-parse"),
                            OsString::from("--verify"),
                            spec,
                        ],
                        &handle.cancellation,
                    )
                    .await?;
                Ok(FileContent::Submodule {
                    commit_oid: Some(oid.trim().to_owned()),
                })
            }
            "blob" => {
                let size_text = self
                    .run_git_text(
                        Some(root),
                        [OsString::from("cat-file"), OsString::from("-s"), spec],
                        &handle.cancellation,
                    )
                    .await?;
                let size = size_text
                    .trim()
                    .parse::<u64>()
                    .map_err(|_| AppError::MalformedGitOutput("invalid blob size".into()))?;
                if size > FILE_LIMIT {
                    return Ok(FileContent::TooLarge {
                        size,
                        limit: FILE_LIMIT,
                    });
                }
                let output = self
                    .run_git(Some(root), command.args, &handle.cancellation)
                    .await?;
                Ok(classify_content(output.stdout, FILE_LIMIT))
            }
            _ => Ok(FileContent::Missing),
        }
    }
    async fn merge_base(
        &self,
        handle: &Arc<RepositoryHandle>,
        left: &str,
        right: &str,
    ) -> Result<String> {
        let root = handle.info.read().await.worktree_root.clone();
        let output = self
            .run_git_text(
                Some(&root),
                ["merge-base", left, right],
                &handle.cancellation,
            )
            .await
            .map_err(|error| {
                if matches!(error, AppError::GitCommandFailed { exit_code: 1, .. }) {
                    AppError::NoMergeBase
                } else {
                    error
                }
            })?;
        let oid = output.trim().to_owned();
        if !(4..=128).contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(AppError::MalformedGitOutput(
                "invalid merge-base object id".into(),
            ));
        }
        Ok(oid)
    }
    async fn resolve_ref(
        &self,
        handle: &Arc<RepositoryHandle>,
        id: &RefId,
    ) -> Result<ResolvedRevision> {
        let full_ref = handle
            .ref_ids
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or(AppError::InvalidReferenceId)?;
        let expression = format!("{full_ref}^{{commit}}");
        let root = handle.info.read().await.worktree_root.clone();
        let output = self
            .run_git_text(
                Some(&root),
                ["rev-parse", "--verify", "--end-of-options", &expression],
                &handle.cancellation,
            )
            .await
            .map_err(|e| {
                if matches!(e, AppError::GitCommandFailed { .. }) {
                    AppError::ReferenceMovedOrDeleted
                } else {
                    e
                }
            })?;
        let oid = output.trim().to_owned();
        if !(4..=128).contains(&oid.len()) || !oid.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(AppError::MalformedGitOutput("invalid object id".into()));
        }
        Ok(ResolvedRevision {
            full_ref,
            commit_oid: oid,
        })
    }

    async fn probe_with_limit(
        &self,
        path: &Path,
        cancel: &CancellationToken,
    ) -> Result<RepositoryInfo> {
        let _permit = self
            .global_process_limit
            .acquire()
            .await
            .map_err(|_| AppError::RepositoryClosed)?;
        probe_repository(&self.git, path, cancel).await
    }
    async fn run_git<I, S>(
        &self,
        root: Option<&Path>,
        args: I,
        cancel: &CancellationToken,
    ) -> Result<GitOutput>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let _permit = self
            .global_process_limit
            .acquire()
            .await
            .map_err(|_| AppError::RepositoryClosed)?;
        GitRunner::run(&self.git, root, args, cancel).await
    }

    async fn run_git_text<I, S>(
        &self,
        root: Option<&Path>,
        args: I,
        cancel: &CancellationToken,
    ) -> Result<String>
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        let output = self.run_git(root, args, cancel).await?;
        String::from_utf8(output.stdout)
            .map_err(|_| AppError::MalformedGitOutput("stdout is not UTF-8".into()))
    }
    async fn handle(&self, id: &RepoId) -> Result<Arc<RepositoryHandle>> {
        self.repositories
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or(AppError::InvalidRepositoryId)
    }
}

#[cfg(unix)]
fn repo_path_from_bytes(bytes: &[u8]) -> PathBuf {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    PathBuf::from(OsString::from_vec(bytes.to_vec()))
}
#[cfg(not(unix))]
fn repo_path_from_bytes(bytes: &[u8]) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(bytes).into_owned())
}
fn mark_symlink(content: FileContent, mode: Option<&str>) -> FileContent {
    if mode == Some("120000") {
        match content {
            FileContent::Text { text, .. } => FileContent::Symlink { target: text },
            other => other,
        }
    } else {
        content
    }
}
fn qualify_colliding_display_names(references: &mut [GitReference]) {
    let mut counts = HashMap::new();
    for reference in references.iter() {
        *counts
            .entry(reference.display_name.clone())
            .or_insert(0usize) += 1;
    }
    for reference in references.iter_mut() {
        if counts
            .get(&reference.display_name)
            .copied()
            .unwrap_or_default()
            > 1
        {
            reference.display_name = reference.full_name.clone();
        }
    }
}
fn summary(value: ResolvedRevision) -> ResolvedRevisionSummary {
    ResolvedRevisionSummary {
        display_name: value.full_ref,
        commit_oid: value.commit_oid,
    }
}
fn head_oid(head: &HeadState) -> Option<String> {
    match head {
        HeadState::Branch { commit_oid, .. } | HeadState::Detached { commit_oid } => {
            Some(commit_oid.clone())
        }
        HeadState::Unborn { .. } => None,
    }
}
fn display_path(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}
fn comparison_endpoints(
    mode: ComparisonMode,
    left: Option<&str>,
    right: Option<&str>,
) -> (DiffEndpoint, DiffEndpoint) {
    match mode {
        ComparisonMode::Direct | ComparisonMode::SinceMergeBase => (
            DiffEndpoint::Commit(left.unwrap_or_default().into()),
            DiffEndpoint::Commit(right.unwrap_or_default().into()),
        ),
        ComparisonMode::Unstaged => (DiffEndpoint::Index, DiffEndpoint::Worktree),
        ComparisonMode::Staged => (
            left.map_or(DiffEndpoint::Empty, |x| DiffEndpoint::Commit(x.into())),
            DiffEndpoint::Index,
        ),
        ComparisonMode::AllUncommitted => (
            left.map_or(DiffEndpoint::Empty, |x| DiffEndpoint::Commit(x.into())),
            DiffEndpoint::Worktree,
        ),
    }
}
fn status_as_name_entries(
    status: &WorkingTreeStatus,
    paths: &HashMap<FileId, PathBuf>,
) -> Vec<NameStatusEntry> {
    status
        .entries
        .iter()
        .map(|entry| {
            let path = paths.get(&entry.file_id).map_or_else(
                || entry.display_path.as_bytes().to_vec(),
                |path| path_bytes(path),
            );
            NameStatusEntry {
                kind: entry.status,
                old_path: entry
                    .old_display_path
                    .as_ref()
                    .map(|p| p.as_bytes().to_vec()),
                path,
                similarity: entry.similarity,
            }
        })
        .collect()
}
fn append_untracked(
    entries: &mut Vec<NameStatusEntry>,
    status: &WorkingTreeStatus,
    paths: &HashMap<FileId, PathBuf>,
) {
    for item in status
        .entries
        .iter()
        .filter(|s| s.status == ChangeKind::Untracked)
    {
        if !entries
            .iter()
            .any(|e| display_path(&e.path) == item.display_path)
        {
            let path = paths.get(&item.file_id).map_or_else(
                || item.display_path.as_bytes().to_vec(),
                |path| path_bytes(path),
            );
            entries.push(NameStatusEntry {
                kind: ChangeKind::Untracked,
                old_path: None,
                path,
                similarity: None,
            });
        }
    }
}
#[cfg(unix)]
fn path_bytes(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}
#[cfg(not(unix))]
fn path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().as_bytes().to_vec()
}
fn totals(files: &[ChangedFile]) -> ChangeTotals {
    let mut t = ChangeTotals {
        files: files.len(),
        ..Default::default()
    };
    for f in files {
        match f.status {
            ChangeKind::Added | ChangeKind::Untracked => t.added += 1,
            ChangeKind::Deleted => t.deleted += 1,
            ChangeKind::Renamed | ChangeKind::Copied => t.renamed += 1,
            ChangeKind::Unmerged => t.conflicted += 1,
            _ => t.modified += 1,
        }
    }
    t
}
fn ensure_inside(root: &Path, path: &Path) -> Result<()> {
    if !path.starts_with(root)
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        Err(AppError::FileOutsideRepository)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn totals_are_stable() {
        let file = |status| ChangedFile {
            file_id: FileId::new(),
            display_path: "x".into(),
            old_display_path: None,
            status,
            staged: false,
            unstaged: false,
            conflicted: false,
            submodule: false,
            similarity: None,
        };
        let t = totals(&[
            file(ChangeKind::Added),
            file(ChangeKind::Deleted),
            file(ChangeKind::Modified),
        ]);
        assert_eq!((t.files, t.added, t.deleted, t.modified), (3, 1, 1, 1));
    }
}
