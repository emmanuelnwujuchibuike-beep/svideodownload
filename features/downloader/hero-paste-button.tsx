"use client";

import { ClipboardPaste } from "lucide-react";
import { useState } from "react";

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
  /*
    ── 🔴 THIRD REPORT, AND THE REAL DEFECT IS THE SILENCE ───────────────────
    Owner, 2026-08-11: "nothing is pasted at all."

    Two previous fixes here were reasoned from the symptom and both addressed a
    real cause (the blur, then the permission prompt stealing focus). This is the
    third report, so the thing to fix is not another guess about WHY the read
    fails — it is that a failed read produced no signal whatsoever. The `catch`
    swallowed it, the button did nothing visible, and the only possible bug
    report was "it doesn't work", which is what arrived.

    So failure is now VISIBLE, and it tells the person what to do instead. Two
    genuine, unfixable-by-us causes exist and both end here:

      • Firefox does not expose `readText()` to web pages AT ALL — not a
        permission, not a prompt, it simply is not there.
      • iOS Safari raises a native Paste confirmation; dismissing it, or
        ignoring it, resolves as a rejection with nothing pasted.

    Neither is a bug we can remove, and in both the visitor is one long-press
    from done — so the honest response is to say so rather than to fail mutely.

    The ORDER also changed, and it is a real hypothesis rather than a
    certainty: `readText()` now runs FIRST, before `focus()` and before any DOM
    write. Safari ties clipboard permission to the user activation that started
    the gesture, and intervening work can spend it. The previous version focused
    the input first. If this report recurs, the hint below is what will make the
    next one diagnostic.
  */
  const [blocked, setBlocked] = useState(false);

  const paste = () => {
    const input = document.getElementById(targetId);
    if (!(input instanceof HTMLInputElement)) return;
    setBlocked(false);

    /*
      🔴 LATCH THE FIELD OPEN BEFORE ANYTHING ELSE (owner, 2026-08-10, reporting
      the same symptom a second time: "the paste link button on the placeholder
      now closes the placeholder instead of pasting the link").

      The first fix — `preventDefault` on pointerdown, below — is still correct
      and is still here. It stops the button press itself from blurring the
      input. What it cannot cover is the step AFTER that:

        `navigator.clipboard.readText()` is permission-gated. On iOS Safari it
        raises a NATIVE "Paste" confirmation, and on other browsers it can raise
        a permission prompt. While that UI is up, the page is no longer focused,
        so `:focus-within` goes false and the field collapses on its own. If the
        person then dismisses the prompt — or simply takes a moment — nothing
        was pasted, so `:not(:placeholder-shown)` does not hold it open either.

      Both of the CSS rules that keep the field open therefore depend on
      something outside our control: keeping focus, or already having a value.
      A paste attempt has neither at the moment it matters.

      So the open state stops being inferred and becomes a FACT we record.
      Tapping Paste is an unambiguous statement of intent — this person is
      entering a link — and the field now stays open until they say otherwise,
      whatever the clipboard, the permission prompt or the focus does in
      between. See `.frenz-cta[data-entering]` in globals.css.
    */
    /*
      🔴 The clipboard read is STARTED FIRST — before `focus()`, before the
      dataset write. Safari grants clipboard permission against the user
      activation that began this gesture, and DOM work in between can spend it.
      Only the promise is kicked off here; everything else happens after.
    */
    const read = navigator.clipboard?.readText?.();

    const form = input.closest<HTMLElement>(".frenz-cta");
    if (form) form.dataset.entering = "true";
    input.focus();

    if (!read) {
      // The API is not there at all (Firefox, or a non-secure context). Say so
      // rather than leaving the button looking broken.
      setBlocked(true);
      return;
    }

    read
      .then((raw) => {
        const text = raw.trim();
        if (!text) {
          // An EMPTY clipboard is its own case and used to be indistinguishable
          // from a blocked one — both did nothing. It gets the same hint,
          // because the remedy is the same: paste it yourself.
          setBlocked(true);
          return;
        }
        input.value = text;
        // What the form submits and what `:placeholder-shown` reports both read
        // the live value. The event is for anything else listening.
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.setSelectionRange(text.length, text.length);
      })
      .catch(() => {
        // Denied, dismissed, or unsupported. The field stays latched open so the
        // visitor's own paste gesture still lands in the right place — and now
        // they are TOLD that is what to do.
        setBlocked(true);
      })
      .finally(() => {
        /*
          Focus again once the permission UI has gone. Harmless when focus never
          left, and on iOS it is what puts the caret back in the field after the
          native Paste sheet closes.
        */
        input.focus();
      });
  };

  return (
    <>
      <button
        type="button"
        // See the note above — this one line stops the press blurring the input.
        onPointerDown={(e) => e.preventDefault()}
        onClick={paste}
        aria-label="Paste a link from your clipboard"
        className="frenz-cta-paste inline-flex h-14 shrink-0 items-center gap-2 rounded-xl bg-white/15 px-3.5 text-sm font-bold text-white ring-1 ring-inset ring-white/25 transition hover:bg-white/25 active:scale-[0.98] sm:px-4"
      >
        <ClipboardPaste className="h-5 w-5" />
        <span className="hidden sm:inline">Paste</span>
      </button>

      {/*
        The hint that replaces silence.

        `aria-live="polite"` so a screen-reader user learns the read failed too —
        for them the previous behaviour was even less discoverable, since there
        was not even a missing character to notice.

        Positioned absolutely so it cannot change the CTA's height: this bar sits
        directly above the fold on the landing page and a reflow here would be a
        layout shift on the one element LCP and CLS both watch.
      */}
      {blocked ? (
        <span
          aria-live="polite"
          className="pointer-events-none absolute inset-x-0 -bottom-6 z-20 text-center text-[11px] font-semibold text-white/90 drop-shadow"
        >
          Clipboard blocked — press and hold the field to paste
        </span>
      ) : null}
    </>
  );
}
