import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PAGINATED READS — working around PostgREST's silent row ceiling
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Found 2026-08-16 while building the new-vs-returning visitor chart: a query
 * with `.limit(50000)` against a range containing ~24 400 rows came back with
 * exactly 1000 rows, `error: null`. PostgREST enforces its own server-side
 * page ceiling (`db-max-rows`, defaulting to 1000 on Supabase) BEFORE it ever
 * looks at the client's requested `.limit()` — a `.limit()` larger than that
 * ceiling is silently downgraded to it. No error, no `capped` signal from the
 * client library, nothing — the response looks identical to a genuinely small
 * result set.
 *
 * That is a wider bug than the feature that surfaced it: `revenue-series.ts`'s
 * `ROW_CAP = 50_000` and `queries.ts`'s `SAMPLE_CAP = 20_000` were both written
 * assuming `.limit(N)` actually returns up to N rows — on any day busy enough
 * to produce more than 1000 impressions/clicks/downloads in the queried
 * window (this app's own admin digest recorded 448 completed downloads in a
 * SINGLE day while this was being diagnosed), those charts have been reading
 * only the oldest 1000 rows of the window and silently under-counting
 * everything after, with no indication anything was wrong.
 *
 * The fix is standard Supabase practice: page through `.range()` in chunks at
 * or under the real ceiling, not a single oversized `.limit()`.
 */

/** PostgREST's per-request row ceiling on this project, confirmed empirically. */
const PAGE_SIZE = 1000;

export interface PaginatedResult<T> {
  rows: T[];
  /** True when the read stopped at `cap` rather than exhausting the range. */
  capped: boolean;
  /** The error from the page that stopped the read, if any page failed. Rows
   *  collected from pages BEFORE the failure are still returned — a caller
   *  that only checks `rows.length` would otherwise mistake "read failed
   *  partway" for "the table is genuinely small". */
  error: { message: string } | null;
}

/**
 * Reads up to `cap` rows via repeated `.range(from, to)` calls, `PAGE_SIZE` at
 * a time. `build` must apply the SAME filters/order on every call — only the
 * range differs — so results append correctly page over page.
 */
export async function paginatedSelect<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  cap: number,
): Promise<PaginatedResult<T>> {
  const rows: T[] = [];
  let offset = 0;
  let error: { message: string } | null = null;
  while (rows.length < cap) {
    const to = Math.min(offset + PAGE_SIZE, cap) - 1;
    const page = await build(offset, to);
    if (page.error) {
      error = page.error;
      break;
    }
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < to - offset + 1) break; // short page → the range is exhausted
    offset += data.length;
  }
  return { rows, capped: rows.length >= cap, error };
}
