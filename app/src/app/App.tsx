import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { AlertTriangle, Braces, Command, FolderGit2, FolderPlus, HelpCircle, LoaderCircle, PanelLeft, Plus, Settings2, ShieldCheck } from "lucide-react";
import { backend, normalizeError } from "../api/backend";
import { listenForRepositoryUpdates } from "../api/events";
import { generations } from "../api/generations";
import { loadFileWithComparisonRecovery } from "../api/comparison-lifecycle";
import type { BackendCapabilities, ComparisonMode, FrontendError, ProjectDefinition, ProjectRepositoryDefinition, RepoId, RepositorySnapshot, RuntimeRepository } from "../api/types";
import { queryClient, queryKeys, removeRepositoryQueries } from "./query-client";
import { useUi } from "../state/ui-state";
import { IconButton } from "../components/IconButton";
import { Dialog } from "../components/Dialog";
import { EmptyState } from "../components/EmptyState";
import { ConfirmDialog, NameDialog } from "../components/ModalForms";
import { InlineError } from "../components/InlineError";
import { ComparisonToolbar } from "../features/ComparisonToolbar";
import { FileNavigator } from "../features/FileNavigator";
import { DiffViewer } from "../features/DiffViewer";
import { RepositorySidebar, type RepositoryView } from "../features/RepositorySidebar";
import { StatusBar } from "../features/StatusBar";
import { UpdateDialog } from "../features/UpdateDialog";
import { CommandPalette, ShortcutHelp, commandIcons, type CommandAction } from "../features/CommandPalette";
import { createComparisonRequest, filterFiles, findUpstreamComparison } from "../features/comparison-utils";
import { useUpdater } from "./use-updater";

const runtimeKey = (projectId: string, projectRepoId: string) => `${projectId}:${projectRepoId}`;
const newProject = (name: string): ProjectDefinition => ({ schema_version: 1, project_id: crypto.randomUUID(), name, repositories: [], layout: "tabs" });
const savedPaneSize = (key: string, fallback: number) => Number(localStorage.getItem(key)) || fallback;

