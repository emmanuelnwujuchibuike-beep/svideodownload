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
 * ── When the clipboard says no ────────────────────────────────────────────────
 * `readText()` is denied outright on Firefox and on any page the browser doesn't
 * consider to have user intent. Rather than showing an error for something the
 * visitor can trivially do themselves, it focuses the field so their own paste
 * gesture lands in the right place — a failed read still leaves them one step
 * from done.
 */
export function HeroPasteButton({ targetId }: { targetId: string }) {
  const paste = async () => {
    const input = document.getElementById(targetId);
    if (!(input instanceof HTMLInputElement)) return;
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        input.value = text;
        // Native setters are what a form and the CSS both observe; dispatching
        // `input` keeps anything listening (validation, autofill) in step.
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    } catch {
      /* clipboard blocked — the focus below is the fallback */
    }
    input.focus();
  };

  return (
    <button
      type="button"
      onClick={() => void paste()}
      aria-label="Paste a link from your clipboard"
      className="frenz-cta-paste inline-flex h-14 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-bold text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/25 active:scale-[0.98] sm:px-4"
    >
      <ClipboardPaste className="h-5 w-5" />
      <span className="hidden sm:inline">Paste</span>
    </button>
  );
}
