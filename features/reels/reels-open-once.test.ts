import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner 2026-10-31: the Reels tab "reloads twice, showing a black page twice". The second was the deck re-arranging
 * itself (watched clips dropped, a replayed payload reshuffled) one frame AFTER it painted, so the first clip swapped
 * and started over. An in-app open now arranges the deck in its first render; only a hydrating cold load (which must
 * match the server's HTML) still does it after paint.
 */
const SRC = readFileSync(join(process.cwd(), "features/reels/reels-feed.tsx"), "utf8");

function arrangesBeforePaint(src: string): boolean {
  return (
    // true on a client-side mount, false while hydrating server HTML
    /useSyncExternalStore\(noSubscribe, \(\) => true, \(\) => false\)/.test(src) &&
    // the first render takes the arranged deck
    /if \(firstDeck\.current\) return firstDeck\.current\.next;/.test(src) &&
    // and the after-paint pass never swaps a deck that was arranged up front
    /if \(!firstDeck\.current && \(next\.length !== initialItems\.length/.test(src)
  );
}

describe("Reels opens once — no second reload after paint", () => {
  it("arranges the deck in the first render on an in-app open", () => {
    expect(arrangesBeforePaint(SRC)).toBe(true);
  });

  it("has teeth — re-arranging after paint fails", () => {
    expect(arrangesBeforePaint(SRC.replace("if (firstDeck.current) return firstDeck.current.next;", ""))).toBe(false);
    expect(arrangesBeforePaint(SRC.replace("if (!firstDeck.current && (next.length", "if ((next.length"))).toBe(false);
  });
});
