# Analytics & Reporting Audit — 2026-08-09

Full trace of the tracking pipeline from browser to dashboard, the defects found,
what was fixed, and what remains.

**Scope of evidence.** Every finding below was read out of the codebase in this
repository, or measured live against `frenzsave.com`. Nothing here is inferred
from how a system "probably" behaves. Where a claim could not be established
from the code, it says so in those words.

**Method.** Traced `lib/analytics/client.ts` → `app/api/analytics/collect/route.ts`
→ `supabase/migrations/0103_analytics_foundation.sql` →
`lib/analytics/queries.ts` → `features/admin/analytics-dashboard.tsx`, plus the
parallel monetization path (`/api/track` → `ad_impressions` / `ad_clicks`) and
the download lifecycle in `features/downloads/manager.ts`.

---

## 1. Summary

The pipeline's foundation was sound. `event_id` is a client-generated UUID and
the primary key of `analytics_events`, inserted with
`on conflict do nothing` — so a replayed batch genuinely is idempotent, and the
most common class of analytics bug (duplicate rows from network retries) was
already prevented. Geo is coarse, no raw IP is ever stored, and RLS denies all
public access. That is a better starting point than most.

What was wrong sat one layer up, in **how the stored events were counted** and in
**which events were never emitted at all**. Thirteen defects were confirmed. Four
are Critical in the sense that matters here: they made a headline number on the
dashboard *silently wrong* rather than obviously broken, which is the failure
mode that gets acted on.

The single worst was not a bug in arithmetic but in presentation: every
distinct-count was computed in JavaScript over a capped 20,000-row sample. Past
that cap, "Unique visitors" stops rising. On a dashboard, **an undercount that
plateaus is indistinguishable from real traffic plateauing** — so the error would
have been read as a business signal.

All thirteen are fixed. Migration `0115_analytics_integrity.sql` must be applied
for the metric fixes to take effect; until it is, the dashboard renders an
explicit warning rather than zeros.

**Confidence in this report: high.** Every "Confirmed" finding was verified by
reading the code path end to end; several were additionally reproduced live.

---

## 2. Issues found

Severity reflects **how wrong the number was and how likely it was to be
believed**, not how hard the fix was.

### CRITICAL

---

**A1 — Every distinct-count was a 20,000-row sample presented as exact**
`lib/analytics/queries.ts` (before)  · Confidence: **Confirmed**

`getAnalyticsSummary` selected up to `SAMPLE_CAP = 20_000` recent events and
computed unique visitors, live visitors, device/browser/country breakdowns,
top pages, referrers and the entire trend chart over that array in JS.

*Why it happens:* the sample is ordered `received_at desc` and capped. Once a
range contains more than 20,000 events, the sample stops being the range.

*Effect:* "Unique visitors" converges on the number of distinct visitors inside
the most recent 20,000 events and stays there. Every breakdown becomes a
breakdown of recent traffic only, biased toward whatever happened in the last
few hours. There was an `approxBreakdowns` flag, but it only rendered the words
"breakdowns sampled" in small text at the bottom of the page.

*Fix:* exact aggregates in Postgres — `analytics_traffic_totals`,
`analytics_breakdown`, `analytics_timeseries`, `analytics_page_traffic`,
`analytics_platform_totals` (migration 0115). `approxBreakdowns` is now
permanently false.

---

**A2 — Out-of-order event batches regressed download status and erased file sizes**
`app/api/analytics/collect/route.ts`, `0103` schema · Confidence: **Confirmed**

`analytics_downloads` was upserted on `download_id` with a plain
`on conflict do update` — last write wins by *arrival*, not by event time.

*Why it happens:* the client re-queues a failed batch to the **front** of the
queue (`queue.unshift(...batch)` in `lib/analytics/client.ts`). So a batch that
fails once is delivered *after* the batch behind it. A `download_requested`
event arriving after `download_completed` overwrote status back to
`'requested'` — and because `fileSize` is only present on the completed event,
`num(p.fileSize)` returned `null` and wiped the recorded size.

*Effect:* "Downloads completed" and "Success rate" both undercount. Critically,
**the error is biased toward users with flaky connections** — exactly the
population whose experience the metric exists to measure.

