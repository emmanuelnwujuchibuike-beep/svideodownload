"use client";

import { ArrowRight, Download } from "lucide-react";

import { HeroPasteButton } from "@/features/downloader/hero-paste-button";
import { setHeroLink } from "@/features/downloader/hero-link-store";

/**
 * The landing hero's primary CTA: a button that becomes a paste field.
 *
 * ── The transform is still pure CSS ───────────────────────────────────────────
 * No state, no class toggling, nothing re-rendering. The form is always in the
 * markup and a `<label>` painted like the button sits over it; tapping the label
 * focuses the input (native behaviour) and `:focus-within` swaps the two. Only
 * `opacity` and `transform` animate, so the whole thing runs on the compositor —
 * which is what makes it smooth on a cheap phone, and why it survived being
 * added to a page with no bytes to spare.
 *
 * This component exists solely to intercept the SUBMIT.
 *
 * ── Why submitting must not navigate (owner, 2026-08-09) ──────────────────────
 * "Clicking on the download button on the hero section shouldn't refresh and
 * animate the page like it's entering another page… it should show the review
 * instantly."
 *
 * It used to be a real GET to `/?paste=…`: a full navigation, a router
 * transition and the app's page-transition animation, all to arrive at the page
 * you were already on and show a panel three rows below the button. Now the link
 * goes into a small shared store and the result panel — mounted a few rows down,
 * under Wallpaper Gallery — picks it up and fetches immediately. Nothing moves,
 * nothing reloads.
 *
 * The `<form action="/" method="get">` is deliberately left intact underneath:
 * before hydration, and with JavaScript off entirely, submitting still navigates
 * to `?paste=` and still produces the same panel. The enhancement removes a page
 * load; it is not what makes the feature work.
 */
export function HeroCtaForm() {
  return (
    <form
      action="/"
      method="get"
      onSubmit={(e) => {
        const input = e.currentTarget.elements.namedItem("paste");
        const value = input instanceof HTMLInputElement ? input.value.trim() : "";
        // An empty field falls through to the browser's own required-field
        // handling rather than being silently swallowed.
        if (!value) return;
        e.preventDefault();
        setHeroLink(value);
      }}
      className="frenz-cta group relative flex w-full items-center gap-2 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 p-1.5 shadow-lg shadow-violet-600/30 transition duration-200 focus-within:shadow-xl focus-within:shadow-violet-600/40"
    >
      <span
        aria-hidden
        className="frenz-cta-sheen pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
      />

      {/* The face. A real <label>, so tapping it focuses the input with no
          script — and screen readers announce the field it names. */}
      <label
        htmlFor="hero-url"
        className="frenz-cta-face absolute inset-0 z-10 flex cursor-text items-center gap-4 px-4 text-left text-white"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-inset ring-white/25">
          <Download className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold leading-tight">Start Free Download</span>
          <span className="mt-0.5 block text-xs text-white/80">100% Free</span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0" />
      </label>

      <input
        id="hero-url"
        name="paste"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="Paste your link here"
        aria-label="Paste a link to download"
        /*
          Bring the field to the middle of what is left of the screen once the
          keyboard is up (owner: "the top header doesn't stay fixed when I open
          the placeholder… I want it fixed and the keyboard should push downward
          making space for the placeholder").

          The layout half is already handled app-wide by
          `interactiveWidget: "resizes-content"` in the root viewport, which
          shrinks the LAYOUT viewport so the fixed header stays pinned instead of
          drifting. Older iOS ignores that flag and pans the whole page instead,
          which is what puts the field under the keyboard — this covers it.

          The delay is not a guess at animation length: it waits for the resize
          to have happened, because scrolling before the viewport changes
          measures the pre-keyboard height and lands in the wrong place.
        */
        onFocus={(e) => {
          const el = e.currentTarget;
          setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
        }}
        className="frenz-cta-input h-14 min-w-0 flex-1 rounded-xl border-0 bg-white px-3.5 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:bg-white/95 sm:px-4 sm:text-base"
      />
      {/* Paste sits NEXT to Download (owner) — the two things you do here, side
          by side, so the link never has to be typed. */}
      <HeroPasteButton targetId="hero-url" />
      <button
        type="submit"
        className="frenz-cta-go inline-flex h-14 shrink-0 items-center gap-2 rounded-xl bg-white/20 px-3.5 text-sm font-bold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/30 active:scale-[0.98] sm:px-5 sm:text-base"
      >
        <Download className="h-5 w-5" />
        <span className="hidden sm:inline">Download</span>
      </button>
    </form>
  );
}
