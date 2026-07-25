import type { ChangeKind } from "../api/types";
import { statusMeta } from "./comparison-utils";

interface FileStatusIconProps {
  status: ChangeKind;
  size?: number;
  decorative?: boolean;
  className?: string;
}

const documentPath = "M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073Z";
const addedPath = "M8.23 5.258a.75.75 0 0 1 .755.745l.01 1.497h1.497a.75.75 0 0 1 0 1.5H9v1.507a.75.75 0 0 1-1.5 0V9.005l-1.502.01a.75.75 0 0 1-.01-1.5l1.507-.01-.01-1.492a.75.75 0 0 1 .745-.755Z";
const deletedPath = "M5.75 7.25h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z";
const modifiedPath = "M5.25 5.75A.75.75 0 0 1 6 5h4.5a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75Zm0 3A.75.75 0 0 1 6 8h2.25a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75Zm4.72-.53a.75.75 0 0 1 1.06 0l.75.75a.75.75 0 0 1 0 1.06l-1.94 1.94a.75.75 0 0 1-.37.2l-1.36.28a.5.5 0 0 1-.59-.59l.28-1.36a.75.75 0 0 1 .2-.37Z";
const renamedPath = "M5.25 6A.75.75 0 0 1 6 5.25h3.19l-.72-.72a.75.75 0 0 1 1.06-1.06l2 2a.75.75 0 0 1 0 1.06l-2 2a.75.75 0 0 1-1.06-1.06l.72-.72H6A.75.75 0 0 1 5.25 6Zm5.5 4A.75.75 0 0 1 10 10.75H6.81l.72.72a.75.75 0 0 1-1.06 1.06l-2-2a.75.75 0 0 1 0-1.06l2-2a.75.75 0 0 1 1.06 1.06l-.72.72H10a.75.75 0 0 1 .75.75Z";
const conflictPath = "M8.5 4.5a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-3a.75.75 0 0 1 .75-.75Zm0 7.25a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z";

function markPath(status: ChangeKind): string {
  if (status === "added" || status === "untracked") return addedPath;
  if (status === "deleted") return deletedPath;
  if (status === "renamed" || status === "copied") return renamedPath;
  if (status === "unmerged") return conflictPath;
  return modifiedPath;
}

export function FileStatusIcon({
  status,
  size = 16,
  decorative = false,
  className = "",
}: FileStatusIconProps) {
  const meta = statusMeta[status];
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={`file-status-icon status-${meta.group} ${className}`}
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? "true" : undefined}
      aria-label={decorative ? undefined : meta.label}
      focusable="false"
    >
      <path d={documentPath} />
      <path d={markPath(status)} />
    </svg>
  );
}
