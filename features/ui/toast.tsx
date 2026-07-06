"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

export type ToastType = "info" | "success" | "error" | "loading";
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  toasts = [...toasts];
  for (const l of listeners) l();
};

/** Show a toast. Returns its id so a "loading" toast can be resolved later. */
export function toast(
  message: string,
  type: ToastType = "info",
  opts?: { id?: string; duration?: number; action?: ToastAction },
): string {
  const id = opts?.id ?? crypto.randomUUID();
  const existing = toasts.findIndex((t) => t.id === id);
  const next: Toast = { id, message, type, action: opts?.action };
  if (existing >= 0) toasts[existing] = next;
  else toasts = [...toasts, next];
  emit();
  const duration = opts?.duration ?? (type === "loading" ? 0 : 3800);
  if (duration > 0) setTimeout(() => dismissToast(id), duration);
  return id;
}
export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const ICON = { info: Info, success: CheckCircle2, error: AlertCircle, loading: Loader2 } as const;
const TINT = {
  info: "text-blue-500",
  success: "text-emerald-500",
  error: "text-rose-500",
  loading: "text-primary",
} as const;

/** Mounted once in the app shell. */
export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => toasts,
    () => toasts,
  );

  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[100] flex w-[min(92vw,22rem)] flex-col gap-2 lg:bottom-4">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = ICON[t.type];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24 }}
              className="pointer-events-auto flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3.5 text-sm shadow-elevated"
            >
              <Icon className={cn("h-5 w-5 shrink-0", TINT[t.type], t.type === "loading" && "animate-spin")} />
              <span className="min-w-0 flex-1 font-medium text-foreground">{t.message}</span>
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    dismissToast(t.id);
                    t.action!.onClick();
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-primary transition hover:bg-secondary"
                >
                  {t.action.label}
                </button>
              ) : null}
              <button type="button" onClick={() => dismissToast(t.id)} aria-label="Dismiss" className="shrink-0 text-muted-foreground transition hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
