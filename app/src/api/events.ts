import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AuditEvent, RemediationEvent, RepositoryUpdatedPayload } from "./types";

export type RepositoryUpdateHandler = (payload: RepositoryUpdatedPayload) => void;

export async function listenForRepositoryUpdates(
  handler: RepositoryUpdateHandler,
): Promise<UnlistenFn> {
  return listen<RepositoryUpdatedPayload>("repository://updated", (event) => handler(event.payload));
}

export async function listenForAuditEvents(
  handler: (payload: AuditEvent) => void,
): Promise<UnlistenFn> {
  return listen<AuditEvent>("audit://event", (event) => handler(event.payload));
}

export async function listenForRemediationEvents(
  handler: (payload: RemediationEvent) => void,
): Promise<UnlistenFn> {
  return listen<RemediationEvent>("agent://event", (event) => handler(event.payload));
}
