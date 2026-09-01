"use client";

import { useEffect, useRef, useState } from "react";

import { ExoClickSticky } from "@/features/monetization/exoclick-sticky";

/**
 * The ONE ad above the History grid, with a second chance.
 *
 * Owner, 2026-09-01: "i dont see the video outstream in history, make the
 * history above the grid to be able to use multi format when video outstream is
 * not avalaible, when video outstream is available it should win and show, when
 * it cap and want refresh the multi format should show, both shouldnt show at
 * once cause now i dont see any".
 *
 * ── Why the admin switch alone could not do this ──────────────────────────────
 *
 * The switch is a STATIC choice: whichever side it names is the only tag that
 * slot ever asks for, and if that zone is capped for this viewer the slot is
 * simply empty for them. That is the whole of "now i dont see any" — the
 * outstream is winning the switch and then showing nothing, because ExoClick
 * caps per viewer and holds an outstream collapsed until the reader scrolls.
 *
 * So the choice becomes an ORDER instead. The switch still decides who goes
 * first and the outstream still wins whenever it actually paints; the other tag
 * is only asked for once the first has had its chance and produced nothing.
 *
 * ── One `<ins>` at a time, which is the whole point ───────────────────────────
 *
 * 🔴 "both shouldnt show at once" is not only a visual preference here — it is
 * the rule that keeps this slot working at all. ExoClick asks for every
 * placeholder on a page in ONE request and will not serve a zone twice in it,
 * and a zone that cannot serve drags the rest of that request down with it
 * (measured 2026-09-01: /history fell from a 43% fill rate to 12% when a second
 * unit joined the page). Rendering both and hiding one would put two
 * placeholders in that request and cost the page the ad it already had.
 *
 * So this SWAPS rather than stacks: exactly one `ExoClickSticky` is mounted at
 * any moment. The first unmounts before the second mounts, which also releases
 * its zone claim, so the fallback can take a zone of its own cleanly.
 */

/**
 * How long the first tag gets before the other one is tried.
 *
 * Longer than the unit's own 10s give-up beacon, so a creative that is merely
 * slow is never given up on — this waits for the slot's own verdict rather than
 * racing it. A viewer who is going to see the outstream has seen it well
 * before this fires.
 */
const FALLBACK_AFTER_MS = 12_000;

export function HistoryGridAd() {
  const [phase, setPhase] = useState<"primary" | "fallback">("primary");
  /**
   * Whether the first tag ever put a creative on screen.
   *
   * A ref, not state: it is written from the unit's fill callback and read from
   * a timeout, and re-rendering on it would remount the very `<ins>` whose fill
   * it is recording.
   */
  const painted = useRef(false);

  useEffect(() => {
    if (phase !== "primary") return;
    const id = setTimeout(() => {
      /*
        Only swap if nothing was ever painted. `onFill(false)` is NOT used as
        the trigger: it also fires on teardown, so a navigation away would
        promote the fallback for a slot that was working perfectly.
      */
      if (!painted.current) setPhase("fallback");
    }, FALLBACK_AFTER_MS);
    return () => clearTimeout(id);
  }, [phase]);

  if (phase === "fallback") return <ExoClickSticky slot="historyfallback" />;

  return (
    <ExoClickSticky
      slot="history"
      onFill={(filled) => {
        // Latch on TRUE only. Once this slot has shown something, the fallback
        // must never replace it — including when the creative later collapses.
        if (filled) painted.current = true;
      }}
    />
  );
}
