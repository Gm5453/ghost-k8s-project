import { AlertTriangle, X } from "lucide-react";
import { useEffect } from "react";

export type ConfirmOpts = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
};

export function ConfirmDialog({
  open,
  opts,
  onClose,
}: {
  open: boolean;
  opts: ConfirmOpts | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !opts) return null;
  const destructive = opts.destructive ?? true;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-foreground/50 backdrop-blur-md p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-border bg-card/95 shadow-elegant animate-scale-in"
      >
        <div className="flex items-start gap-3 p-5">
          <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${destructive ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-500"}`}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold">{opts.title}</h3>
            {opts.description && (
              <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{opts.description}</p>
            )}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            onClick={async () => { await opts.onConfirm(); onClose(); }}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white transition ${
              destructive ? "bg-destructive hover:opacity-90" : "bg-primary hover:opacity-90"
            }`}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