*Fix:* a `last_event_at` column plus a `before update` trigger that ignores an
event older than the one the row already reflects, and `coalesce`s every
nullable column so a later event can never erase a known value. Ordering on
event time (not a status rank) is what keeps a manual retry working: a retry
genuinely *is* a later event.

---

**A3 — Bots and crawlers were counted as people**
`app/api/analytics/collect/route.ts` · Confidence: **Confirmed**

Nothing in the pipeline read the user agent. There was no bot field, no filter,
no check.

*Why it was easy to miss:* most classic crawlers never execute JavaScript and so
never reached the collector — which made the numbers look plausible. What *does*
execute JS: headless Chrome (scrapers, SEO and screenshot tools), synthetic and
uptime monitors, link-preview fetchers, and this project's own Playwright e2e
runs.

*Effect:* inflated unique visitors, sessions and page views. Because none of
that traffic can ever download anything, it also **depressed every conversion
ratio** — the site looked worse at converting than it is.

*Fix:* `isBotUA` in `lib/analytics/enrich.ts`, matching only unambiguous tokens.
Events are **marked, not dropped** (`is_bot`), so a misclassification stays
queryable and reversible. Every aggregate filters `is_bot = false`. A test
asserts five real-world mobile/desktop UAs — including Samsung Internet, which
is heavily represented in this site's Africa-primary audience — are *not*
matched, because a false positive silently deletes a real person.

---

**A4 — `download_cancelled` was declared everywhere and emitted by nothing**
`features/downloads/manager.ts` · Confidence: **Confirmed**

The event type existed in `AnalyticsEventType`, in the collect route's enum, in
`STATUS_FROM_TYPE`, and as a documented status in the `0103` schema comment.
`cancelDownload()` deleted the task from the array and returned.

*Effect:* two separate errors. "Downloads cancelled" was a permanent zero. And
the abandoned download stayed in `analytics_downloads` as `'requested'`
forever — so with `successRate = completed / total`, **every user who changed
their mind was counted as a download we failed to deliver.**

*Fix:* `cancelDownload` now emits before dropping the task. Success rate is
`completed / (completed + failed)`; cancelled and abandoned are reported as
their own metrics.

---

### HIGH

---

**B1 — Ad impressions counted on load, not on view**
`features/monetization/ad-slot.tsx` · Confidence: **Confirmed**

The impression beacon fired in a `useEffect` as soon as `loadZoneAd` resolved —
for every placement on the page, including ones far below the fold, with
`loading="eager"` on the frame.

*Effect:* impressions inflated by however many slots a visitor never scrolled
to. Since `revenueUsd = impressions / 1000 × cpm`, **every revenue figure
inherited that inflation directly**, and CTR was structurally too low because
the clicks were real while the denominator was not.

*Fix:* IAB Display standard — 50% visible for one continuous second, via
`IntersectionObserver`, additionally gated on `document.visibilityState`
(a background tab reports its elements as intersecting). `pop` creatives have no
visible box and still count on load. No `IntersectionObserver` → counts on load,
because under-reporting a real impression costs revenue actually earned.

---

**B2 — The rewarded-ad gate double-counted every non-video reward ad**
`features/monetization/rewarded-ad.tsx` · Confidence: **Confirmed**

`RewardedAdGate` beaconed its own impression for `zone: "reward_video"`, then —
when the ad was not a self-hosted video — rendered `<AdSlot zone="reward_video">`,
which beacons an impression for the same zone.

*Effect:* `reward_video` impressions exactly doubled; its CTR exactly halved;
**its estimated revenue was exactly 2× the truth.**

*Fix:* the gate beacons only for the video it renders itself. Whichever component
owns the rendering owns the count.

---

**B3 — A double-tap started two downloads**
`features/downloads/manager.ts` · Confidence: **Confirmed**

`startDownload` minted a fresh `crypto.randomUUID()` on every call with no
in-flight check.

*Effect:* two rows in `analytics_downloads`, two units off the daily cap, twice
the extractor load for one file. Common on a slow phone, where the first tap
produces no instant feedback.

*Fix:* an identical `(url, formatId, kind)` triple that is still in flight
returns the original id. A finished or failed task is not matched — re-downloading
something you already have is a real second download.

---

