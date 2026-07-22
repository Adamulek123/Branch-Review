import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  children: ReactNode;
  tone?: "default" | "danger" | "accent";
}

export function IconButton({ label, shortcut, children, tone = "default", className = "", ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`icon-button icon-button--${tone} ${className}`}
      aria-label={label}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      {...props}
    >
      {children}
    </button>
  );
}
