"use client";

import { Download } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { getInstallState, getServerInstallState, subscribeInstall } from "@/lib/pwa/install-store";
import { isStandalone } from "@/lib/pwa/platform";
import { cn } from "@/lib/utils";

/**
 * The Install entry point — a compact pill in the site header, and a secondary
 * card below the hero on narrow screens.
 *
 * ── What this costs the landing page ──────────────────────────────────────────
 * This file, `lib/pwa/install-store.ts` and `isStandalone()` are the ONLY things
 * the install feature adds to `/(marketing)/page`'s first load. The engine (the
 * browser matrix, the per-browser copy) and the modal are behind the
 * `next/dynamic` boundary below and are fetched on the first tap, so a visitor
 * who never installs downloads none of it. `Download` is reused from lucide
 * because the landing's bundle already carries that glyph (floating-progress),
 * so the icon costs nothing new either.
 *
 * ── Why it renders nothing until mounted ──────────────────────────────────────
 * Whether to show this at all depends on `display-mode: standalone`, which only
 * exists in the browser. Rendering a button on the server and removing it on
 * hydration is a layout shift in the header — the exact CLS regression the
 * budget notes in lib/perf/budget.test.ts were written about. So the slot is
 * empty in the HTML and the button appears on mount, inside a fixed-size box on
 * the header path so nothing around it moves when it does.
 */

const InstallModal = dynamic(() => import("@/features/pwa/install-modal").then((m) => m.InstallModal), {
  ssr: false,
});

/** Shared visibility rule: never offer to install an app that is already
 *  installed, and never in a standalone window. */
function useInstallVisible(): boolean {
  const state = useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    // One read, on mount. No polling, no media-query listener: a page does not
    // transition into standalone mode without a fresh document.
    setStandalone(isStandalone());
  }, []);

  return !standalone && !state.installed;
}