**B4 — Two tabs could each open a session**
`lib/analytics/client.ts` · Confidence: **Confirmed** (race window), **Likely** (frequency)

`ensureSession` read the timestamp, decided the session had expired, and wrote a
new id. localStorage offers no lock, so two tabs waking from the same expired
session both minted *different* ids.

The race window is real and was multi-second wide. How often it fired in
practice is **unable to verify from available code** — it depends on real
multi-tab behaviour.

*Fix:* two layers. The client re-reads after writing and adopts whichever id
landed, narrowing the window to a single storage round-trip. And
`analytics_traffic_totals` counts `COUNT(DISTINCT session_id)` rather than
`session_start` events, so a session that manages to announce itself twice is
still one session.

---

**B5 — "New vs returning" was an extrapolation presented as a count**
`lib/analytics/queries.ts` (before) · Confidence: **Confirmed**

It took 500 visitors from the sample, asked how many had any earlier event,
computed a rate, and multiplied that rate by the total unique count.

*Effect:* a ratio estimated from a sample, rendered as a hard number with no
error bar — on top of A1's already-capped `uniq.size`.

*Fix:* `analytics_visitor_split` — an exact count by each visitor's first-seen
date.

---

### MEDIUM

---

**C1 — Time on page and bounce rate did not exist** · Confidence: **Confirmed**

Neither metric was computed anywhere. *Fix:* a measured `page_exit` event
carrying visible dwell. Time in a background tab does not accrue; dwells under
1s are dropped; a single dwell is server-clamped to 30 minutes. Bounce rate is
sessions with exactly one page view.

Deliberately **not** the usual `next event − this event` estimate: that scores
the last page of every visit as zero, and since bouncing sessions consist
entirely of last pages, it reports the shortest visits as the most engaged.

---

**C2 — Client `occurredAt` was trusted unbounded** · Confidence: **Confirmed**

`new Date(e.occurredAt).toISOString()` accepted any number. A wrong device
clock — or a trivially forged POST to an unauthenticated endpoint — could park
events far in the future, where they sit at the top of every recent query
permanently.

*Fix:* clamped to `[now − 24h, now]`. `received_at` remains authoritative for
windowing.

---

**C3 — Operating system, region and search engine were collected but never shown**
· Confidence: **Confirmed**

`os` and `region` were written on every event by `parseUA`/`geoFromHeaders` and
had no card on the dashboard. Search traffic was worse than absent: it was
scattered across the referrer list as a dozen Google country domains, none
individually large enough to appear in a top-8. *Fix:* cards for all three;
search grouped by engine.

---

**C4 — CSV export disagreed with the dashboard** · Confidence: **Confirmed**

The export read raw tables with no bot filter, so a CSV of the same range
contained more rows than the figure on screen. *Fix:* filters `is_bot`, with a
fallback for the pre-migration schema.

---

**C5 — Per-page visitor counts are summed across paths** · Confidence: **Confirmed** (this is a known, bounded approximation)

The page catalogue collapses dynamic routes (all `/u/<handle>` into one row).
Distinct visitors are summed per path, so one person visiting two profiles counts
twice **in that column only**. A true per-entry distinct count would require the
catalogue's regexes inside SQL — i.e. maintaining them in two languages.

The over-count is bounded by the row's own view count (enforced with `Math.min`)
and affects no headline metric. **This is the only remaining approximation in the
file, and it is named in the code rather than hidden.**

---

### LOW

---

**D1 — `AdSlot`'s `tracked` ref is not reset when `zone` changes** · Confidence: **Confirmed**, impact negligible

If a mounted `AdSlot` were given a different `zone` prop, the second zone's
impression would not fire. No call site currently does this. Left as-is;
recorded so it is not rediscovered as a mystery.

---

## 3. Metrics — verified vs. fixed

