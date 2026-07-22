import { invoke } from "@tauri-apps/api/core";
import type {
  BackendCapabilities,
  ComparisonRequest,
  ComparisonResult,
  FileComparison,
  FileId,
  FrontendError,
  ProjectDefinition,
  RepoId,
  RepositoryInfo,
  RepositorySnapshot,
  ComparisonId,
} from "./types";

export interface BackendClient {
  getCapabilities(): Promise<BackendCapabilities>;
  openRepository(path: string): Promise<RepositorySnapshot>;
  closeRepository(repoId: RepoId): Promise<void>;
  listOpenRepositories(): Promise<RepositoryInfo[]>;
  refreshRepository(repoId: RepoId): Promise<RepositorySnapshot>;
  getRepositorySnapshot(repoId: RepoId): Promise<RepositorySnapshot>;
  createComparison(repoId: RepoId, request: ComparisonRequest): Promise<ComparisonResult>;
  getFileComparison(repoId: RepoId, comparisonId: ComparisonId, fileId: FileId): Promise<FileComparison>;
  pickRepositoryDirectory(): Promise<string | null>;
  loadProjects(): Promise<ProjectDefinition[]>;
  saveProject(project: ProjectDefinition): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
}

export function normalizeError(error: unknown): FrontendError {
  if (typeof error === "object" && error !== null && "code" in error && "message" in error) {
    const candidate = error as Partial<FrontendError>;
    return {
      code: candidate.code ?? "IO",
      message: candidate.message ?? "An unexpected local operation failed",
      retryable: candidate.retryable ?? false,
      repo_id: candidate.repo_id ?? null,
      operation_id: candidate.operation_id ?? null,
    };
  }
  return {
    code: "IO",
    // Unknown failures can contain absolute paths or implementation details.
    // Only structured FrontendError payloads cross the presentation boundary.
    message: "An unexpected local operation failed",
    retryable: false,
    repo_id: null,
    operation_id: null,
  };
}

async function call<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, payload);
  } catch (error) {
    throw normalizeError(error);
  }
}

export const backend: BackendClient = {
  getCapabilities: () => call("get_backend_capabilities"),
  openRepository: (path) => call("open_repository", { args: { path } }),
  closeRepository: (repoId) => call("close_repository", { args: { repo_id: repoId } }),
  listOpenRepositories: () => call("list_open_repositories"),
  refreshRepository: (repoId) => call("refresh_repository", { args: { repo_id: repoId } }),
  getRepositorySnapshot: (repoId) => call("get_repository_snapshot", { args: { repo_id: repoId } }),
  createComparison: (repoId, request) => call("create_comparison", { args: { repo_id: repoId, request } }),
  getFileComparison: (repoId, comparisonId, fileId) =>
    call("get_file_comparison", {
      args: { repo_id: repoId, comparison_id: comparisonId, file_id: fileId },
    }),
  pickRepositoryDirectory: () => call("pick_repository_directory"),
  loadProjects: () => call("load_projects"),
  saveProject: (project) => call("save_project", { args: { project } }),
  deleteProject: (projectId) => call("delete_project", { args: { project_id: projectId } }),
};
