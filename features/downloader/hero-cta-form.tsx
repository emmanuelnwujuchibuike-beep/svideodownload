"use client";

import { ArrowRight, ClipboardPaste, Loader2, X } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

import {
  getHeroFetching,
  getServerHeroFetching,
  setHeroLink,
  subscribeHeroFetching,
} from "@/features/downloader/hero-link-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE HERO CTA — rebuilt to the Download page's own structure
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner (2026-08-16): "the placeholder and Download button should be direct…
 * the place holder and button should be same structure with the Download
 * page" — then, correcting an earlier reading of this same brief: "i never
 * said keep landing's own colour, i said use the white and theme with the
 * download page, so they both feel native all over the body."
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * This used to be a zero-JavaScript "button that becomes a field": a `<label>`
 * painted like a button sat over a hidden input, and `:focus-within` plus a
 * `:not(:placeholder-shown)` CSS rule swapped one for the other so the whole
 * transform ran on the compositor with no React state at all. It was clever
 * and it was hard-won — three separate owner bug reports (a blur-on-tap, a
 * clipboard permission prompt stealing focus, a silent paste failure) went
 * into tuning it. None of that survives here, on purpose: "direct" means the
 * input and the button are both on screen from the first paint, exactly like
 * `DownloadBox` on /downloads, not a button that reveals one. The old
 * mechanism (`.frenz-cta*` in globals.css, `hero-paste-button.tsx`) is
 * removed as dead code rather than left behind unused.
 *
 * ── Byte-for-byte the same recipe as `features/downloads/download-box.tsx`
 *    (`surface="card"`) ──────────────────────────────────────────────────────
 *
 * The gradient wrapper (`from-blue-500 via-violet-500 to-purple-500`, `p-0.5`,
 * wrapping a plain `bg-white`/`bg-background` input), the inline Paste/Clear
 * buttons, and the flat two-stop `from-blue-600 to-violet-600` submit button
 * are the SAME classes Download uses, not a landing-flavoured reinterpretation
 * of them — that is what "same structure… use the white and theme with the
 * download page" means: one visual language for both, not two that merely
 * resemble each other.
 *
 * ── Why this is still a small, deliberate island ────────────────────────────
 *
 * The landing page sits at its own strict cold-entry JS budget. A single
 * controlled `<input>` plus a Paste/Clear pair is a tiny, bounded amount of
 * state — nowhere near pulling in `DownloadBox` itself (which carries
 * history, quota gates and a Discovery Gateway import that page needs and
 * this one must not pay for). The submit path still goes through the shared
 * `hero-link-store` used elsewhere on this page, so "no page reload, the
 * result appears below" is unchanged.
 *
 * The `<form action="/" method="get">` fallback is unchanged too: with
 * JavaScript off, this renders as an ordinary named `<input name="paste">`
 * inside a real form, so submitting still navigates to `?paste=…` and still
 * works — the enhancement removes a page load, it is not what makes the
 * feature function.
 */
export function HeroCtaForm() {
  const fetching = useSyncExternalStore(subscribeHeroFetching, getHeroFetching, getServerHeroFetching);
  const [url, setUrl] = useState("");
  const [blocked, setBlocked] = useState(false);

  const paste = async () => {
    setBlocked(false);
    try {
      const text = (await navigator.clipboard?.readText?.())?.trim();
      if (!text) {
        setBlocked(true);
        return;
      }
      setUrl(text);
    } catch {
      // Denied, dismissed, or unsupported (Firefox has no readText() at all) —
      // the field is empty and focused either way, so the visitor's own paste
      // gesture still lands in the right place.
      setBlocked(true);
    }
  };

  return (
    <form
      action="/"
      method="get"
      onSubmit={(e) => {
        const value = url.trim();
        if (!value) return;
        e.preventDefault();
        setHeroLink(value);
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <div className="relative flex-1 rounded-[0.9rem] bg-gradient-to-r from-blue-500 via-violet-500 to-purple-500 p-0.5 transition focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 focus-within:ring-offset-transparent">
        <input
          id="hero-url"
          name="paste"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setBlocked(false);
          }}
          placeholder="Paste any link here (TikTok, Instagram, X, Facebook…)"
          aria-label="Paste a link to download"
          // Same keyboard-avoidance as before: bring the field into view once
          // the on-screen keyboard has actually resized the layout viewport.
          onFocus={(e) => {
            const el = e.currentTarget;
            setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 320);
          }}
          className="h-[3.25rem] w-full rounded-[0.7rem] border-0 bg-white px-4 pr-24 text-[15px] text-slate-900 outline-none placeholder:text-slate-400 dark:bg-white/95 sm:text-base"
        />
        <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {url ? (
            <button
              type="button"
              onClick={() => setUrl("")}
              aria-label="Clear"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            // Stops the tap from blurring the field before the clipboard read
            // resolves — the same defence hero-paste-button.tsx used to carry.
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => void paste()}
            aria-label="Paste a link from your clipboard"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
          >
            <ClipboardPaste className="h-4 w-4" />
            <span className="hidden sm:inline">Paste</span>
          </button>
        </div>
        {blocked ? (
          <span
            aria-live="polite"
            className="pointer-events-none absolute inset-x-0 -bottom-6 z-10 text-center text-[11px] font-semibold text-red-500 dark:text-red-400"
          >
            Clipboard blocked — paste manually
          </span>
        ) : null}
      </div>

      {/*
        🔴 `aria-label` — the accessible-name defect this form was audited for
        (axe, 2026-08-10: `button-name`, CRITICAL) still applies to a text
        label that disappears at `sm` and below: "Download" is `hidden
        sm:inline`, and `display: none` text is removed from the accessibility
        tree, not merely hidden. The label matches the visible text at `sm`
        and up, satisfying SC 2.5.3 (Label in Name).
      */}
      <button
        type="submit"
        disabled={fetching}
        aria-label={fetching ? "Fetching your link" : "Download"}
        className="inline-flex h-14 shrink-0 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-7 text-base font-semibold text-white shadow-lg transition hover:opacity-95 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60"
      >
        {fetching ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" /> : <ArrowRight aria-hidden className="h-5 w-5" />}
        <span className="hidden sm:inline">{fetching ? "Fetching…" : "Download"}</span>
      </button>
    </form>
  );
}
