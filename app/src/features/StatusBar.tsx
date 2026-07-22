import { AlertTriangle, Check, CircleDot, Download, GitBranch, LockKeyhole } from "lucide-react";
import type { BackendCapabilities, RepositorySnapshot } from "../api/types";

export function StatusBar({ capabilities, snapshot, refreshing, warning, updateVersion, onUpdate }: { capabilities: BackendCapabilities | null; snapshot: RepositorySnapshot | null; refreshing: boolean; warning: string | null; updateVersion?: string | null; onUpdate?(): void }) {
  return <footer className="status-bar" aria-label="Application status">
    <div>{warning ? <span className="status-bar__warning" title={warning}><AlertTriangle size={12} /> Watcher unavailable</span> : <span><Check size={12} /> Watching</span>}{snapshot && <><span><GitBranch size={12} /> generation {snapshot.generation}</span>{snapshot.info.is_shallow && <span><CircleDot size={12} /> shallow</span>}</>}</div>
    <div>{refreshing && <span className="status-bar__sync"><i /> Refreshing</span>}{updateVersion && <button className="status-bar__update" onClick={onUpdate}><Download size={12} /> Update {updateVersion}</button>}<span><LockKeyhole size={12} /> Read-only boundary</span>{capabilities && <span>{capabilities.git_version}</span>}</div>
  </footer>;
}
