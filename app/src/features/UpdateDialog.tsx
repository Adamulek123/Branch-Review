import { CheckCircle2, Download, LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import { Dialog } from "../components/Dialog";
import type { UpdaterState } from "../app/use-updater";

export function UpdateDialog({ open, onClose, updater, onCheck, onInstall }: {
  open: boolean;
  onClose(): void;
  updater: UpdaterState;
  onCheck(): void;
  onInstall(): void;
}) {
  const busy = updater.status === "checking" || updater.status === "downloading" || updater.status === "installing";
  const available = Boolean(updater.version) && ["available", "downloading", "installing", "error"].includes(updater.status);
  return <Dialog
    open={open}
    onClose={busy ? () => undefined : onClose}
    title={available ? `Branch Review ${updater.version}` : "Application updates"}
    description={available ? `Installed: ${updater.currentVersion ?? "unknown"}` : "Install new releases without downloading another setup file."}
    width="medium"
    footer={<>
      <button className="button button--ghost" disabled={busy} onClick={onCheck}><RefreshCw className={updater.status === "checking" ? "spin" : ""} size={14} /> Check again</button>
      {available && <button className="button button--primary" disabled={busy} onClick={onInstall}><Download size={14} /> {updater.status === "installing" ? "Installing…" : updater.status === "downloading" ? "Downloading…" : "Install update"}</button>}
    </>}
  >
    <section className="update-panel">
      {updater.status === "idle" && <p>Check GitHub Releases for the newest signed version.</p>}
      {updater.status === "checking" && <p><LoaderCircle className="spin" size={16} /> Checking for updates…</p>}
      {updater.status === "up-to-date" && <p className="update-panel__success"><CheckCircle2 size={16} /> You already have the newest version.</p>}
      {updater.error && <p className="update-panel__error"><TriangleAlert size={16} /> {updater.error}</p>}
      {available && <>
        {updater.status === "downloading" && <div className="update-progress"><progress value={updater.progress ?? undefined} max="100" /><span>{updater.progress === null ? "Downloading…" : `${updater.progress}%`}</span></div>}
        {updater.status === "installing" && <p><LoaderCircle className="spin" size={16} /> Installing and restarting Branch Review…</p>}
        {updater.notes && <div className="release-notes"><strong>What changed</strong><pre>{updater.notes}</pre></div>}
      </>}
    </section>
  </Dialog>;
}
