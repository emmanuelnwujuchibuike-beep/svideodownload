"use client";

import { Search } from "lucide-react";

/**
 * The VISIBLE way into the Command Center.
 *
 * ⌘K is invisible: it helps people who already know the app and does nothing for a
 * phone, which is most of this audience. A keyboard shortcut is an accelerator, not
 * a discovery mechanism, so search needs a control you can actually see and tap.
 *
 * Dispatches a window event rather than taking an `onOpen` prop, so any surface can
 * drop this in without threading a setter down through the shell. The palette
 * listens for the same event (`command-center-mount.tsx`).
 */
function openCommandCenter() {
  window.dispatchEvent(new Event("frenz:command-center"));
}

/**
 * Full search field appearance — for headers and page bodies with room.
 *
 * Deliberately a <button> that LOOKS like an input, not a real input. A real one
 * would need its own state, its own results list and its own keyboard handling —
 * a second search implementation to keep in sync with the palette. This opens the
 * one that already exists, and is announced to assistive tech as the button it is.
 */
export function SearchTrigger({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandCenter}
      className={`group flex h-10 items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-3 text-left text-sm text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground ${className}`}
    >
      <Search className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">Search Frenz…</span>
      {/* Shown only where a keyboard exists; pure decoration, hidden from SR. */}
      <kbd
        aria-hidden
        className="hidden shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-sans text-[10px] font-medium text-muted-foreground lg:inline-block"
      >
        ⌘K
      </kbd>
    </button>
  );
}

/** Icon-only variant, for tight bars (mobile header). */
export function SearchTriggerIcon({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandCenter}
      aria-label="Search Frenz"
      className={`inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      <Search className="h-5 w-5" />
    </button>
  );
}
