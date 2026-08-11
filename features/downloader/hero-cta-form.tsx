"use client";

import { ArrowRight, Download, Loader2 } from "lucide-react";
import { useSyncExternalStore } from "react";

import { HeroPasteButton } from "@/features/downloader/hero-paste-button";
import {
  getHeroFetching,
  getServerHeroFetching,
  setHeroLink,
  subscribeHeroFetching,
} from "@/features/downloader/hero-link-store";

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
  // Published by `Downloader` while it extracts — see the note on the button.
  const fetching = useSyncExternalStore(
    subscribeHeroFetching,
    getHeroFetching,
    getServerHeroFetching,
  );
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
      /*
        `isolate` and a floor on the height.

        `isolate` gives the form its own stacking context, so the face — which
        is `absolute inset-0 z-10` — can never paint against anything outside
        this form, whatever z-index its neighbours acquire later.

        `min-h-[4.25rem]` is the height the in-flow children already produce
        (h-14 + p-1.5). Stating it means the form cannot collapse to the size of
        its absolutely-positioned label if those children are ever hidden — the
        one shape that would put the download tile up where the eyebrow badge
        is, which is what the owner's screenshot shows.
      */
      /*
        🔴 SQUARE corners, no shadow, and the ramp stops at PURPLE (owner,
        2026-08-11, from `public/newnativeapplandingpage.jpg`).

        • `rounded-none`: the card above this form is `overflow-hidden` with the
          radius, so the bar is clipped to the CARD's corners. Its own radius
          would show as a second, smaller curve inside the first.
        • No `shadow-violet-600/30`: the bar is flush inside the card now, so a
          drop shadow had nothing to cast onto but the card's own white — it
          just muddied the seam. The card carries the elevation.
        • `to-purple-600`, not `to-fuchsia-600`: the old ramp turned magenta
          across its right third. The reference stays in the blue→violet family
          the rest of the brand uses and never reaches pink.

        `min-h-[4.75rem]` matches the reference's bar height (~78px), up from
        4.25rem — the taller bar is most of what makes it read as a native app
        row rather than a web button.
      */
      className="frenz-cta group relative isolate flex min-h-[4.75rem] w-full items-center gap-2 overflow-hidden rounded-none bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 p-1.5 transition duration-200"
    >
      <span
        aria-hidden
        className="frenz-cta-sheen pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 [transition-timing-function:var(--ease-out)] group-hover:translate-x-full"
      />

      {/* The face. A real <label>, so tapping it focuses the input with no
          script — and screen readers announce the field it names. */}
      <label
        htmlFor="hero-url"
        className="frenz-cta-face absolute inset-0 z-10 flex cursor-text items-center gap-3.5 px-4 text-left text-white sm:gap-4"
      >
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-inset ring-white/25">
          <Download className="h-[22px] w-[22px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-bold leading-tight">Start Free Download</span>
          <span className="mt-1 block text-[13px] text-white/85">100% Free</span>
        </span>
        {/*
          🔴 The arrow sits in a CIRCLE (owner, 2026-08-11 — the reference).

          It was a bare glyph floating at the right edge, which read as a chevron
          decoration rather than as the thing you tap. The reference draws a
          translucent disc around it, and that is what makes the row look like a
          native list item with a trailing action.

          `aria-hidden` on the whole disc: the label it sits in already says
          "Start Free Download", and the submit control beneath carries its own
          name. An "arrow right" announcement here would be a third voice for one
          action.
        */}
        <span
          aria-hidden
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/25"
        >
          <ArrowRight className="h-[18px] w-[18px]" />
        </span>
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
      {/*
        🔴 `aria-label` — this button had NO accessible name on a phone (axe,
        2026-08-10: `button-name`, CRITICAL, and the only critical finding on the
        landing page).

        The name was doing a disappearing act nobody would spot by reading the
        markup: the word "Download" is in a `hidden sm:inline` span, so at every
        width below 640px it is `display: none` — and `display: none` text is
        removed from the accessibility tree, not merely hidden visually. What
        was left is a lucide glyph, which renders a bare `<svg>` with no role and
        no title and contributes nothing. So the primary submit control on the
        site's front door announced itself as "button" to a screen reader, on
        the exact form factor most visitors use.

        The label matches the visible text at `sm` and up, which is what SC 2.5.3
        (Label in Name) requires — a voice-control user saying "click Download"
        must hit the thing that reads "Download".
      */}
      {/*
        🔴 THE BUTTON *IS* THE FETCHING STATE (owner, 2026-08-11: "i want the
        placeholder button to turn to the fetching button section and not
        opening a new fetching section below … it should change back to the
        download placeholder immediately fetch is complete").

        The extraction runs in `Downloader`, mounted several rows below, so its
        progress used to open a card down there. A card appearing somewhere else
        reads as a second thing happening rather than as this action continuing —
        which is exactly why people pressed Download twice.

        `fetching` comes from the shared hero store, so the button knows without
        either component owning the other. It reverts the instant `status` leaves
        "fetching", because the flag is published from an effect on that status
        rather than on a timer.

        Disabled while busy: a second submit would start a second extraction of
        the same link, which was the original complaint behind the loud card.
        `aria-live` is deliberately NOT here — the disabled state and the label
        change are announced by the button itself, and a live region on a control
        would interrupt a screen reader mid-sentence.
      */}
      <button
        type="submit"
        disabled={fetching}
        aria-label={fetching ? "Fetching your link" : "Download"}
        className="frenz-cta-go inline-flex h-14 shrink-0 items-center gap-2 rounded-xl bg-white/20 px-3.5 text-sm font-bold text-white ring-1 ring-inset ring-white/30 transition hover:bg-white/30 active:scale-[0.98] disabled:cursor-wait disabled:opacity-90 disabled:active:scale-100 sm:px-5 sm:text-base"
      >
        {fetching ? (
          <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
        ) : (
          <Download aria-hidden className="h-5 w-5" />
        )}
        <span className="hidden sm:inline">{fetching ? "Fetching…" : "Download"}</span>
      </button>
    </form>
  );
}