export function InstallButton({ className }: { className?: string }) {
  const visible = useInstallVisible();
  const [open, setOpen] = useState(false);
  const onOpen = useCallback(() => setOpen(true), []);

  if (!visible) return null;

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className={cn(
          "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.97]",
          className,
        )}
      >
        <Download className="h-4 w-4" aria-hidden />
        Install
      </button>
      {open ? <InstallModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HEADER INSTALL GROUP — the landing's primary placement (2026-08-25)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: *"i think the install CTA in the landing hero is causing visual noise
 * … remove the frenz [text] from the top header landing page, and the search
 * icon button so there will be space for the install section and button but in
 * a premium and professional way, no description, just Install Frenz and the
 * install button and ICON in the top header, it should [not] look too
 * compressed, there should still be space."*
 *
 * So the call to action MOVES rather than being duplicated: the hero banner is
 * gone from the landing (`DownloadPageCore installBanner={false}`) and this
 * takes its place. The header earns the room by giving up two things the owner
 * named — the "Frenz" wordmark text and the search trigger.
 *
 * ── The three parts, and nothing else ────────────────────────────────────────
 * Icon, label, button. The hero banner's second line ("Get the full Frenz
 * experience on your home screen") is deliberately dropped: a description in a
 * 64px-tall bar is what makes a header feel cramped, and it was the noise being
 * complained about.
 *
 * ── 🔴 FIRST PAINT, HIDDEN BY CSS — NOT MOUNT-GATED ──────────────────────────
 * `InstallButton` above waits for mount before rendering, which is right for a
 * standalone pill in a fixed-size slot. It is WRONG here: this group is wide,
 * and appearing after hydration would reflow the whole header row on the one
 * page carrying a CLS budget — precisely the regression the hero banner was
 * built to avoid.
 *
 * So it renders in the server HTML and the installed case is removed by CSS
 * (`.hide-when-installed`, a `display-mode: standalone` media query in
 * globals.css). Same fail-closed trick as `InstallHeroBanner` and
 * `public/launch.html`: a visitor who already installed sees it vanish before
 * first paint, with no JavaScript involved and no shift either way.
 *
 * ── Spacing is the "premium" instruction, literally ──────────────────────────
 * `gap-2.5` inside the group and `pl-1 pr-1` around it, rather than packing the
 * three parts flush. "There should still be space" is a spacing brief, and the
 * cheapest way to make a control look expensive is to give it room.
 */
export function InstallHeaderCta({ className }: { className?: string }) {
  const state = useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
  const [open, setOpen] = useState(false);

  if (state.installed) return null;

  return (
    <>
      <div
        className={cn(
          "hide-when-installed flex shrink-0 items-center gap-2.5 rounded-2xl px-1",
          className,
        )}
      >
        {/* The ICON the owner asked for, on the brand gradient — the one piece
            of colour in an otherwise quiet bar, so the eye lands on it. */}
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25">
          <Download className="h-[18px] w-[18px]" aria-hidden />
        </span>
        {/* Hidden below `sm`, where the button alone has to carry it — a phone
            header cannot hold a label AND a button AND the account cluster
            without becoming the cramped bar this change exists to fix. */}
        <span className="hidden whitespace-nowrap text-sm font-bold leading-none text-foreground sm:block">
          Install Frenz
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="inline-flex h-9 shrink-0 items-center rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.97]"
        >
          Install
        </button>
      </div>
      {open ? <InstallModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The hero banner — the primary, unmissable placement (owner, 2026-08-23:
 * "professionally organised to be well visible at the top of the hero, just
 * below the top header").
 *
 * ── Why this one does NOT use `useInstallVisible()` ───────────────────────────
 * Every other placement waits for mount before deciding whether to show. Here
 * that would be a measured regression: this sits directly above the H1, which
 * the cold-start audit identified as the landing's LCP neighbourhood, so a
 * banner that appears after hydration would push it down and register as CLS on
 * the one page carrying a CLS budget.
 *
 * So it renders in the FIRST paint and the installed case is removed by CSS
 * (`.hide-when-installed`, a `display-mode` media query in globals.css) — the
 * same fail-closed trick `public/launch.html` uses for its loader. Nothing
 * moves, and an installed user never sees it.
 *
 * `installed` is still honoured, because that transition happens in response to
 * the person's own tap — a banner disappearing right after you install from it
 * is feedback, not shift.
 */
export function InstallHeroBanner() {
  const state = useSyncExternalStore(subscribeInstall, getInstallState, getServerInstallState);
  const [open, setOpen] = useState(false);

  if (state.installed) return null;

  return (
    <>
      <div className="hide-when-installed mt-3 flex items-center gap-3 rounded-2xl border border-slate-900/[0.06] bg-white px-3.5 py-3 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.16)] dark:border-white/10 dark:bg-white/[0.04]">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/25">
          <Download className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold leading-tight text-slate-900 dark:text-white">
            Install Frenz on your device
          </span>
          <span className="mt-0.5 block text-xs leading-snug text-slate-500 dark:text-white/60">
            Get the full Frenz experience on your home screen.
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.97]"
        >
          Install
        </button>
      </div>
      {open ? <InstallModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The secondary placement: a full-width card inside the mobile menu drawer.
 *
 * ── Why the drawer and not the mobile header ──────────────────────────────────
 * The mobile header already carries search, language, account and the menu
 * toggle. At 320px the logo plus those four controls plus their gaps already
 * fill the row, so a fifth control — even an icon-sized one — overflows it, and
 * the signed-out account slot renders a "Log in" button that is wider still.
 * The brief is explicit that the header must never overflow and that the
 * fallback is a secondary placement rather than shrinking everything, so the
 * pill is desktop-only (it lives in the `lg:flex` cluster) and phones get this.
 *
 * That also keeps the two mutually exclusive by construction rather than by
 * breakpoint arithmetic: the drawer only exists below `lg`, the pill only above
 * it, so nobody ever sees the same call to action twice.
 */
export function InstallCta() {
  const visible = useInstallVisible();
  const [open, setOpen] = useState(false);

  if (!visible) return null;

  return (
    <>
      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-card px-3.5 py-3 shadow-soft">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
          <Download className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold leading-tight">Install Frenz on your device</span>
          <span className="block text-[11px] leading-tight text-muted-foreground">
            Get the full Frenz experience on your home screen.
          </span>
        </span>
        {/*
          Deliberately does NOT close the menu drawer first.

          The sheet is rendered by this component, which lives inside the
          drawer — so dismissing the drawer unmounts its own subtree and takes
          the sheet with it. Tapping Install would open nothing.

          Stacking is safe: the sheet is `z-[120]` against the drawer's
          `z-[70]`, its Escape handler is registered on `document` in the
          CAPTURE phase and stops propagation, so it closes before the drawer's
          bubble-phase listener ever sees the key. Closing it returns the person
          to the menu they opened it from, which is where they were.
        */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          className="shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-md shadow-violet-500/25 transition active:scale-[0.97]"
        >
          Install
        </button>
      </div>
      {open ? <InstallModal onClose={() => setOpen(false)} /> : null}
    </>
  );
}
