import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  children: ReactNode;
  tone?: "default" | "danger" | "accent";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, children, tone = "default", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`icon-button icon-button--${tone} ${className}`}
      aria-label={label}
      data-tooltip={shortcut ? `${label} · ${shortcut}` : label}
      {...props}
    >
      {children}
    </button>
  );
});
