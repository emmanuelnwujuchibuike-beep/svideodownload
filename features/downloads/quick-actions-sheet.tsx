"use client";

import { ArrowUpRight, X, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { QUICK_ACTIONS } from "./quick-actions";

/**
 * The Quick actions sheet — what the hero's glass button opens (owner,
 * 2026-09-20: "open the quick action card in the Download page but upgrade
 * the quick action card to look more professional and world class design and
 * animation style when opening without breaking performance on small
 * devices").
 *
 * ── Fetched on the first tap, never in the first load ────────────────────
 * This module is only ever reached through `next/dynamic` from the button, so
 * none of it is in the landing page's hydration budget.
 *
 * ── The shape ────────────────────────────────────────────────────────────
 * A bottom sheet on a phone (thumb reach), a centred dialog from `sm:` up.
 * One portal into <body> — the standing fixed-overlay law: a `fixed` node
 * under a transformed/blurred ancestor is clipped, so it never lives inside
 * the hero.
 *
 * ── Motion that a small device can afford ────────────────────────────────
 * Transform and opacity only: the backdrop fades, the panel rises (or scales
 * on desktop), and the four cards fade up in a 60ms stagger. No
 * `backdrop-filter` on the scrim — on a mid-range phone a full-screen blur is
 * the single most expensive thing a sheet can do, and it is not what makes
 * this feel premium; the depth comes from the panel's own shadow and the
 * cards' gradient tiles. The hover glow behind a card is `hidden sm:block`,
 * so a phone never paints it. `motion-safe:` on every entrance, so reduced
 * motion gets the sheet with no choreography.
 *
 * ── Body scroll lock ─────────────────────────────────────────────────────
 * `overflowY` only, never the `overflow` shorthand (lib/dom/scroll-lock.ts) —
 * the same convention every other sheet uses.
 */
export function QuickActionsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Kept mounted through the closing animation, then dropped.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 280);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className={open ? "" : "pointer-events-none"}>
      <button
        type="button"
        aria-label="Close quick actions"
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-[70] cursor-default bg-slate-950/45 transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-actions-title"
        className={cn(
          // phone: a sheet from the bottom
          "fixed inset-x-0 bottom-0 z-[80] flex max-h-[88vh] flex-col overflow-hidden rounded-t-[1.75rem] bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_48px_-12px_rgba(15,23,42,0.45)] ring-1 ring-border/60",
          "transition-[transform,opacity] duration-300 [transition-timing-function:var(--ease-out)]",
          // desktop: a centred card
          "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[min(92vw,30rem)] sm:rounded-[1.75rem] sm:pb-0 sm:shadow-[0_32px_80px_-24px_rgba(15,23,42,0.55)]",
          shown ? "translate-y-0 opacity-100 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:scale-100" : "translate-y-full opacity-0 sm:-translate-x-1/2 sm:-translate-y-[46%] sm:scale-[0.96]",
        )}
      >
        {/* the grab handle, phone only */}
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border sm:hidden" />

        {/* a soft top wash so the header reads as a surface, not a strip */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-violet-500/[0.08] via-blue-500/[0.04] to-transparent dark:from-violet-400/[0.12] dark:via-blue-400/[0.05]" />

        <header className="relative flex items-start gap-3 px-5 pt-4 sm:pt-5">
          <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 text-white shadow-lg shadow-violet-500/30">
            <span aria-hidden className="absolute inset-0 rounded-2xl bg-white/20 [mask-image:linear-gradient(to_bottom,white,transparent)]" />
            <Zap className="relative h-5 w-5" fill="currentColor" strokeWidth={1.5} aria-hidden />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="quick-actions-title" className="text-base font-extrabold tracking-tight">
              Quick actions
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Jump straight to what you use most.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <X className="h-[18px] w-[18px]" aria-hidden />
          </button>
        </header>

        <ul className="relative grid grid-cols-2 gap-3 overflow-y-auto px-5 pb-5 pt-4 sm:pb-6">
          {QUICK_ACTIONS.map((a, i) => (
            <li
              key={a.id}
              className={cn("min-w-0", shown && "motion-safe:animate-fade-up")}
              style={shown ? { animationDelay: `${60 + i * 60}ms` } : undefined}
            >
              <Link
                href={a.href}
                prefetch
                onClick={onClose}
                className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-2xl border border-border/60 bg-background/60 p-3.5 transition-[transform,box-shadow,border-color] duration-200 [transition-timing-function:var(--ease-out)] hover:-translate-y-0.5 hover:border-transparent hover:shadow-[0_16px_32px_-16px_rgba(15,23,42,0.35)] active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 dark:bg-white/[0.04]"
              >
                {/* the hover glow — desktop only, so a phone never paints a blur */}
                <span aria-hidden className={cn("absolute -right-8 -top-8 hidden h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100 sm:block", a.glow)} />
                <span className="flex items-start justify-between">
                  <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg transition-transform duration-300 [transition-timing-function:var(--ease-out)] group-hover:scale-105", a.tile)}>
                    <a.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground/70 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{a.title}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{a.sub}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
