/**
 * Reading ExoClick's own answer out of their loader's debug log.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 *
 * Whether a slot filled was inferred from the DOM and a stopwatch four separate
 * times, and every version was wrong in its own way: watch the `<ins>` (the
 * creative is inserted as a SIBLING of it), watch for an `<img>` (it may be a
 * video, or a CSS background), give up after N seconds (an OUTSTREAM unit
 * reveals on viewability, which can be later than any N worth waiting for).
 *
 * The outstream case is the cruel one. It sizes itself to its container, so it
 * needs a box with height to initialise in — which means a timer that withdraws
 * the box is a timer that can PREVENT the fill it is waiting for. There is no
 * value of N that is both short enough not to leave an empty hole and long
 * enough to be sure.
 *
 * The loader keeps its own log and exposes it as `AdProvider.getDebugMessages()`.
 * Three lines settle the question, verbatim from their bundle:
 *
 *     Request #<n> Placement #<m> was pushed with zone {…"id":6015590…}
 *     Request #<n> Placement #<m> has no ads to display
 *     Request #<n> handling the response
 *
 * That is the network's own verdict, per zone, available before anything
 * paints. The box can come down the instant ExoClick says there is no ad, and
 * stay up as long as a served request is still working.
 *
 * ⚠️ `getDebugMessages` is undocumented and could disappear. Everything here
 * therefore fails to "pending" — "keep waiting" — never to a false verdict, and
 * every caller keeps a timeout as the fallback. Losing this degrades to the old
 * behaviour instead of breaking. `exoclick-verdict.test.ts` pins the format
 * against lines captured from the live loader, so a change is noticed by a
 * failing test rather than by a slot that silently stops collapsing.
 *
 * Its own module, not part of the component: it is pure string parsing, and a
 * test that has to import a `.tsx` to reach it cannot be a plain `.ts`.
 */

export type LoaderVerdict = "pending" | "empty" | "served";

/** The loader's debug log, or an empty list when it is not running. */
export function debugMessages(): string[] {
  if (typeof window === "undefined") return [];
  const provider = (window as { AdProvider?: { getDebugMessages?: () => string[] } }).AdProvider;
  try {
    const messages = provider?.getDebugMessages?.();
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

/**
 * What ExoClick says happened to `zoneId`, considering only messages logged at
 * or after `since`.
 *
 * `since` matters because the log is cumulative for the life of the page and
 * several placements share it: without it, a previous mount's no-fill — or
 * another slot's — would be read as this one's answer.
 */
export function loaderVerdict(zoneId: string, since: number): LoaderVerdict {
  const recent = debugMessages().slice(since);
  if (recent.length === 0) return "pending";

  /*
    Which request numbers carried OUR zone. The id is matched with a word
    boundary so `601559` cannot satisfy a lookup for `6015590` — a neighbouring
    zone's verdict landing on this slot is exactly the kind of quiet wrongness
    this module is meant to end.
  */
  const ours = new Set<string>();
  for (const line of recent) {
    const pushed = /Request #(\d+) Placement #\d+ was pushed with zone (.+)$/.exec(line);
    if (pushed && new RegExp(`"id":\\s*${zoneId}\\b`).test(pushed[2]!)) ours.add(pushed[1]!);
  }
  if (ours.size === 0) return "pending";

  // A definite refusal outranks everything else. `Group #` appears on grouped
  // placements; their bundle builds that line in three pieces.
  for (const line of recent) {
    const empty = /Request #(\d+) Placement #\d+(?: Group #\d+)? has no ads to display/.exec(line);
    if (empty && ours.has(empty[1]!)) return "empty";
  }
  // The response arrived and did not refuse ours — an ad is on its way, even if
  // the player has not decided it is viewable yet.
  for (const line of recent) {
    const answered = /Request #(\d+) handling the response/.exec(line);
    if (answered && ours.has(answered[1]!)) return "served";
  }
  return "pending";
}
