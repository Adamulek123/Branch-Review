import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Columns2, FileSearch, FolderPlus, HelpCircle, PanelLeftClose, RefreshCw, Rows3, Search, X } from "lucide-react";
import { Dialog } from "../components/Dialog";

export interface CommandAction {
  id: string;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  run(): void;
}

export function CommandPalette({ open, onClose, actions }: { open: boolean; onClose(): void; actions: CommandAction[] }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => { if (open) { setQuery(""); setIndex(0); } }, [open]);
  const filtered = useMemo(() => actions.filter((action) => action.label.toLowerCase().includes(query.toLowerCase())), [actions, query]);
  return (
    <Dialog open={open} title="Commands" onClose={onClose} width="medium">
      <div className="command-search"><Search size={15} /><input autoFocus value={query} onChange={(event) => { setQuery(event.target.value); setIndex(0); }} placeholder="Type a command" aria-label="Search commands" onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setIndex((value) => Math.min(filtered.length - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setIndex((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter" && filtered[index]) { filtered[index].run(); onClose(); }
      }} />{query && <button aria-label="Clear command search" onClick={() => setQuery("")}><X size={14} /></button>}</div>
      <div className="command-list">{filtered.map((action, actionIndex) => <button key={action.id} className={actionIndex === index ? "is-active" : ""} onMouseEnter={() => setIndex(actionIndex)} onClick={() => { action.run(); onClose(); }}><span>{action.icon}{action.label}</span>{action.shortcut && <kbd>{action.shortcut}</kbd>}</button>)}</div>
    </Dialog>
  );
}

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose(): void }) {
  const shortcuts = [["Open repository", "Ctrl/⌘ O"], ["Command palette", "Ctrl/⌘ K"], ["Filter files", "Ctrl/⌘ F"], ["Refresh", "Ctrl/⌘ R"], ["Next / previous file", "J / K or ↑ / ↓"], ["Next / previous repository", "Alt + ↓ / ↑"], ["Toggle diff layout", "Shift + D"], ["Shortcut reference", "?"]];
  return <Dialog open={open} title="Keyboard shortcuts" description="Everything in the core review flow is reachable without a pointer." onClose={onClose} width="medium"><dl className="shortcut-list">{shortcuts.map(([label, shortcut]) => <div key={label}><dt>{label}</dt><dd><kbd>{shortcut}</kbd></dd></div>)}</dl></Dialog>;
}

export const commandIcons = {
  add: <FolderPlus size={15} />, refresh: <RefreshCw size={15} />, filter: <FileSearch size={15} />,
  split: <Columns2 size={15} />, unified: <Rows3 size={15} />, sidebar: <PanelLeftClose size={15} />, help: <HelpCircle size={15} />,
};
