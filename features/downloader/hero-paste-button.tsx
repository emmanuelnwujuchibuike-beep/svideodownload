"use client";

import { ClipboardPaste } from "lucide-react";

/**
 * "Paste" for the landing hero's CTA field (owner, 2026-08-09: "input a paste
 * button close to the download button").
 *
 * ── Why it drives the input by id instead of owning it ────────────────────────
 * The hero CTA is deliberately a plain server-rendered `<form>` with no React
 * state — that is the whole reason the button→field transform costs zero
 * JavaScript and cannot stutter on a cheap phone. Lifting the field into a
 * controlled component to give it a Paste button would undo that, on the one
 * page with no bytes to spare.
 *
 * So this stays the smallest possible island: it finds the input by id, sets its
 * value, and gets out of the way. The CSS that keeps the field open once it has
 * content keys off `:placeholder-shown`, which reflects a scripted value change
 * the same as a typed one, so the transform behaves identically either way.
 *
 * ── 🔴 Why `onPointerDown` calls preventDefault ───────────────────────────────
 * Owner, 2026-08-09: "the paste doesn't work, it just closes the placeholder."
 * Exactly right, and the cause is a chain, not a typo:
 *
 *   1. pressing this button BLURS the input;
 *   2. the field is held open by `:focus-within`, so it starts collapsing;
 *   3. collapsing restores `pointer-events` on the `<label>` face, which is
 *      absolutely positioned OVER this button;
 *   4. by the time `click` resolves a target, the finger is on the label —
 *      so the tap focused the input again instead of ever reaching Paste.
 *
 * The paste never ran. What the owner saw was the field flickering shut and
 * back. Preventing the default action of `pointerdown` stops step 1, and
 * without the blur the other three cannot happen. Per the Pointer Events spec
 * this suppresses focus and the compatibility mouse events while still firing
 * `click`, which is the same technique component libraries use to keep a
 * text field focused while a toolbar button is pressed.
 *
 * `focus()` at the TOP of the handler is the belt to that braces: it runs
 * inside the user gesture (so iOS keeps the keyboard) and restores
 * `:focus-within` in the same frame on any browser that ignores the above.
 *
 * ── When the clipboard says no ────────────────────────────────────────────────
 * `readText()` is denied outright on Firefox and on any page the browser doesn't
 * consider to have user intent. Rather than showing an error for something the
 * visitor can trivially do themselves, the field is left focused so their own
 * paste gesture lands in the right place — a failed read still leaves them one
 * step from done, with the field open rather than shut.
 */
export function HeroPasteButton({ targetId }: { targetId: string }) {
  const paste = () => {
    const input = document.getElementById(targetId);
    if (!(input instanceof HTMLInputElement)) return;
    // Synchronous, before any await: keeps the transform open and, on iOS,
    // keeps the keyboard — a focus() after an await is outside the gesture.
    input.focus();

    navigator.clipboard
      ?.readText()
      .then((raw) => {
        const text = raw.trim();
        if (!text) return;
        input.value = text;
        // What the form submits and what `:placeholder-shown` reports both read
        // the live value, so this alone keeps the field open even once focus
        // eventually moves on. The event is for anything else listening.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.setSelectionRange(text.length, text.length);
      })
      .catch(() => {
        /* blocked (Firefox, or no permission) — the field is focused and open,
           so the visitor's own paste gesture lands in the right place */
      });
  };

  return (
    <button
      type="button"
      // See the note above — this one line is the fix.
      onPointerDown={(e) => e.preventDefault()}
      onClick={paste}
      aria-label="Paste a link from your clipboard"
      className="frenz-cta-paste inline-flex h-14 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-bold text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/25 active:scale-[0.98] sm:px-4"
    >
      <ClipboardPaste className="h-5 w-5" />
      <span className="hidden sm:inline">Paste</span>
    </button>
  );
}