export default function App() {
  const { state: ui, dispatch } = useUi();
  const [runtimeRepositories, setRuntimeRepositories] = useState<Record<string, RuntimeRepository>>({});
  const runtimeRef = useRef(runtimeRepositories);
  const activeProjectIdRef = useRef(ui.activeProjectId);
  const [refreshingRepoIds, setRefreshingRepoIds] = useState<Set<RepoId>>(new Set());
  const [watcherWarning, setWatcherWarning] = useState<string | null>(null);
  const [projectDialog, setProjectDialog] = useState<"create" | "rename" | null>(null);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);
  const [removeRepositoryId, setRemoveRepositoryId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const updater = useUpdater();
  const [operationError, setOperationError] = useState<FrontendError | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const appliedPreferenceRef = useRef<string | null>(null);
  const refreshTimers = useRef(new Map<RepoId, ReturnType<typeof setTimeout>>());
  const refreshCounts = useRef(new Map<RepoId, number>());
  runtimeRef.current = runtimeRepositories;
  activeProjectIdRef.current = ui.activeProjectId;

  useEffect(() => {
    if (updater.state.status === "available") setUpdateOpen(true);
  }, [updater.state.status]);

  const capabilitiesQuery = useQuery({ queryKey: queryKeys.capabilities, queryFn: backend.getCapabilities });
  const projectsQuery = useQuery({ queryKey: queryKeys.projects, queryFn: backend.loadProjects });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const activeProject = projects.find((project) => project.project_id === ui.activeProjectId) ?? null;

  useEffect(() => {
    if (!ui.activeProjectId && projects[0]) dispatch({ type: "selectProject", projectId: projects[0].project_id });
    if (ui.activeProjectId && projects.length > 0 && !projects.some((project) => project.project_id === ui.activeProjectId)) dispatch({ type: "selectProject", projectId: projects[0].project_id });
  }, [dispatch, projects, ui.activeProjectId]);

  const cacheSnapshot = useCallback((snapshot: RepositorySnapshot) => {
    generations.accept(snapshot);
    queryClient.setQueryData(queryKeys.repository(snapshot.repo_id, snapshot.generation), snapshot);
  }, []);

  const setRepositorySnapshot = useCallback((snapshot: RepositorySnapshot) => {
    cacheSnapshot(snapshot);
    setRuntimeRepositories((items) => {
      const next = { ...items };
      for (const [key, runtime] of Object.entries(next)) {
        if (runtime.repoId === snapshot.repo_id) next[key] = { ...runtime, generation: snapshot.generation, error: null };
      }
      return next;
    });
  }, [cacheSnapshot]);

  const beginRefresh = useCallback((repoId: RepoId) => {
    refreshCounts.current.set(repoId, (refreshCounts.current.get(repoId) ?? 0) + 1);
    setRefreshingRepoIds((items) => new Set(items).add(repoId));
  }, []);

  const endRefresh = useCallback((repoId: RepoId) => {
    const remaining = Math.max(0, (refreshCounts.current.get(repoId) ?? 1) - 1);
    if (remaining) {
      refreshCounts.current.set(repoId, remaining);
      return;
    }
    refreshCounts.current.delete(repoId);
    setRefreshingRepoIds((items) => { const next = new Set(items); next.delete(repoId); return next; });
  }, []);

  const openDefinition = useCallback(async (project: ProjectDefinition, definition: ProjectRepositoryDefinition, force = false) => {
    const key = runtimeKey(project.project_id, definition.project_repo_id);
    const current = runtimeRef.current[key];
    if (!force && (current?.repoId || current?.opening)) return;
    setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId: definition.project_repo_id, repoId: null, generation: 0, opening: true, error: null } }));
    try {
      const snapshot = await backend.openRepository(definition.path);
      if (activeProjectIdRef.current !== project.project_id) {
        try { await backend.closeRepository(snapshot.repo_id); } catch { /* The project changed while opening. */ }
        setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId: definition.project_repo_id, repoId: null, generation: 0, opening: false, error: null } }));
        return;
      }
      cacheSnapshot(snapshot);
      setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId: definition.project_repo_id, repoId: snapshot.repo_id, generation: snapshot.generation, opening: false, error: null } }));
    } catch (error) {
      setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId: definition.project_repo_id, repoId: null, generation: 0, opening: false, error: normalizeError(error) } }));
    }
  }, [cacheSnapshot]);

  useEffect(() => {
    if (!activeProject) return;
    for (const definition of activeProject.repositories) void openDefinition(activeProject, definition);
  }, [activeProject, openDefinition]);

  const saveProject = useCallback(async (project: ProjectDefinition) => {
    await backend.saveProject(project);
    queryClient.setQueryData<ProjectDefinition[]>(queryKeys.projects, (current = []) => {
      const exists = current.some((item) => item.project_id === project.project_id);
      return (exists ? current.map((item) => item.project_id === project.project_id ? project : item) : [...current, project]).sort((a, b) => a.name.localeCompare(b.name));
    });
  }, []);

  const refreshRepository = useCallback(async (repoId: RepoId) => {
    beginRefresh(repoId);
    try {
      const snapshot = await backend.refreshRepository(repoId);
      setRepositorySnapshot(snapshot);
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === "WATCHER_UNAVAILABLE") setWatcherWarning(normalized.message);
      if (normalized.code === "REPOSITORY_CLOSED") {
        setRuntimeRepositories((items) => {
          const next = { ...items };
          for (const [key, runtime] of Object.entries(next)) if (runtime.repoId === repoId) next[key] = { ...runtime, repoId: null, error: normalized };
          return next;
        });
      }
    } finally {
      endRefresh(repoId);
    }
  }, [beginRefresh, endRefresh, setRepositorySnapshot]);

  const synchronizeRepository = useCallback(async (repoId: RepoId) => {
    beginRefresh(repoId);
    try {
      setRepositorySnapshot(await backend.getRepositorySnapshot(repoId));
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === "REPOSITORY_CLOSED") {
        setRuntimeRepositories((items) => {
          const next = { ...items };
          for (const [key, runtime] of Object.entries(next)) if (runtime.repoId === repoId) next[key] = { ...runtime, repoId: null, error: normalized };
          return next;
        });
      } else {
        setWatcherWarning(normalized.message);
      }
    } finally {
      endRefresh(repoId);
    }
  }, [beginRefresh, endRefresh, setRepositorySnapshot]);

  useEffect(() => {
    const timers = refreshTimers.current;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenForRepositoryUpdates((payload) => {
      if (!generations.noteUpdate(payload.repo_id, payload.generation)) return;
      const prior = refreshTimers.current.get(payload.repo_id);
      if (prior) clearTimeout(prior);
      const timer = setTimeout(() => { refreshTimers.current.delete(payload.repo_id); void synchronizeRepository(payload.repo_id); }, 120);
      refreshTimers.current.set(payload.repo_id, timer);
    }).then((cleanup) => { if (disposed) cleanup(); else unlisten = cleanup; }).catch((error) => setWatcherWarning(normalizeError(error).message));
    return () => {
      disposed = true;
      unlisten?.();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [synchronizeRepository]);

  const activeRuntimeKey = activeProject && ui.activeProjectRepoId ? runtimeKey(activeProject.project_id, ui.activeProjectRepoId) : null;
  const activeRuntime = activeRuntimeKey ? runtimeRepositories[activeRuntimeKey] : undefined;
  const snapshotQuery = useQuery({
    queryKey: activeRuntime?.repoId ? queryKeys.repository(activeRuntime.repoId, activeRuntime.generation) : ["repository", "none"],
    queryFn: () => backend.getRepositorySnapshot(activeRuntime!.repoId!).then((snapshot) => { cacheSnapshot(snapshot); return snapshot; }),
    enabled: Boolean(activeRuntime?.repoId),
    placeholderData: (previous) => previous?.repo_id === activeRuntime?.repoId ? previous : undefined,
  });
  const snapshot = snapshotQuery.data ?? null;

  const repositoryViews: RepositoryView[] = useMemo(() => {
    if (!activeProject) return [];
    return [...activeProject.repositories].sort((a, b) => a.display_order - b.display_order).map((definition) => {
      const runtime = runtimeRepositories[runtimeKey(activeProject.project_id, definition.project_repo_id)];
      const cached = runtime?.repoId ? queryClient.getQueryData<RepositorySnapshot>(queryKeys.repository(runtime.repoId, runtime.generation)) ?? null : null;
      return { definition, runtime, snapshot: cached };
    });
  }, [activeProject, runtimeRepositories]);

  useEffect(() => {
    if (!activeProject || ui.activeProjectRepoId) return;
    if (activeProject.repositories[0]) dispatch({ type: "selectRepository", projectRepoId: activeProject.repositories[0].project_repo_id });
  }, [activeProject, dispatch, ui.activeProjectRepoId]);

  useEffect(() => {
    if (!activeProject || !ui.activeProjectRepoId) return;
    const preferenceKey = `${activeProject.project_id}:${ui.activeProjectRepoId}`;
    if (appliedPreferenceRef.current === preferenceKey) return;
    appliedPreferenceRef.current = preferenceKey;
    const definition = activeProject.repositories.find((item) => item.project_repo_id === ui.activeProjectRepoId);
    if (!definition) return;
    const saved = definition.default_comparison;
    dispatch({ type: "setComparison", mode: saved?.mode ?? "all_uncommitted", leftFullRef: saved?.left_full_ref ?? null, rightFullRef: saved?.right_full_ref ?? null });
  }, [activeProject, dispatch, ui.activeProjectRepoId]);

  const effectiveLeft = ui.leftFullRef ?? snapshot?.references.find((reference) => reference.is_head)?.full_name ?? snapshot?.references[0]?.full_name ?? null;
  const effectiveRight = ui.rightFullRef ?? snapshot?.references.find((reference) => !reference.is_head)?.full_name ?? snapshot?.references[1]?.full_name ?? effectiveLeft;
  const comparisonRequest = snapshot ? createComparisonRequest(ui.mode, snapshot.references, effectiveLeft, effectiveRight) : null;
  const comparisonDescriptor = JSON.stringify({ mode: ui.mode, left: effectiveLeft, right: effectiveRight });
  const comparisonQuery = useQuery({
    queryKey: snapshot && comparisonRequest ? queryKeys.comparison(snapshot.repo_id, snapshot.generation, comparisonDescriptor) : ["comparison", "none"],
    queryFn: () => backend.createComparison(snapshot!.repo_id, comparisonRequest!).then((result) => generations.accept(result)),
    enabled: Boolean(snapshot && comparisonRequest),
    placeholderData: (previous) => previous?.repo_id === snapshot?.repo_id && previous?.generation === snapshot?.generation ? previous : undefined,
  });
  const comparison = comparisonQuery.data ?? null;

  useEffect(() => {
    if (!comparison) return;
    const selected = comparison.files.find((file) => file.file_id === ui.activeFileId) ?? comparison.files.find((file) => file.display_path === selectedPathRef.current) ?? comparison.files[0];
    if ((selected?.file_id ?? null) !== ui.activeFileId) dispatch({ type: "selectFile", fileId: selected?.file_id ?? null });
  }, [comparison, dispatch, ui.activeFileId]);

  const selectedFile = comparison?.files.find((file) => file.file_id === ui.activeFileId) ?? null;
  const fileQuery = useQuery({
    queryKey: snapshot && comparison && selectedFile ? queryKeys.file(snapshot.repo_id, snapshot.generation, comparison.comparison_id, selectedFile.file_id) : ["file", "none"],
    queryFn: () => loadFileWithComparisonRecovery({
      client: backend,
      repoId: snapshot!.repo_id,
      request: comparisonRequest!,
      comparison: comparison!,
      file: selectedFile!,
      accept: (value) => generations.accept(value),
      onRenewed: (renewed) => queryClient.setQueryData(queryKeys.comparison(snapshot!.repo_id, snapshot!.generation, comparisonDescriptor), renewed),
    }),
    enabled: Boolean(snapshot && comparison && selectedFile),
    placeholderData: (previous) => previous?.repo_id === snapshot?.repo_id && previous?.generation === snapshot?.generation && previous?.comparison_id === comparison?.comparison_id && previous?.file_id === selectedFile?.file_id ? previous : undefined,
  });

  const updateComparison = useCallback(async (mode: ComparisonMode, left: string | null, right: string | null) => {
    dispatch({ type: "setComparison", mode, leftFullRef: left, rightFullRef: right });
    if (!activeProject || !ui.activeProjectRepoId) return;
    const updated: ProjectDefinition = { ...activeProject, repositories: activeProject.repositories.map((definition) => definition.project_repo_id === ui.activeProjectRepoId ? { ...definition, default_comparison: { mode, left_full_ref: left, right_full_ref: right } } : definition) };
    try { await saveProject(updated); } catch { /* Preference persistence never blocks comparison. */ }
  }, [activeProject, dispatch, saveProject, ui.activeProjectRepoId]);

  const addRepository = useCallback(async () => {
    if (!activeProject) { setProjectDialog("create"); return; }
    try {
      setOperationError(null);
      const path = await backend.pickRepositoryDirectory();
      if (!path) return;
      const duplicate = activeProject.repositories.find((repository) => repository.path.toLocaleLowerCase() === path.toLocaleLowerCase());
      if (duplicate) { dispatch({ type: "selectRepository", projectRepoId: duplicate.project_repo_id }); return; }
      const opened = await backend.openRepository(path);
      cacheSnapshot(opened);
      const definition: ProjectRepositoryDefinition = { project_repo_id: crypto.randomUUID(), display_name: opened.info.display_name, path: opened.info.worktree_root, display_order: activeProject.repositories.length, default_comparison: { mode: "all_uncommitted", left_full_ref: null, right_full_ref: null } };
      const updated = { ...activeProject, repositories: [...activeProject.repositories, definition] };
      await saveProject(updated);
      const key = runtimeKey(activeProject.project_id, definition.project_repo_id);
      setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId: definition.project_repo_id, repoId: opened.repo_id, generation: opened.generation, opening: false, error: null } }));
      dispatch({ type: "selectRepository", projectRepoId: definition.project_repo_id });
    } catch (error) {
      setOperationError(normalizeError(error));
    }
  }, [activeProject, cacheSnapshot, dispatch, saveProject]);

  const closeRuntimeRepository = useCallback(async (projectRepoId: string) => {
    if (!activeProject) return;
    const key = runtimeKey(activeProject.project_id, projectRepoId);
    const runtime = runtimeRef.current[key];
    if (runtime?.repoId) {
      try { await backend.closeRepository(runtime.repoId); } catch { /* Already closed is equivalent. */ }
      generations.remove(runtime.repoId);
      removeRepositoryQueries(runtime.repoId);
    }
    setRuntimeRepositories((items) => ({ ...items, [key]: { projectRepoId, repoId: null, generation: 0, opening: false, error: null } }));
  }, [activeProject]);

  const removeRepository = useCallback(async () => {
    if (!activeProject || !removeRepositoryId) return;
    try {
      setOperationError(null);
      await closeRuntimeRepository(removeRepositoryId);
      const remaining = activeProject.repositories.filter((item) => item.project_repo_id !== removeRepositoryId).map((item, index) => ({ ...item, display_order: index }));
      await saveProject({ ...activeProject, repositories: remaining });
      if (ui.activeProjectRepoId === removeRepositoryId) dispatch({ type: "selectRepository", projectRepoId: remaining[0]?.project_repo_id ?? null });
      setRemoveRepositoryId(null);
    } catch (error) {
      setOperationError(normalizeError(error));
    }
  }, [activeProject, closeRuntimeRepository, dispatch, removeRepositoryId, saveProject, ui.activeProjectRepoId]);

  const selectProject = useCallback(async (projectId: string) => {
    if (projectId === activeProject?.project_id) return;
    try {
      setOperationError(null);
      if (activeProject) {
        for (const definition of activeProject.repositories) await closeRuntimeRepository(definition.project_repo_id);
      }
      selectedPathRef.current = null;
      dispatch({ type: "selectProject", projectId });
    } catch (error) {
      setOperationError(normalizeError(error));
    }
  }, [activeProject, closeRuntimeRepository, dispatch]);

  const visibleFiles = useMemo(() => comparison ? filterFiles(comparison.files, ui.search, ui.statusFilters) : [], [comparison, ui.search, ui.statusFilters]);
  const selectFileAt = useCallback((index: number) => {
    const file = visibleFiles[index];
    if (!file) return;
    selectedPathRef.current = file.display_path;
    dispatch({ type: "selectFile", fileId: file.file_id });
  }, [dispatch, visibleFiles]);

  const commandActions: CommandAction[] = useMemo(() => [
    { id: "add", label: "Add local repository", shortcut: "Ctrl O", icon: commandIcons.add, run: () => void addRepository() },
    { id: "refresh", label: "Refresh active repository", shortcut: "Ctrl R", icon: commandIcons.refresh, run: () => activeRuntime?.repoId && void refreshRepository(activeRuntime.repoId) },
    { id: "filter", label: "Focus changed-file filter", shortcut: "Ctrl F", icon: commandIcons.filter, run: () => window.dispatchEvent(new Event("branch-review:focus-filter")) },
    { id: "split", label: "Use split diff", icon: commandIcons.split, run: () => dispatch({ type: "setDiffView", view: "split" }) },
    { id: "unified", label: "Use unified diff", icon: commandIcons.unified, run: () => dispatch({ type: "setDiffView", view: "unified" }) },
    { id: "sidebar", label: "Toggle repository pane", icon: commandIcons.sidebar, run: () => dispatch({ type: "toggleRepositoryPane" }) },
    { id: "files", label: "Toggle changed-file pane", icon: commandIcons.sidebar, run: () => dispatch({ type: "toggleFilePane" }) },
    { id: "help", label: "Show keyboard shortcuts", shortcut: "?", icon: commandIcons.help, run: () => dispatch({ type: "setShortcutHelp", open: true }) },
  ], [activeRuntime?.repoId, addRepository, dispatch, refreshRepository]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "o") { event.preventDefault(); void addRepository(); }
      if (modifier && event.key.toLowerCase() === "k") { event.preventDefault(); dispatch({ type: "setCommandPalette", open: true }); }
      if (modifier && event.key.toLowerCase() === "f") { event.preventDefault(); window.dispatchEvent(new Event("branch-review:focus-filter")); }
      if (modifier && event.key.toLowerCase() === "r") { event.preventDefault(); if (activeRuntime?.repoId) void refreshRepository(activeRuntime.repoId); }
      if (event.shiftKey && event.key.toLowerCase() === "d") { event.preventDefault(); dispatch({ type: "setDiffView", view: ui.diffView === "split" ? "unified" : "split" }); }
      if (event.shiftKey && (event.key.toLowerCase() === "j" || event.key.toLowerCase() === "k") && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        const index = visibleFiles.findIndex((file) => file.file_id === ui.activeFileId);
        selectFileAt(Math.max(0, Math.min(visibleFiles.length - 1, index + (event.key.toLowerCase() === "j" ? 1 : -1))));
      }
      if (event.key === "?" && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement)) dispatch({ type: "setShortcutHelp", open: true });
      if (event.altKey && (event.key === "ArrowDown" || event.key === "ArrowUp") && activeProject) {
        event.preventDefault();
        const index = activeProject.repositories.findIndex((item) => item.project_repo_id === ui.activeProjectRepoId);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = activeProject.repositories[Math.max(0, Math.min(activeProject.repositories.length - 1, index + delta))];
        if (next) dispatch({ type: "selectRepository", projectRepoId: next.project_repo_id });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeProject, activeRuntime?.repoId, addRepository, dispatch, refreshRepository, selectFileAt, ui.activeFileId, ui.activeProjectRepoId, ui.diffView, visibleFiles]);

  if (capabilitiesQuery.isLoading || projectsQuery.isLoading) return <StartupState />;
  if (capabilitiesQuery.error) return <SetupFailure error={normalizeError(capabilitiesQuery.error)} retry={() => void capabilitiesQuery.refetch()} />;
  if (projectsQuery.error) return <SetupFailure error={normalizeError(projectsQuery.error)} retry={() => void projectsQuery.refetch()} />;

  const currentError = activeRuntime?.error ?? (snapshotQuery.error ? normalizeError(snapshotQuery.error) : null);
  const createProject = async (name: string) => {
    try {
      setOperationError(null);
      const project = newProject(name);
      await saveProject(project);
      dispatch({ type: "selectProject", projectId: project.project_id });
      setProjectDialog(null);
    } catch (error) { setOperationError(normalizeError(error)); }
  };
  const renameProject = async (name: string) => {
    if (!activeProject) return;
    try {
      setOperationError(null);
      await saveProject({ ...activeProject, name });
      setProjectDialog(null);
    } catch (error) { setOperationError(normalizeError(error)); }
  };
  const deleteActiveProject = async () => {
    if (!activeProject) return;
    try {
      setOperationError(null);
      for (const definition of activeProject.repositories) await closeRuntimeRepository(definition.project_repo_id);
      await backend.deleteProject(activeProject.project_id);
      queryClient.setQueryData<ProjectDefinition[]>(queryKeys.projects, (items = []) => items.filter((item) => item.project_id !== activeProject.project_id));
      dispatch({ type: "selectProject", projectId: null });
      setDeleteProjectOpen(false);
    } catch (error) { setOperationError(normalizeError(error)); }
  };
  const upstreamComparison = snapshot ? findUpstreamComparison(snapshot.references) : null;
  const selectedVisibleIndex = visibleFiles.findIndex((file) => file.file_id === ui.activeFileId);
  const diffViewer = (
    <DiffViewer
      comparison={fileQuery.data ?? null}
      file={selectedFile}
      view={ui.diffView}
      loading={fileQuery.isLoading || fileQuery.isFetching}
      wrapLines={ui.wrapLines}
      ignoreTrimWhitespace={ui.ignoreTrimWhitespace}
      collapseUnchanged={ui.collapseUnchanged}
      filePaneCollapsed={ui.filePaneCollapsed}
      hasPrevious={selectedVisibleIndex > 0}
      hasNext={selectedVisibleIndex >= 0 && selectedVisibleIndex < visibleFiles.length - 1}
      onView={(view) => dispatch({ type: "setDiffView", view })}
      onWrapLines={(enabled) => dispatch({ type: "setWrapLines", enabled })}
      onIgnoreTrimWhitespace={(enabled) => dispatch({ type: "setIgnoreTrimWhitespace", enabled })}
      onCollapseUnchanged={(enabled) => dispatch({ type: "setCollapseUnchanged", enabled })}
      onToggleFilePane={() => dispatch({ type: "toggleFilePane" })}
      onPreviousFile={() => selectFileAt(selectedVisibleIndex - 1)}
      onNextFile={() => selectFileAt(selectedVisibleIndex + 1)}
    />
  );

  return (
    <div className="app-shell">
      <header className="title-bar">
        <div className="brand-mark"><span className="brand-mark__icon"><Braces size={15} /></span><span>Branch Review</span></div>
        <div className="title-bar__context">{activeProject ? <><strong>{activeProject.name}</strong><ChevronSeparator /><span>{snapshot?.info.display_name ?? repositoryViews.find((item) => item.definition.project_repo_id === ui.activeProjectRepoId)?.definition.display_name ?? "No repository"}</span><span className="review-badge" title="Branch Review never changes repository content"><ShieldCheck size={12} /> Read-only review</span></> : <span>No project selected</span>}</div>
        <button className="command-trigger" onClick={() => dispatch({ type: "setCommandPalette", open: true })}><Command size={14} /><span>Search commands</span><kbd>Ctrl K</kbd></button>
        <IconButton label="Add repository" shortcut="Ctrl+O" onClick={() => void addRepository()}><FolderPlus size={15} /></IconButton>
        <IconButton label="Keyboard shortcuts" shortcut="?" onClick={() => dispatch({ type: "setShortcutHelp", open: true })}><HelpCircle size={15} /></IconButton>
        <IconButton label="Settings and diagnostics" onClick={() => setSettingsOpen(true)}><Settings2 size={15} /></IconButton>
      </header>
      {projects.length === 0 ? (
        <main id="main-content" className="welcome-state">
          <EmptyState icon={FolderGit2} title="Start a local review" detail="Create a project, then add one or more Git repositories. Nothing is fetched or modified." action={<button className="button button--primary" onClick={() => setProjectDialog("create")}><Plus size={15} /> Create project</button>} />
        </main>
      ) : (
        <main id="main-content" className="workspace">
          <PanelGroup direction="horizontal" onLayout={(sizes) => localStorage.setItem("branch-review:repo-size", String(sizes[0]))}>
            <Panel defaultSize={ui.repositoryPaneCollapsed ? 4 : savedPaneSize("branch-review:repo-size", 17)} minSize={ui.repositoryPaneCollapsed ? 4 : 13} maxSize={ui.repositoryPaneCollapsed ? 4 : 28}>
              <RepositorySidebar projects={projects} activeProject={activeProject} activeProjectRepoId={ui.activeProjectRepoId} repositories={repositoryViews} collapsed={ui.repositoryPaneCollapsed} onProject={(id) => void selectProject(id)} onCreateProject={() => setProjectDialog("create")} onRenameProject={() => setProjectDialog("rename")} onDeleteProject={() => setDeleteProjectOpen(true)} onAddRepository={() => void addRepository()} onSelectRepository={(id) => dispatch({ type: "selectRepository", projectRepoId: id })} onRetryRepository={(id) => { const definition = activeProject?.repositories.find((item) => item.project_repo_id === id); if (activeProject && definition) void openDefinition(activeProject, definition, true); }} onCloseRepository={(id) => void closeRuntimeRepository(id)} onRemoveRepository={setRemoveRepositoryId} onToggleCollapsed={() => dispatch({ type: "toggleRepositoryPane" })} />
            </Panel>
            {!ui.repositoryPaneCollapsed && <PanelResizeHandle className="resize-handle" />}
            <Panel defaultSize={ui.repositoryPaneCollapsed ? 96 : 83} minSize={60}>
              <div className="review-area">
                {snapshot ? <ComparisonToolbar snapshot={snapshot} mode={ui.mode} leftFullRef={effectiveLeft} rightFullRef={effectiveRight} refreshing={refreshingRepoIds.has(snapshot.repo_id)} onMode={(mode) => void updateComparison(mode, effectiveLeft, effectiveRight)} onReferences={(left, right) => void updateComparison(ui.mode, left, right)} onCompareUpstream={() => { if (upstreamComparison) void updateComparison("direct", upstreamComparison.upstream.full_name, upstreamComparison.local.full_name); }} onRefresh={() => void refreshRepository(snapshot.repo_id)} /> : <div className="review-toolbar review-toolbar--disabled"><span>{activeRuntime?.opening ? "Opening repository…" : "Repository unavailable"}</span></div>}
                {operationError && <div className="operation-error"><InlineError error={operationError} /><IconButton label="Dismiss error" onClick={() => setOperationError(null)}><span aria-hidden="true">×</span></IconButton></div>}
                {currentError ? <div className="repository-error"><InlineError error={currentError} onRetry={activeProject && ui.activeProjectRepoId ? () => { const definition = activeProject.repositories.find((item) => item.project_repo_id === ui.activeProjectRepoId); if (definition) void openDefinition(activeProject, definition, true); } : undefined} /></div> : !snapshot ? <EmptyState icon={FolderGit2} title={activeRuntime?.opening ? "Opening repository" : "Select a repository"} detail={activeRuntime?.opening ? "Reading references and working tree status." : "Choose an available repository from the left pane."} /> : (
                  ui.filePaneCollapsed ? (
                    comparisonQuery.error ? <InlineError error={normalizeError(comparisonQuery.error)} onRetry={() => void comparisonQuery.refetch()} /> : fileQuery.error ? <InlineError error={normalizeError(fileQuery.error)} onRetry={() => void fileQuery.refetch()} /> : diffViewer
                  ) : (
                    <PanelGroup direction="horizontal" onLayout={(sizes) => localStorage.setItem("branch-review:file-size", String(sizes[0]))}>
                      <Panel defaultSize={savedPaneSize("branch-review:file-size", 24)} minSize={20} maxSize={38}>
                        <FileNavigator files={comparison?.files ?? []} search={ui.search} statusFilters={ui.statusFilters} activeFileId={ui.activeFileId} loading={comparisonQuery.isLoading || comparisonQuery.isFetching} view={ui.fileView} collapsedFolders={ui.collapsedFolders} onSearch={(search) => dispatch({ type: "setSearch", search })} onToggleStatus={(status) => dispatch({ type: "toggleStatus", status })} onView={(view) => dispatch({ type: "setFileView", view })} onToggleFolder={(path) => dispatch({ type: "toggleFolder", path })} onSelect={(fileId) => { const path = comparison?.files.find((file) => file.file_id === fileId)?.display_path ?? null; selectedPathRef.current = path; dispatch({ type: "selectFile", fileId }); }} />
                      </Panel>
                      <PanelResizeHandle className="resize-handle" />
                      <Panel defaultSize={76} minSize={48}>{comparisonQuery.error ? <InlineError error={normalizeError(comparisonQuery.error)} onRetry={() => void comparisonQuery.refetch()} /> : fileQuery.error ? <InlineError error={normalizeError(fileQuery.error)} onRetry={() => void fileQuery.refetch()} /> : diffViewer}</Panel>
                    </PanelGroup>
                  )
                )}
              </div>
            </Panel>
          </PanelGroup>
        </main>
      )}
      <StatusBar capabilities={capabilitiesQuery.data ?? null} snapshot={snapshot} refreshing={snapshot ? refreshingRepoIds.has(snapshot.repo_id) : false} warning={watcherWarning} updateVersion={updater.state.status === "available" ? updater.state.version : null} onUpdate={() => setUpdateOpen(true)} />
      <NameDialog open={projectDialog !== null} title={projectDialog === "rename" ? "Rename project" : "Create project"} initialValue={projectDialog === "rename" ? activeProject?.name ?? "" : ""} submitLabel={projectDialog === "rename" ? "Rename" : "Create"} onClose={() => setProjectDialog(null)} onSubmit={projectDialog === "rename" ? renameProject : createProject} />
      <ConfirmDialog open={deleteProjectOpen} title="Delete project?" detail={`Remove “${activeProject?.name ?? "this project"}” and its saved repository list from Branch Review.`} confirmLabel="Delete project" onClose={() => setDeleteProjectOpen(false)} onConfirm={deleteActiveProject} />
      <ConfirmDialog open={removeRepositoryId !== null} title="Remove repository from project?" detail="The repository will be closed in Branch Review and removed from this project." confirmLabel="Remove repository" onClose={() => setRemoveRepositoryId(null)} onConfirm={removeRepository} />
      <CommandPalette open={ui.commandPaletteOpen} onClose={() => dispatch({ type: "setCommandPalette", open: false })} actions={commandActions} />
      <ShortcutHelp open={ui.shortcutHelpOpen} onClose={() => dispatch({ type: "setShortcutHelp", open: false })} />
      <DiagnosticsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} capabilities={capabilitiesQuery.data ?? null} />
      <UpdateDialog open={updateOpen} onClose={() => setUpdateOpen(false)} updater={updater.state} onCheck={() => void updater.checkForUpdates()} onInstall={() => void updater.installUpdate()} />
      <span className="sr-only" aria-live="polite">{comparison ? `${visibleFiles.length} changed files visible` : ""}</span>
    </div>
  );
}

