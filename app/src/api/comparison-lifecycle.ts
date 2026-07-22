import type { BackendClient } from "./backend";
import { normalizeError } from "./backend";
import type { ChangedFile, ComparisonRequest, ComparisonResult, FileComparison, RepoId } from "./types";

interface RecoveryInput {
  client: BackendClient;
  repoId: RepoId;
  request: ComparisonRequest;
  comparison: ComparisonResult;
  file: ChangedFile;
  accept<T extends { repo_id: RepoId; generation: number }>(value: T): T;
  onRenewed(comparison: ComparisonResult): void;
}

/** Loads a file and performs at most one comparison recreation. */
export async function loadFileWithComparisonRecovery(input: RecoveryInput): Promise<FileComparison> {
  try {
    return input.accept(await input.client.getFileComparison(input.repoId, input.comparison.comparison_id, input.file.file_id));
  } catch (error) {
    const normalized = normalizeError(error);
    if (normalized.code !== "INVALID_COMPARISON_ID") throw normalized;

    const renewed = input.accept(await input.client.createComparison(input.repoId, input.request));
    input.onRenewed(renewed);
    const replacement = renewed.files.find((file) => file.display_path === input.file.display_path);
    if (!replacement) throw normalized;

    // This second file load is deliberately not wrapped: a second expiry is
    // surfaced to the user instead of entering an unbounded lifecycle loop.
    return input.accept(await input.client.getFileComparison(input.repoId, renewed.comparison_id, replacement.file_id));
  }
}
