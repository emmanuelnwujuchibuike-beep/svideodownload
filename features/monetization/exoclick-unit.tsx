"use client";

import { useEffect, useRef, useState } from "react";

import { EXOCLICK_INS_CLASS, EXOCLICK_PROVIDER_SRC } from "@/lib/monetization/ad-schema";
import { cn } from "@/lib/utils";

/**
 * One ExoClick zone, rendered as a 9:16 vertical unit.
 *
 * ── Why this is not a `display` row in an iframe ──────────────────────────────
 *
 * ExoClick's embed is three parts that only work together: a loader script, an
 * `<ins>` placeholder carrying the zone id, and a `push` that tells the loader
 * to go and fill every placeholder it can find. Pasted whole into a `display`
 * placement it would technically run — the srcdoc frame is self-contained — but
 * every slot would then load its own copy of the loader, which on a landing page
 * carrying eight section-break slots is eight duplicate third-party scripts on
 * the one route with a hard cold-entry budget.
 *
 * So the loader is a module-level singleton, shared by every unit on the page,
 * and each unit contributes only its own `<ins>`.
 *
 * ── The operator only ever types a zone id ───────────────────────────────────
 *
 * The whole snippet is reconstructed here from one number. That is the
 * difference between an operator pasting five snippets into five zones (and one
 * of them silently being the wrong product, which is the mistake
 * `looksLikeHijackScript` exists to catch for the other networks) and typing
 * five numbers.
 */

/* -------------------------------- the loader ------------------------------- */

declare global {
  interface Window {
    AdProvider?: unknown[];
  }
}

/**
 * The single in-flight/settled load of ExoClick's provider script.
 *
 * Module scope, so N units on a page share one script tag and one promise. Not
 * reset on unmount: the script stays in the document once loaded, exactly as a
 * `<script async>` in the markup would, and re-adding it per mount is what would
 * make a Reels deck accumulate a tag per ad slide.
 */
let providerPromise: Promise<boolean> | null = null;

function loadProvider(): Promise<boolean> {
  if (providerPromise) return providerPromise;

  providerPromise = new Promise<boolean>((resolve) => {
    if (typeof document === "undefined") {
      resolve(false);
      return;
    }
    // Already present (a previous load, or a hand-placed tag) — nothing to do.
    if (document.querySelector(`script[src="${EXOCLICK_PROVIDER_SRC}"]`)) {
      resolve(true);
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.type = "application/javascript";
    script.src = EXOCLICK_PROVIDER_SRC;
    /*
      Resolves FALSE on error rather than rejecting, and an ad blocker is the
      common case rather than an exceptional one. A rejection here would leave
      every waiting unit in its unresolved state forever, which is precisely the
      "decorated box around nothing" the ad-slot suite exists to prevent — the
      unit needs to hear "no" so it can collapse.
    */
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });

  return providerPromise;
}

/** Ask ExoClick to fill every placeholder it has not filled yet. */
function serve(): void {
  try {
    (window.AdProvider = window.AdProvider ?? []).push({ serve: {} });
  } catch {
    /* A malformed provider must never take a page down over an ad. */
  }
}

/* --------------------------------- the unit -------------------------------- */

/**
 * How long to wait for a creative before declaring the slot empty.
 *
 * ExoClick answers in well under a second on a warm connection, but a cold
 * mobile connection plus the loader's own round trip can genuinely take a few.
 * Too short reports a real ad as absent (and collapses a card that was about to
 * fill); too long leaves a reserved box open on a slot that will never fill.
 */
const FILL_TIMEOUT_MS = 6000;

export function ExoClickUnit({
  zoneId,
  /**
   * Fill the parent instead of sitting in a constrained column.
   *
   * The Reels slide is a full-screen 9:16 surface and should use all of it; the
   * in-page placements are 9:16 inside a page that is not, so they cap their
   * width and centre. One prop rather than two components because everything
   * else about them — the loader, the serve call, the fill detection — is
   * identical, and a second component is how the two drift.
   */
  fill = false,
  className,
  onFill,
}: {
  zoneId: string;
  fill?: boolean;
  className?: string;
  /**
   * Reports whether a creative actually arrived.
   *
   * Mirrors `AdSenseUnit`'s `onFill` and exists for the same reason: a
   * CONFIGURED zone is not a filled one. ExoClick returns nothing when it has no
   * demand for the geo/device, and the `<ins>` simply stays empty — so the only
   * honest answer comes from watching the element, not from the row.
   */
  onFill?: (filled: boolean) => void;
}) {
  const host = useRef<HTMLModElement | null>(null);
  const answered = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    answered.current = false;
    setFailed(false);
    const el = host.current;
    if (!el) return;

    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let observer: MutationObserver | null = null;

    const answer = (filled: boolean) => {
      if (!alive || answered.current) return;
      answered.current = true;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
      if (!filled) setFailed(true);
      onFill?.(filled);
    };

    void loadProvider().then((ok) => {
      if (!alive) return;
      if (!ok) {
        // Blocked or offline. Collapse rather than hold a box open.
        answer(false);
        return;
      }

      /*
        Fill is detected by WATCHING THE ELEMENT, because nothing else can tell
        us. ExoClick injects an iframe (or nothing at all) into the `<ins>`
        asynchronously and provides no callback, so the presence of a child node
        is the only signal that a creative exists. Without this the surrounding
        "Sponsored" card would render around an empty box on every unfilled
        slot — the exact bug lib/monetization/ad-slots.test.ts pins.
      */
      if (el.childElementCount > 0) {
        answer(true);
        return;
      }
      observer = new MutationObserver(() => {
        if (el.childElementCount > 0) answer(true);
      });
      observer.observe(el, { childList: true });
      timer = setTimeout(() => answer(false), FILL_TIMEOUT_MS);

      serve();
    });

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
    // `onFill` deliberately omitted: an inline arrow from the parent changes
    // identity every render and would restart the whole load/serve cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneId]);

  // Nothing arrived — render no box at all, so the parent's card collapses with
  // it rather than framing an empty 9:16 hole.
  if (failed) return null;

  return (
    <div
      className={cn(
        "relative overflow-hidden",
        fill
          ? "h-full w-full"
          : // 9:16, capped so a vertical unit cannot dominate a page that is
            // not vertical. 300px wide is ExoClick's own smallest vertical
            // display size, which keeps the creative at its native scale.
            "mx-auto aspect-[9/16] w-full max-w-[300px] rounded-xl",
        className,
      )}
    >
      {/*
        `<ins>` with ExoClick's class and the zone id — the exact placeholder
        their loader looks for. Rendered as a real element from a validated
        numeric id rather than injected as markup, so an admin field can never
        become a script on the page.
      */}
      <ins
        ref={host}
        className={`${EXOCLICK_INS_CLASS} block h-full w-full`}
        data-zoneid={zoneId}
      />
    </div>
  );
}
