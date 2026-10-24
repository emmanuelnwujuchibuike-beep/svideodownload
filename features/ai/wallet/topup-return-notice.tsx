"use client";

import { CheckCircle2, CircleAlert, Clock, Loader2, X } from "lucide-react";

import type { TopupReturnView } from "@/lib/ai/wallet/topup-return";
import { cn } from "@/lib/utils";

/**
 * The result of coming back from a credit top-up (Part 4): checking, credited, still confirming, not completed, or
 * couldn't check — each its own colour and icon, announced politely. "Check again" re-asks the server about the same
 * payment (it never pays again); it is disabled while a check runs, so taps can't pile up.
 */
export function TopupReturnNotice({ view, onRecheck, onDismiss, className }: { view: TopupReturnView | null; onRecheck: () => void; onDismiss: () => void; className?: string }) {
  if (!view) return null;
  const checking = view.state === "checking";
  const Icon = checking ? Loader2 : view.state === "credited" ? CheckCircle2 : view.state === "not_completed" ? CircleAlert : Clock;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-3 rounded-2xl border p-3.5 text-left",
        view.state === "credited" && "border-emerald-500/30 bg-emerald-500/10",
        (view.state === "pending" || view.state === "unconfirmed") && "border-amber-500/30 bg-amber-500/10",
        view.state === "not_completed" && "border-rose-500/30 bg-rose-500/10",
        checking && "border-primary/25 bg-primary/5",
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 h-5 w-5 shrink-0",
          checking && "animate-spin text-primary motion-reduce:animate-none",
          view.state === "credited" && "text-emerald-600 dark:text-emerald-400",
          (view.state === "pending" || view.state === "unconfirmed") && "text-amber-600 dark:text-amber-400",
          view.state === "not_completed" && "text-rose-600 dark:text-rose-400",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[14px] font-semibold">{view.title}</p>
        <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">{view.text}</p>
        {view.canRecheck ? (
          <button type="button" onClick={onRecheck} className="mt-2 inline-flex min-h-9 items-center rounded-full border border-border bg-background px-3.5 text-[13px] font-semibold transition hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98]">
            Check again
          </button>
        ) : null}
      </div>
      {!checking ? (
        <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-full p-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <X className="h-4 w-4" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
