"use client";
/** Dialogues (Radix, accessibles) et notifications (toasts). */
import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "./primitives";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <RDialog.Content
          className={cx(
            "fixed z-50 w-full bg-graphite p-5 shadow-2xl outline-none",
            "inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-[20px] safe-bottom",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,460px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]",
          )}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <RDialog.Title className="text-lg font-semibold text-ivory">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-fog">{description}</RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">{title}</RDialog.Description>
              )}
            </div>
            <RDialog.Close className="-m-2 rounded-full p-2 text-fog hover:text-ivory" aria-label="Fermer">
              <X className="size-5" />
            </RDialog.Close>
          </div>
          {children}
          {footer ? <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div> : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type ToastTone = "info" | "success" | "error" | "hunter" | "fugitive";
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastCtx = createContext<{ push: (message: string, tone?: ToastTone) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const push = useCallback((message: string, tone: ToastTone = "info") => {
    const id = ++seq.current;
    setItems((cur) => [...cur.slice(-2), { id, message, tone }]);
    setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), tone === "error" ? 5000 : 3200);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),12px)]"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto max-w-md rounded-[12px] bg-slate-2 px-4 py-2.5 text-sm text-ivory shadow-lg shadow-black/40",
              t.tone === "error" && "text-hunter",
              t.tone === "success" && "text-fugitive",
              t.tone === "hunter" && "shadow-[inset_3px_0_0_var(--hunter)]",
              t.tone === "fugitive" && "shadow-[inset_3px_0_0_var(--fugitive)]",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast hors ToastProvider");
  return ctx;
}