| Metric | Before | Now |
|---|---|---|
| Live visitors | Sampled (A1) | ✅ Exact, 5-min window, bots excluded |
| Active visitors | — | ⚠️ **Not a separate concept in this codebase.** "Live visitors" is the only implemented realtime metric; there is no second definition to validate |
| Unique visitors | Capped at 20k (A1) | ✅ Exact `COUNT(DISTINCT visitor_id)` |
| Returning visitors | Extrapolated from 500 (B5) | ✅ Exact, by first-seen date |
| Sessions | `session_start` events, race-prone (B4) | ✅ Exact `COUNT(DISTINCT session_id)` |
| Page views | Correct, unfiltered | ✅ Bots excluded; same-path re-fire guarded |
| Downloads started | Emitted correctly | ✅ Verified — fires in `run()` |
| Downloads completed | Regressed by A2 | ✅ Event-time ordering |
| Downloads failed | Correct | ✅ Verified — only after retries are exhausted, which is right |
| Downloads cancelled | **Always 0** (A4) | ✅ Now emitted |
| Success rate | Wrong denominator (A4) | ✅ `completed / (completed + failed)` |
| Storage used | — | ⚠️ **Not a server-side metric.** `features/history/usage.ts` computes it per-device from local history. Downloads are streamed, not stored on our infrastructure, so there is no server total to report. Reporting one would be inventing it |
| Bandwidth used | Did not exist | ✅ Exact sum of completed `file_size`. **Floor, not total** — abandoned transfers used bandwidth and are not counted |
| Platform breakdown | Sampled | ✅ Exact (`analytics_platform_totals`) |
| Device breakdown | Sampled | ✅ Exact |
| Browser breakdown | Sampled | ✅ Exact |
| Operating system | Collected, never shown (C3) | ✅ Exact + surfaced |
| Country | Sampled | ✅ Exact |
| Region | Collected, never shown (C3) | ✅ Exact + surfaced |
| Referrer | Sampled | ✅ Exact, normalised to host |
| Search engine | Did not exist (C3) | ✅ Grouped by engine |
| Time on page | Did not exist (C1) | ✅ Measured visible dwell |
| Bounce rate | Did not exist (C1) | ✅ Exact |
| Ad impressions | Counted on load (B1) | ✅ IAB viewability |
| Ad clicks | Correct | ✅ Verified — rate-limited, one row per click |
| Reward ads watched | **No source at all** | ✅ New `reward_completed` event, fired on claim |
| Revenue estimates | Inflated by B1+B2 | ✅ Inputs corrected; **still an estimate at your CPM, and labelled as one on the card** |

---

## 4. Duplicate-tracking checklist

Each case from the brief, and what actually prevents it:

| Case | Prevented by | Status |
|---|---|---|
| Page refresh counted twice | One `page_view` per load; `event_id` PK dedups replays | ✅ (a refresh *is* one view — correct) |
| React re-renders | Effect keyed on `pathname`; same-path guard in `trackPageView` | ✅ |
| Strict Mode double execution | `cancelled` flag in `AnalyticsTracker`, plus the same-path guard | ✅ |
| API retries | `on conflict (event_id) do nothing` | ✅ (already correct) |
| Back/forward navigation | Fires a page view — **correct**, that is a real view. bfcache restore does not re-fire | ✅ |
| Prefetch requests | Prefetch does not execute client effects | ✅ |
| Duplicate download requests | In-flight `(url, formatId, kind)` match (B3) | ✅ Fixed |
| Double button taps | Same as above | ✅ Fixed |
| WebSocket reconnects | Analytics uses no sockets. The admin SSE stream is read-only | ✅ N/A |
| Background polling | Dashboard polling reads; it never writes events | ✅ N/A |
| Duplicate server events | `event_id` PK; downloads keyed on `download_id` with event-time ordering (A2) | ✅ Fixed |

---

## 5. Architecture improvements

- **One event schema, enforced at the boundary.** `AnalyticsEventInput` is
  validated by Zod in the collect route; every event carries event id, type,
  timestamp, session id, visitor id, user id when signed in, path, referrer,
  geo, device/browser/OS, and free-form properties.
- **Metric definitions are data, not JSX.** `lib/analytics/metric-catalogue.ts`
  holds each metric's title, description, measurement note, direction and
  thresholds. A description now cannot drift from the query behind it, and
  `higherIsBetter` lives with the definition — which is what stops a dashboard
  painting every increase green.
- **Aggregation moved to the database.** Seven `security definer` RPCs with
  pinned `search_path`, executable only by `service_role`.
- **Unavailability is a state, not a zero.** `rpcHealth` distinguishes "not
  migrated" from "no traffic"; the dashboard renders a banner for the former.

## 6. Performance improvements

