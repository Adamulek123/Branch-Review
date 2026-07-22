import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useUpdater } from "./use-updater";

vi.mock("@tauri-apps/plugin-updater", () => ({ check: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));

describe("useUpdater", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports that the installed version is current", async () => {
    vi.mocked(check).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater());
    await act(() => result.current.checkForUpdates());
    expect(result.current.state.status).toBe("up-to-date");
  });

  it("downloads, installs, and relaunches an available update", async () => {
    const downloadAndInstall = vi.fn(async (onEvent) => {
      onEvent?.({ event: "Started", data: { contentLength: 100 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 40 } });
      onEvent?.({ event: "Finished" });
    });
    vi.mocked(check).mockResolvedValue({ currentVersion: "0.1.2", version: "0.2.0", body: "Faster switching", downloadAndInstall } as never);
    const { result } = renderHook(() => useUpdater());

    await act(() => result.current.checkForUpdates());
    expect(result.current.state).toMatchObject({ status: "available", currentVersion: "0.1.2", version: "0.2.0" });
    await act(() => result.current.installUpdate());

    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.state.progress).toBe(100));
  });

  it("keeps silent startup failures out of the interface", async () => {
    vi.mocked(check).mockRejectedValue(new Error("No release exists yet"));
    const { result } = renderHook(() => useUpdater());
    await act(() => result.current.checkForUpdates(true));
    expect(result.current.state).toEqual(expect.objectContaining({ status: "idle", error: null }));
  });
});
