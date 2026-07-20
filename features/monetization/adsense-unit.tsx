"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A Google AdSense ad unit.
 *
 * ── Why AdSense needs its own component ───────────────────────────────────────
 *
 * Every other network on this site is "paste this script tag", which the display
 * format handles by dropping the blob into a sandboxed iframe. AdSense is not
 * that shape: it is a publisher id plus an ad-unit id rendered into an `<ins>`
 * tag whose attributes are the configuration, and it must run in the TOP-LEVEL
 * document. Putting it in the `srcdoc` iframe the display format uses would
 * break it — AdSense reads the host page's URL and content to target and to
 * verify the site, and an `about:srcdoc` frame has neither. It is also against
 * their policy.
 *
 * ── The loader is shared and loaded once ──────────────────────────────────────
 *
 * `adsbygoogle.js` is per-publisher, not per-unit. Two units on one page must
 * share one script tag; loading it twice makes AdSense log an error and can
 * leave the second unit unfilled. `ensureLoader` therefore keys on the client id
 * and is idempotent across every unit on the page.
 *
 * ── The push is per-unit and must happen exactly once ─────────────────────────
 *
 * `(adsbygoogle = window.adsbygoogle || []).push({})` is what tells AdSense to
 * fill THIS `<ins>`. Pushing twice for the same element throws
 * "adsbygoogle.push() error: All 'ins' elements already have ads in them", which
 * in React's development double-invoked effects is the default outcome rather
 * than an edge case — hence the ref guard.
 *
 * ── CSP ───────────────────────────────────────────────────────────────────────
 *
 * No change required and none made. `script-src` already includes `https:` and
 * `frame-src` includes `https:` and `blob:` (see `next.config.ts`, which
 * explains why the enforced policy is deliberately permissive for ad script).
 * The standing constraint is that ads must never be CSP-blocked, and
 * `csp.test.ts` covers it.
 */

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

const LOADER_ATTR = "data-frenz-adsense-client";

function ensureLoader(client: string) {
  if (typeof document === "undefined") return;
  // Keyed on the client id: one loader per publisher, shared by every unit.
  if (document.querySelector(`script[${LOADER_ATTR}="${client}"]`)) return;

  const script = document.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  script.setAttribute(LOADER_ATTR, client);
  document.head.appendChild(script);
}

export function AdSenseUnit({
  client,
  slotId,
  layout,
  width,
  height,
  className,
  onFill,
}: {
  client: string;
  slotId: string;
  /** `data-ad-format`. Defaults to responsive `auto`. */
  layout?: string | null;
  width?: number | null;
  height?: number | null;
  className?: string;
  /**
   * Reports whether AdSense actually returned a creative.
   *
   * ── Why a configured unit is not the same as a visible ad ─────────────────
   *
   * The parent surfaces used to reveal themselves as soon as an ad ROW existed.
   * For every other network that is the same thing. For AdSense it is not: an
   * unapproved account, an unverified site, or simply no matching demand all
   * return NO creative, and the `<ins>` collapses to zero height — leaving a
   * card with a "Sponsored" label and nothing underneath, which is exactly the
   * empty box this whole system is meant to avoid.
   *
   * AdSense marks the outcome on the element itself as
   * `data-ad-status="filled" | "unfilled"`, asynchronously and often well after
   * the push. So the surface waits for that answer rather than assuming one.
   */
  onFill?: (filled: boolean) => void;
}) {
  const insRef = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    pushed.current = true;
    ensureLoader(client);
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // A push failure is a filled-or-duplicate unit, not something the visitor
      // can act on. The slot simply stays empty; never surface it.
    }
  }, [client]);

  useEffect(() => {
    const el = insRef.current;
    if (!el || !onFill) return;

    let settled = false;
    const report = (filled: boolean) => {
      if (settled) return;
      settled = true;
      onFill(filled);
    };

    const read = () => {
      const status = el.getAttribute("data-ad-status");
      if (status === "filled") report(true);
      else if (status === "unfilled") report(false);
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(el, { attributes: true, attributeFilter: ["data-ad-status"] });

    /*
      A backstop, because `data-ad-status` is not guaranteed to appear at all —
      most commonly when the loader script never ran (no publisher id set, or an
      ad blocker). Without this the surface would wait forever in its hidden
      state, which is at least the safe direction, but the timeout lets a slow
      genuine fill still win while resolving the stuck case.
    */
    const timer = window.setTimeout(() => {
      if (settled) return;
      const status = el.getAttribute("data-ad-status");
      // Height is the fallback signal: a filled unit has been given one.
      report(status === "filled" || el.getBoundingClientRect().height > 1);
    }, 4000);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
    // `onFill` is intentionally not a dependency — parents pass an inline
    // setter, which would re-run this observer on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /*
    A fixed size is honoured when the operator gave one, otherwise the unit is
    responsive. `display:block` is required either way — AdSense will not fill an
    `<ins>` that computes to `display:inline`, which is the browser default for
    that element and a genuinely easy way to end up with a silently blank unit.
  */
  const sized = typeof width === "number" && typeof height === "number" && width > 0 && height > 0;

  return (
    <ins
      ref={insRef}
      className={cn("adsbygoogle block", className)}
      style={sized ? { display: "block", width, height } : { display: "block" }}
      data-ad-client={client}
      data-ad-slot={slotId}
      data-ad-format={sized ? undefined : (layout ?? "auto")}
      data-full-width-responsive={sized ? undefined : "true"}
    />
  );
}
