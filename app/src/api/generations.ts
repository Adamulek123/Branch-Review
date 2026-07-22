import type { RepoId } from "./types";

export class StaleResponseError extends Error {
  constructor() {
    super("A newer repository generation is already available");
    this.name = "StaleResponseError";
  }
}

export class GenerationCoordinator {
  private readonly latest = new Map<RepoId, number>();

  current(repoId: RepoId): number {
    return this.latest.get(repoId) ?? 0;
  }

  observe(repoId: RepoId, generation: number): boolean {
    const current = this.current(repoId);
    if (generation < current) return false;
    this.latest.set(repoId, generation);
    return true;
  }

  noteUpdate(repoId: RepoId, generation: number): boolean {
    if (generation <= this.current(repoId)) return false;
    this.latest.set(repoId, generation);
    return true;
  }

  accept<T extends { repo_id: RepoId; generation: number }>(value: T): T {
    if (!this.observe(value.repo_id, value.generation)) throw new StaleResponseError();
    return value;
  }

  remove(repoId: RepoId): void {
    this.latest.delete(repoId);
  }

  clear(): void {
    this.latest.clear();
  }
}

export const generations = new GenerationCoordinator();
