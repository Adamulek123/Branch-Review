import { useEffect, useState, type FormEvent } from "react";
import { Dialog } from "./Dialog";

export function NameDialog({
  open,
  title,
  initialValue = "",
  submitLabel,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  initialValue?: string;
  submitLabel: string;
  onClose(): void;
  onSubmit(value: string): void | Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue, open]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (next) void onSubmit(next);
  };
  return (
    <Dialog
      open={open}
      title={title}
      onClose={onClose}
      footer={<><button className="button button--ghost" type="button" onClick={onClose}>Cancel</button><button className="button button--primary" form="name-dialog-form" type="submit" disabled={!value.trim()}>{submitLabel}</button></>}
    >
      <form id="name-dialog-form" onSubmit={submit}>
        <label className="field"><span>Name</span><input autoFocus value={value} onChange={(event) => setValue(event.target.value)} /></label>
      </form>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  detail,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  detail: string;
  confirmLabel: string;
  onClose(): void;
  onConfirm(): void | Promise<void>;
}) {
  return (
    <Dialog open={open} title={title} description={detail} onClose={onClose} footer={<><button className="button button--ghost" onClick={onClose}>Cancel</button><button className="button button--danger" onClick={() => void onConfirm()}>{confirmLabel}</button></>}>
      <div className="confirm-note">This only changes Branch Review configuration. It never modifies the Git repository.</div>
    </Dialog>
  );
}
