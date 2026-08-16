"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The Frenzsave-owned consent step shown BEFORE any ad is requested from
 * Google (owner, 2026-08-16 GPT spec, §6-7/§19): "Do not call the GPT
 * rewarded-ad visibility method before user consent." Chrome copied from the
 * established bottom-sheet pattern (`features/profile/profile-menu-bottom-sheet.tsx`)
 * rather than a new design language — rounded top, drag handle, safe-area
 * padding, portal to `<body>`.
 *
 * Deliberately generic (no "HD"/"preview" concept baked in) — the two reward
 * contexts (`use-reward-flow.ts`) pass their own copy through props, per
 * §6/§13's near-identical but distinct wording.
 *
 * Renders nothing once the GPT ad itself is showing — the orchestrator
 * unmounts/hides this the instant `makeRewardedVisible()` is called, so
 * nothing Frenzsave-owned ever sits over Google's ad UI (§18/§24).
 */
export function RewardConsentSheet({
  open,
  title,
  body,
  primaryLabel,
  secondaryLabel,
  onPrimary,
  onSecondary,
  busy = false,
  statusText,
  errorText,
}: {
  open: boolean;
  title: string;
  body: string;
  primaryLabel: string;
  secondaryLabel: string;
  onPrimary: () => void;
  onSecondary: () => void;
  /** Disables both buttons and shows a spinner on the primary — the ad is
   *  being requested but isn't visible yet. */
  busy?: boolean;
  /** Small line under the buttons while `busy` — e.g. "Loading…". */
  statusText?: string | null;
  /** A dead-end state (ad unavailable, or closed without a reward) — replaces
   *  `body` with an error-toned message; primary becomes a retry. */
  errorText?: string | null;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.body.style.overflowY = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSecondary();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onSecondary]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className={open ? "" : "pointer-events-none"}>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={busy ? undefined : onSecondary}
        disabled={busy}
        className={`fixed inset-0 z-[140] cursor-default bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`fixed inset-x-0 bottom-0 z-[150] flex max-h-[92vh] flex-col overflow-hidden rounded-t-[1.75rem] border-t border-border/60 bg-card pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] shadow-2xl transition-transform duration-300 [transition-timing-function:var(--ease-out)] ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />

        <div className="px-6 pb-2 pt-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles aria-hidden className="h-6 w-6" />
          </div>
          <h2 className="mt-3 text-lg font-bold tracking-tight">{title}</h2>
          <p className={`mt-1.5 text-sm leading-relaxed ${errorText ? "text-rose-500" : "text-muted-foreground"}`}>
            {errorText ?? body}
          </p>
        </div>

        <div className="px-6 pb-1 pt-3">
          <button
            type="button"
            onClick={onPrimary}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-500/25 transition active:scale-[0.98] disabled:opacity-70"
          >
            {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null}
            {primaryLabel}
          </button>
          {busy && statusText ? (
            <p className="mt-2 text-center text-xs text-muted-foreground">{statusText}</p>
          ) : null}
          <button
            type="button"
            onClick={onSecondary}
            disabled={busy}
            className="mt-2 flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold text-muted-foreground transition hover:bg-secondary disabled:opacity-50"
          >
            {secondaryLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
