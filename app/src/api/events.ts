import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { RepositoryUpdatedPayload } from "./types";

export type RepositoryUpdateHandler = (payload: RepositoryUpdatedPayload) => void;

export async function listenForRepositoryUpdates(
  handler: RepositoryUpdateHandler,
): Promise<UnlistenFn> {
  return listen<RepositoryUpdatedPayload>("repository://updated", (event) => handler(event.payload));
}
