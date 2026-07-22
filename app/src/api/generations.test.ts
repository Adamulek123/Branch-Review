import { describe, expect, it } from "vitest";
import { GenerationCoordinator, StaleResponseError } from "./generations";
import type { RepoId } from "./types";

describe("GenerationCoordinator", () => {
  const repo = "repo" as RepoId;
  it("rejects older command completions", () => {
    const coordinator = new GenerationCoordinator();
    coordinator.noteUpdate(repo, 5);
    expect(() => coordinator.accept({ repo_id: repo, generation: 4 })).toThrow(StaleResponseError);
    expect(coordinator.accept({ repo_id: repo, generation: 5 })).toEqual({ repo_id: repo, generation: 5 });
  });
  it("ignores duplicate updates and forgets closed repositories", () => {
    const coordinator = new GenerationCoordinator();
    expect(coordinator.noteUpdate(repo, 2)).toBe(true);
    expect(coordinator.noteUpdate(repo, 2)).toBe(false);
    coordinator.remove(repo);
    expect(coordinator.current(repo)).toBe(0);
  });
});
