import { createContext, useContext, useEffect, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { ComparisonMode, FileId } from "../api/types";

export type DiffView = "split" | "unified";
export type FileView = "tree" | "list";

export interface UiState {
  activeProjectId: string | null;
  activeProjectRepoId: string | null;
  activeFileId: FileId | null;
  mode: ComparisonMode;
  leftFullRef: string | null;
  rightFullRef: string | null;
  diffView: DiffView;
  fileView: FileView;
  collapsedFolders: string[];
  filePaneCollapsed: boolean;
  wrapLines: boolean;
  ignoreTrimWhitespace: boolean;
  collapseUnchanged: boolean;
  search: string;
  statusFilters: string[];
  repositoryPaneCollapsed: boolean;
  commandPaletteOpen: boolean;
  shortcutHelpOpen: boolean;
}

type UiAction =
  | { type: "selectProject"; projectId: string | null }
  | { type: "selectRepository"; projectRepoId: string | null }
  | { type: "selectFile"; fileId: FileId | null }
  | { type: "setComparison"; mode: ComparisonMode; leftFullRef?: string | null; rightFullRef?: string | null }
  | { type: "setDiffView"; view: DiffView }
  | { type: "setFileView"; view: FileView }
  | { type: "toggleFolder"; path: string }
  | { type: "toggleFilePane" }
  | { type: "setWrapLines"; enabled: boolean }
  | { type: "setIgnoreTrimWhitespace"; enabled: boolean }
  | { type: "setCollapseUnchanged"; enabled: boolean }
  | { type: "setSearch"; search: string }
  | { type: "toggleStatus"; status: string }
  | { type: "toggleRepositoryPane" }
  | { type: "setCommandPalette"; open: boolean }
  | { type: "setShortcutHelp"; open: boolean };

function storedStringArray(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
  } catch {
    return [];
  }
}

const initialState: UiState = {
  activeProjectId: null,
  activeProjectRepoId: null,
  activeFileId: null,
  mode: "all_uncommitted",
  leftFullRef: null,
  rightFullRef: null,
  diffView: (localStorage.getItem("branch-review:diff-view") as DiffView | null) ?? "split",
  fileView: (localStorage.getItem("branch-review:file-view") as FileView | null) ?? "tree",
  collapsedFolders: storedStringArray("branch-review:collapsed-folders"),
  filePaneCollapsed: localStorage.getItem("branch-review:file-pane-collapsed") === "true",
  wrapLines: localStorage.getItem("branch-review:wrap-lines") === "true",
  ignoreTrimWhitespace: localStorage.getItem("branch-review:ignore-whitespace") === "true",
  collapseUnchanged: localStorage.getItem("branch-review:collapse-unchanged") !== "false",
  search: "",
  statusFilters: [],
  repositoryPaneCollapsed: localStorage.getItem("branch-review:repo-collapsed") === "true",
  commandPaletteOpen: false,
  shortcutHelpOpen: false,
};

function reducer(state: UiState, action: UiAction): UiState {
  switch (action.type) {
    case "selectProject":
      return { ...state, activeProjectId: action.projectId, activeProjectRepoId: null, activeFileId: null };
    case "selectRepository":
      return { ...state, activeProjectRepoId: action.projectRepoId, activeFileId: null, search: "" };
    case "selectFile":
      return { ...state, activeFileId: action.fileId };
    case "setComparison":
      return {
        ...state,
        mode: action.mode,
        leftFullRef: action.leftFullRef ?? null,
        rightFullRef: action.rightFullRef ?? null,
        activeFileId: null,
      };
    case "setDiffView":
      return { ...state, diffView: action.view };
    case "setFileView":
      return { ...state, fileView: action.view };
    case "toggleFolder":
      return {
        ...state,
        collapsedFolders: state.collapsedFolders.includes(action.path)
          ? state.collapsedFolders.filter((path) => path !== action.path)
          : [...state.collapsedFolders, action.path],
      };
    case "toggleFilePane":
      return { ...state, filePaneCollapsed: !state.filePaneCollapsed };
    case "setWrapLines":
      return { ...state, wrapLines: action.enabled };
    case "setIgnoreTrimWhitespace":
      return { ...state, ignoreTrimWhitespace: action.enabled };
    case "setCollapseUnchanged":
      return { ...state, collapseUnchanged: action.enabled };
    case "setSearch":
      return { ...state, search: action.search };
    case "toggleStatus":
      return {
        ...state,
        statusFilters: state.statusFilters.includes(action.status)
          ? state.statusFilters.filter((value) => value !== action.status)
          : [...state.statusFilters, action.status],
      };
    case "toggleRepositoryPane":
      return { ...state, repositoryPaneCollapsed: !state.repositoryPaneCollapsed };
    case "setCommandPalette":
      return { ...state, commandPaletteOpen: action.open };
    case "setShortcutHelp":
      return { ...state, shortcutHelpOpen: action.open };
  }
}

interface UiContextValue {
  state: UiState;
  dispatch: Dispatch<UiAction>;
}

const UiContext = createContext<UiContextValue | null>(null);

export function UiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(() => localStorage.setItem("branch-review:diff-view", state.diffView), [state.diffView]);
  useEffect(() => localStorage.setItem("branch-review:file-view", state.fileView), [state.fileView]);
  useEffect(() => localStorage.setItem("branch-review:collapsed-folders", JSON.stringify(state.collapsedFolders)), [state.collapsedFolders]);
  useEffect(() => localStorage.setItem("branch-review:file-pane-collapsed", String(state.filePaneCollapsed)), [state.filePaneCollapsed]);
  useEffect(() => localStorage.setItem("branch-review:wrap-lines", String(state.wrapLines)), [state.wrapLines]);
  useEffect(() => localStorage.setItem("branch-review:ignore-whitespace", String(state.ignoreTrimWhitespace)), [state.ignoreTrimWhitespace]);
  useEffect(() => localStorage.setItem("branch-review:collapse-unchanged", String(state.collapseUnchanged)), [state.collapseUnchanged]);
  useEffect(
    () => localStorage.setItem("branch-review:repo-collapsed", String(state.repositoryPaneCollapsed)),
    [state.repositoryPaneCollapsed],
  );
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const value = useContext(UiContext);
  if (!value) throw new Error("useUi must be used inside UiProvider");
  return value;
}