function StartupState() { return <div className="startup"><div className="startup__logo"><Braces size={20} /></div><span>Branch Review</span><LoaderCircle className="spin" size={15} /><small>Checking local Git and projects</small></div>; }
function ChevronSeparator() { return <span className="context-separator" aria-hidden="true">/</span>; }
function SetupFailure({ error, retry }: { error: FrontendError; retry(): void }) { return <main className="setup-failure"><AlertTriangle size={24} /><h1>Branch Review cannot start</h1><p>{error.message}</p><code>{error.code}</code><button className="button button--primary" onClick={retry}>Try again</button></main>; }
function DiagnosticsDialog({ open, onClose, capabilities }: { open: boolean; onClose(): void; capabilities: BackendCapabilities | null }) {
  return <Dialog open={open} onClose={onClose} title="Settings and diagnostics" description="Local, read-only runtime information." width="medium"><section className="diagnostics"><dl><div><dt>Backend API</dt><dd>{capabilities?.api_version ?? "—"}</dd></div><div><dt>Git</dt><dd>{capabilities?.git_version ?? "Unavailable"}</dd></div><div><dt>SHA-256 repositories</dt><dd>{capabilities?.supports_sha256 ? "Supported" : "Not reported"}</dd></div><div><dt>File display limit</dt><dd>{capabilities ? `${Math.round(capabilities.max_file_bytes / 1024 / 1024)} MB` : "—"}</dd></div></dl><p><PanelLeft size={14} /> Pane sizes and diff layout are stored only on this device.</p><p><FolderGit2 size={14} /> Repository content never leaves the local Tauri process.</p></section></Dialog>;
}
