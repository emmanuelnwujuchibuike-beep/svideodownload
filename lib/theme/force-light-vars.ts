import type { CSSProperties } from "react";

/**
 * Forces every design-token CSS custom property to its LIGHT-theme value for
 * one subtree, regardless of the app's actual dark/light mode — the correct,
 * general fix for "messages should be white like WhatsApp, not theme-
 * reactive." Values copied verbatim from app/globals.css's `:root` block.
 *
 * Why not just `bg-white` on the container: that only fixes the BACKGROUND.
 * Every descendant still uses `text-foreground`/`text-muted-foreground`/
 * `bg-secondary`/`border-border`/etc., which are DARK-MODE-REACTIVE — in
 * actual dark mode those resolve to near-white text/borders, which read as
 * invisible or near-invisible against a forced-white background (a real bug
 * reported 2026-07-14: "display bug when i switch to dark theme in
 * messages, there is a conflict"). Overriding the CSS variables themselves
 * means every Tailwind utility class that already references them (dozens
 * of call sites across conversation-list.tsx/thread-header.tsx/
 * conversation-room.tsx) renders correctly automatically, without hunting
 * down and hand-fixing each one individually — the same class of miss that
 * caused this bug in the first place.
 *
 * Plain object (not a hook/component) so it works from both Server
 * Components (messages/page.tsx, messages/layout.tsx) and Client Components
 * alike — just spread onto a `style` prop.
 */
export const FORCE_LIGHT_VARS: CSSProperties = {
  colorScheme: "light",
  // `color` is an INHERITED CSS property — `body`'s own `text-foreground`
  // (globals.css) already resolves `--foreground` to a computed color value
  // AT THE BODY ELEMENT, using dark mode's value. A descendant with no color
  // class of its own (e.g. a bare `<h1>`) inherits that ALREADY-RESOLVED
  // value, not a live reference to the variable — so overriding the custom
  // properties alone (below) never reaches it. Real bug found 2026-07-14: the
  // mobile "Messages" title + conversation-row names looked correct in the
  // fix's own testing (they all happen to carry an explicit `text-foreground`
  // class) but the page TITLE itself doesn't, and stayed near-invisible
  // light-on-white in dark mode. Setting `color` explicitly here, on the
  // wrapper itself, gives every descendant — classed or not — something
  // real to inherit.
  color: "hsl(240 10% 8%)",
  ["--background" as string]: "0 0% 100%",
  ["--foreground" as string]: "240 10% 8%",
  ["--card" as string]: "0 0% 100%",
  ["--card-foreground" as string]: "240 10% 8%",
  ["--primary" as string]: "210 100% 50%",
  ["--primary-foreground" as string]: "0 0% 100%",
  ["--secondary" as string]: "240 5% 95%",
  ["--secondary-foreground" as string]: "240 10% 8%",
  ["--muted" as string]: "240 5% 95%",
  ["--muted-foreground" as string]: "240 5% 34%",
  ["--accent" as string]: "250 100% 65%",
  ["--accent-foreground" as string]: "0 0% 100%",
  ["--border" as string]: "240 5% 88%",
  ["--input" as string]: "240 5% 88%",
  ["--ring" as string]: "250 100% 63%",
};
