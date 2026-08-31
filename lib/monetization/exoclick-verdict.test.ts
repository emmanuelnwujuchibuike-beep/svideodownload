import { afterEach, describe, expect, it } from "vitest";

import { loaderVerdict } from "@/lib/monetization/exoclick-verdict";

/**
 * Guards the parsing of ExoClick's own debug log.
 *
 * Every fixture below is a VERBATIM line captured from the real
 * `a.magsrv.com/ad-provider.js` by `scripts/exoclick-loader-probe.mjs` — the
 * timestamp prefix, the spacing and the JSON shape are theirs, not an
 * approximation. That matters because this parse is the only thing standing
 * between "the network said no" and four rounds of guessing from the DOM, and
 * because the format is undocumented: if they change it, these tests are what
 * notices rather than a slot that silently stops collapsing.
 */

const HISTORY_ZONE = "6015590";

function setLog(lines: string[]): void {
  (globalThis as { window?: unknown }).window = globalThis;
  (globalThis as { AdProvider?: unknown }).AdProvider = {
    push: () => {},
    getDebugMessages: () => lines,
  };
}

afterEach(() => {
  delete (globalThis as { AdProvider?: unknown }).AdProvider;
});

/* Captured live, in order, for zone 6015590 (OUTSTREAM VIDEO, type 37). */
const REAL_NO_FILL = [
  '2026-08-31T16:06:50.468Z: Request #0 Placement #0 was pushed with zone {"custom_targeting":{},"id":6015590,"extra_params":{"first_request":true,"zone_type":37}}',
  "2026-08-31T16:06:50.479Z: s.magsrv.com - Zones Batch Size: 10, Multi-zones Batch Size: 3",
  "2026-08-31T16:06:50.491Z: s.magsrv.com - Request #0 with 1 zone(s) of type OUTSTREAM VIDEO is being served.",
  "2026-08-31T16:06:51.386Z: Request #0 handling the response",
  "2026-08-31T16:06:51.391Z: Request #0 Placement #0 has no ads to display",
  "2026-08-31T16:06:51.393Z: s.magsrv.com - 1 ad request(s) completed successfully",
];

describe("loaderVerdict — reading ExoClick's own answer", () => {
  it("🔴 reports EMPTY when the loader says it has no ads", () => {
    setLog(REAL_NO_FILL);
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("empty");
  });

  it("reports SERVED once the response is in and nothing said no-ads", () => {
    setLog(REAL_NO_FILL.filter((l) => !l.includes("has no ads to display")));
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("served");
  });

  it("is PENDING while the request is still in flight", () => {
    setLog(REAL_NO_FILL.slice(0, 3));
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("pending");
  });

  it("🔴 never reads ANOTHER zone's verdict as its own", () => {
    /*
      Several placements share one log. Attributing the bottom banner's no-fill
      to the history slot would collapse a box that has an ad on the way — which
      is the exact failure this whole verdict path exists to stop.
    */
    setLog([
      '2026-08-31T16:06:50.468Z: Request #0 Placement #0 was pushed with zone {"custom_targeting":{},"id":9999999,"extra_params":{"zone_type":33}}',
      "2026-08-31T16:06:51.391Z: Request #0 Placement #0 has no ads to display",
      '2026-08-31T16:06:52.100Z: Request #1 Placement #0 was pushed with zone {"custom_targeting":{},"id":6015590,"extra_params":{"zone_type":37}}',
    ]);
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("pending");
  });

  it("🔴 does not let a PREFIX of the zone id match", () => {
    // 601559 must not satisfy a lookup for 6015590, or a neighbouring zone's
    // answer lands on the wrong slot.
    setLog([
      '2026-08-31T16:06:50.468Z: Request #0 Placement #0 was pushed with zone {"custom_targeting":{},"id":601559,"extra_params":{}}',
      "2026-08-31T16:06:51.391Z: Request #0 Placement #0 has no ads to display",
    ]);
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("pending");
  });

  it("ignores everything logged BEFORE this serve", () => {
    /*
      `since` is what stops a previous mount's no-fill being read as this one's
      — the log is cumulative for the life of the page.
    */
    setLog(REAL_NO_FILL);
    expect(loaderVerdict(HISTORY_ZONE, REAL_NO_FILL.length)).toBe("pending");
  });

  it("stays PENDING rather than guessing when the log is unavailable", () => {
    // `getDebugMessages` is undocumented and may vanish. Losing it must degrade
    // to the timeout fallback, never to a false "empty" that collapses the box.
    (globalThis as { AdProvider?: unknown }).AdProvider = { push: () => {} };
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("pending");

    (globalThis as { AdProvider?: unknown }).AdProvider = {
      push: () => {},
      getDebugMessages: () => {
        throw new Error("gone");
      },
    };
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("pending");
  });

  it("handles the Group # variant their bundle emits", () => {
    setLog([
      '2026-08-31T16:06:50.468Z: Request #2 Placement #1 was pushed with zone {"custom_targeting":{},"id":6015590}',
      "2026-08-31T16:06:51.391Z: Request #2 Placement #1 Group #3 has no ads to display",
    ]);
    expect(loaderVerdict(HISTORY_ZONE, 0)).toBe("empty");
  });
});
