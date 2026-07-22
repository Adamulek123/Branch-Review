import type { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  detail: string;
  action?: React.ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, detail, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state${compact ? " empty-state--compact" : ""}`}>
      <div className="empty-state__mark"><Icon size={compact ? 18 : 22} strokeWidth={1.6} /></div>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </div>
  );
}
