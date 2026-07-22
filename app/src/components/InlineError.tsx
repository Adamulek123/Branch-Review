import { AlertTriangle, RotateCw } from "lucide-react";
import type { FrontendError } from "../api/types";

export function InlineError({ error, onRetry }: { error: FrontendError; onRetry?: () => void }) {
  return (
    <div className="inline-error" role="alert">
      <AlertTriangle size={16} />
      <div><strong>{error.message}</strong><span>{error.code.replaceAll("_", " ").toLowerCase()}</span></div>
      {onRetry && <button type="button" className="text-button" onClick={onRetry}><RotateCw size={14} /> Retry</button>}
    </div>
  );
}