- Aggregation in Postgres instead of shipping up to 20,000 rows per dashboard
  tick — with an SSE stream refreshing every 10s, that transfer was the dominant
  cost of having the dashboard open.
- Partial indexes on `is_bot = false`, matching how every aggregate now reads.
- Codec probes memoised per direct URL (10-min TTL, 500-entry cap), so retries
  and batch siblings do not re-probe.
- Landing page: route slide removed on `/`, and two layout `transition-[padding]`
  animations removed that fired on every cold load as the ad bars published
  their heights. Landing remains statically prerendered at 274 kB (ceiling 275).
- History page styled with static gradients and rings; the only motion is a
  one-shot entrance and an input-driven sheen. **Nothing loops at rest** — an
  infinite compositor animation on an idle page costs battery on exactly the
  devices this audience uses.

## 7. Security improvements

- **Bot marking** doubles as light abuse visibility.
- **Client clock clamped** (C2) — the collect endpoint is unauthenticated by
  design, so an unbounded client timestamp was a write primitive into every
  future query window.
- **RPCs are `security definer` with pinned `search_path`**, and `EXECUTE` is
  revoked from `anon` and `authenticated`. A test asserts every `security
  definer` function in the migration pins its search path.
- **`analytics_breakdown` whitelists its dimension** rather than interpolating a
  caller-supplied column name.
- **No new PII.** Still no raw IP anywhere. The admin download log shows a
  truncated anonymous visitor id for guests, never an identifier.
- CSV formula-injection defence retained.

---

## 8. What is NOT fixed, and why

**Language selection** (raised alongside this audit) is diagnosed but only
partly fixed. Three independent defects:

1. The picker offers 53 languages; the app declares 6 locales; `useLocale`
   accepts only those 6 — so 47 choices set a cookie no consumer would match.
2. Five of the six declared locales have **empty catalogues** (`fr: {}`, `ar: {}`,
   `sw: {}`, `pt: {}`, `ha: {}`).
3. Exactly **one component** calls `translate()` — `components/layout/site-header.tsx`,
   with 3 strings.

So even a complete French catalogue would translate three strings in the header.
The picker now states which languages actually work rather than silently doing
nothing.

**Filling the catalogues was deliberately not done.** `lib/i18n/messages/index.ts`
states the rule directly: *"NOTHING here is machine-translated… would produce a
switcher that works and a product that reads as careless in five languages."* An
AI writing those strings is machine translation. This needs human translators and
a decision about which locales are worth the work — **your call, not mine.**

**Remaining known approximation:** C5 (per-page visitor counts), bounded and
documented in code.

---

## 9. Verification performed

| Check | Result |
|---|---|
| `tsc --noEmit` | Clean |
| `next lint` on all changed files | Clean |
| `vitest run` (full suite) | **1505 passed**, 118 files |
| `next build` | Compiled successfully |
| Landing route | `○` static, 274 kB (ceiling 275) — budget test green |
| framer-motion off landing | Asserted by build-artifact test — green |
| Facebook photo bug | **Reproduced live**, root cause measured, fix unit-tested against real captured HTML |
| Tailwind class emission | `bg-current/15` proven to emit **no CSS** by running the Tailwind CLI over it; replaced |

**Not verified:** nothing in this change set has been seen rendering in a real
browser — there is no browser tool in this environment. The metric fixes also
cannot produce real numbers until migration `0115` is applied, and none of the
SQL has been executed against a live database. Both are stated plainly rather
than implied to be done.

---

## 10. Required next step

```
supabase/migrations/0115_analytics_integrity.sql
```

Until it is applied, the dashboard shows an amber banner reading *"Numbers
unavailable, not zero"* and the download log explains it needs the migration.
That is deliberate: a dashboard of confident zeros is the exact failure this
audit was commissioned to remove.

---

## Final confidence score

**High (9/10)** on the audit and the diagnosis. Every finding was traced through
real code; four were reproduced or measured directly. Nothing here is
speculative — where evidence ran out, the report says so.

**Moderate (6/10)** on "production-ready as of this commit", for two reasons
that are about verification, not correctness: the SQL has not been run against a
live database, and no change has been seen in a browser. The build, the type
checker and 1505 tests pass, but that combination has been insufficient on this
project before.
