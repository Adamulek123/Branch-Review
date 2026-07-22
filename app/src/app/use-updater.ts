import { useCallback, useEffect, useRef, useState } from "react";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type UpdateStatus = "idle" | "checking" | "available" | "up-to-date" | "downloading" | "installing" | "error";

export interface UpdaterState {
  status: UpdateStatus;
  currentVersion: string | null;
  version: string | null;
  notes: string | null;
  progress: number | null;
  error: string | null;
}

const initialState: UpdaterState = {
  status: "idle",
  currentVersion: null,
  version: null,
  notes: null,
  progress: null,
  error: null,
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useUpdater() {
  const [state, setState] = useState<UpdaterState>(initialState);
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);
  const installingRef = useRef(false);

  const checkForUpdates = useCallback(async (silent = false) => {
    if (checkingRef.current || installingRef.current) return;
    checkingRef.current = true;
    if (!silent) setState((current) => ({ ...current, status: "checking", error: null }));
    try {
      const update = await check({ timeout: 15_000 });
      updateRef.current = update;
      if (update) {
        setState({
          status: "available",
          currentVersion: update.currentVersion,
          version: update.version,
          notes: update.body ?? null,
          progress: null,
          error: null,
        });
      } else if (!silent) {
        setState((current) => ({ ...current, status: "up-to-date", error: null }));
      }
    } catch (error) {
      if (!silent) setState((current) => ({ ...current, status: "error", error: errorMessage(error) }));
    } finally {
      checkingRef.current = false;
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update || installingRef.current) return;
    installingRef.current = true;
    let downloaded = 0;
    let total: number | undefined;
    setState((current) => ({ ...current, status: "downloading", progress: 0, error: null }));
    try {
      const onDownload = (event: DownloadEvent) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        if (event.event === "Finished") {
          setState((current) => ({ ...current, status: "installing", progress: 100 }));
          return;
        }
        const progress = total && total > 0 ? Math.min(99, Math.round(downloaded / total * 100)) : null;
        setState((current) => ({ ...current, status: "downloading", progress }));
      };
      await update.downloadAndInstall(onDownload);
      await relaunch();
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: errorMessage(error) }));
    } finally {
      installingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates(true), 2_000);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  return { state, checkForUpdates, installUpdate };
}
