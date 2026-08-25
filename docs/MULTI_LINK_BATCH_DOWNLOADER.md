# Multi-Link Batch Downloader

Paste several source links, fetch each one separately, review what each
produced, tick exactly what you want, download it as one batch.

## What already existed, and was reused rather than rebuilt

The brief's first instruction was to inspect before implementing. Most of what
it asks for was already here under a different name, and the honest amount of
new code is much smaller than the spec's length suggests:

| Spec section | Already existed | Where |
| --- | --- | --- |
| §11 download concurrency, queue, retry | `MAX_CONCURRENT = 2`, auto-retry, streaming progress, device save, history | `features/downloads/manager.ts` |
| §16-17 reward security | Server-issued reward sessions, item-list authorization, replay protection, idempotent daily billing | `lib/monetization/reward-sessions.ts`, `reward_sessions` table (migration 0117) |
| §16 the ad itself | Watch-in-full enforcement, premium bypass, fail-open on no inventory | `features/downloader/batch-ad-gate.tsx` |
| §18 atomic daily counters | UTC-day Redis `INCR` with receipts | `lib/rate-limit.ts` (`consumeDaily`/`peekDaily`/`alreadyCounted`) |
| §45 download history | One history store, batch-aware | `features/history/store.ts`, `DownloadTask.batchId` |
| §36 rate limiting | Per-route sliding windows | `lib/rate-limit.ts` |
| §34 admin settings | `settings` table + panel pattern | `MomentumEditor` / `LimitsEditor` |
| A batch costing ONE download | `b=` batch receipt | `lib/api/download-quota.ts` |

**A "batch" already meant something here** — the many files of ONE link (a
Snapchat story's snaps, a TikTok slideshow's photos), selected in
`preview-card.tsx`. This feature adds the layer above it: many LINKS, each
owning its own results. Both paths converge on the same reward gate, the same
download manager and the same `batchId` quota receipt.

## What is new

```
lib/downloads/multi-link-config.ts     pure types/defaults/limits (client-safe)
lib/downloads/multi-link.ts            server: settings, policy, quota
app/api/downloads/batch/policy         GET  — the caller's real limits (spends nothing)
app/api/downloads/batch/authorize      POST — §16 step 4, mints the batch id
app/api/downloads/batch/commit         POST — §16 step 10, spends one allowance
app/api/admin/multi-link               POST — admin settings
features/downloader/multi-link/        the panel, source cards, hooks, ZIP writer
features/admin/multi-link-editor.tsx   admin panel
```

### The state tree is the requirement (§3, §8)

`state.ts` holds sources, and items live INSIDE their source. Not a flat array
with a `sourceId` field — that satisfies "which source produced this" on paper
and loses it the first time a render, a progress update or a retry forgets to
re-group. Here an item cannot exist outside its source, so no code path can
move one.

Item ids are source-scoped (`${sourceId}:${formatId}:${i}`) because different
posts routinely expose the same format id (`"0"`, `"720"`, `"pin-img"`). Keyed
on `formatId` alone, ticking Source 1's photo would tick Source 3's.

Totals, selected counts and per-source progress are derived functions, never
stored (§30). `batchReducer` returns untouched sources by object identity, so
the memo'd `SourceCard` re-renders only when its own source changed (§44).

### One source can be many posts, or one (§5)

Same rule the single-link picker uses: formats flagged `isSeparateItem` are
distinct media and become one item each; everything else is alternative
QUALITIES of one post, so the batch takes one. Without that, a plain TikTok
would show as "3 posts" and download the same video three times.

### Security: the backend is the final authority (§18, §19, §36)

- The plan is re-resolved server-side (`getUserPlan`) on every call. No request
  field named `plan` or `isPro` is read anywhere in the flow.
- The source ceiling is recomputed from that plan, so a forged request claiming
  Pro with 100 links is refused on the same line as a free member's 4th.
- Duplicate source URLs are collapsed before counting, so one link pasted three
  times cannot eat a free member's whole allowance.
- **The batch id is minted by the server**, never accepted from the client — a
  client-chosen id could replay a spent receipt, or mint a fresh one per item
  and never be charged.
- `authorize` only PEEKS the allowance; `commit` spends it, keyed by the batch
  id as an idempotency receipt. Refresh, multi-tab, retried requests and
  re-mounted components all charge once; two tabs racing two different batches
  hit the same atomic `INCR` and the second is refused.
- Reward redemption goes through `rewardToken` + `itemIndex`, so `/api/download`
  serves what the SERVER stored for that index, never what the client re-sent.

Enforcement lives in `lib/downloads/multi-link.ts`; the panel only draws it.

### Retries do not cost a second batch (§12)

`retryFailed` re-runs failed items on the ALREADY-PAID batch id, flagged
`isRetry` so it skips the commit and the ad entirely. It redeems each item at
its **original** index in the reward session — re-indexing a 3-item retry as
0,1,2 would return the first three items of the original batch instead of the
three that failed, silently downloading the wrong files with a valid token.
`redeemRewardItem` permits re-redeeming an index precisely for this case.

### Performance: nothing on first load but a button (§26, §48)

`MultiLinkButton` is the only module any entry route ships. The panel is both
`dynamic(ssr:false)` AND behind `open`, which starts `false` — the second half
matters, because `dynamic` alone does not keep a chunk out of a route's build
manifest if the JSX is reached on the first render pass.

Measured after a full `next build`:

| Route | First-load JS (gz) | Ceiling | Panel code present? |
| --- | --- | --- | --- |
| `/` (landing) | 265.6 kB | 275 kB | no |
| `/[downloader]` | 263.0 kB | 275 kB | no |
| `/downloads` | 248.9 kB | 300 kB | no |

Verified by content, not by filename: no chunk in any of those three manifests
contains `downloads/batch/authorize` or `Batch Download`. `lib/perf/budget.test.ts`
passes unchanged — no ceiling was raised for this feature.

### ZIP: images only, on purpose (§15)

`zip.ts` is a ~120-line store-only writer with no dependency. JSZip (~95 kB) and
fflate (~30 kB) exist to do the one thing deliberately skipped: DEFLATE returns
roughly 0-2% on JPEG/PNG/WebP while costing main-thread time on exactly the
low-end phones §27 is about.

It is offered **only when every selected item is an image**, because a ZIP must
exist in memory before the browser can take it and a batch of videos would be
hundreds of megabytes in a tab iOS Safari will kill. Videos stream to disk
individually through the download manager instead. `MAX_ZIP_BYTES` (150 MB) is
a second absolute stop. Source folders are preserved (`Source 1/01 Name.jpg`).

The writer is verified against a real ZIP reader, not its own parser
(`zip.test.ts`): the capability probe uses a reference archive produced by
.NET's `System.IO.Compression`, because the first attempt trusted `tar
--version` and GNU tar answers that happily while being unable to read ZIP at
all.

## Admin (§34)

Admin → **Pricing & limits** → Multi-Link Batch Downloader: feature visibility,
free/Pro source limits, free daily batches, reward required, Pro bypass, fetch
concurrency, upsell copy.

Two things are deliberately NOT admin fields, and the panel says so rather than
faking them:

- **Download concurrency** — there is no separate batch queue to tune. Batch
  items go into the shared download manager, whose `MAX_CONCURRENT` governs
  every download on the site. A second number here would change nothing.
- **Items per batch** — fixed at 50 by what `/api/rewards/download/start`
  accepts (`MAX_ITEMS.batch`). `multi-link-config.test.ts` asserts the three
  places that number appears agree, so they cannot drift into a state where the
  picker offers a batch the reward API will reject.

Feature visibility is read on the server and threaded as a prop, because
`DownloadBox`/`Downloader` are client components. The marketing routes are
`force-static` with the root layout's `revalidate = 60`, so an admin toggle
takes effect within a minute — the same ISR behaviour `getPlatformStatus`
already has on the landing hero.

## Analytics (§35)

Client funnel events (`multilink_opened`, `_source_added`, `_source_fetched`,
`_post_selected`, `_download_clicked`, `_batch_completed`, `_retry_used`,
`_zip_downloaded`, `_limit_reached`, `_upgrade_clicked`, …) in
`lib/analytics/types.ts`. The three moments the SERVER decides —
`batch_authorized`, `batch_refused`, `batch_started` — are separate events in
`lib/platform/events-registry.ts`, emitted where the decision is actually made.
`batch_refused` carries WHICH limit bit, which is the only record of a limit
actually biting.

The reward ad is **not** re-tracked: a multi-link batch runs through the same
`BatchAdGate` → `useRewardSession` path as a single-link one and already emits
`download_batch_reward_*`. A parallel set would double-count the same ads.

## Verified

- `tsc --noEmit` clean; `next build` clean.
- Full suite **2282/2282**, including 24 source-separation tests, 20 config +
  source-level security tests, 13 quota-lifecycle tests and 12 ZIP tests.
- Live against a running dev server: policy returns the spec's free defaults;
  4 sources → `403 TOO_MANY_SOURCES`; 60 items → `403 TOO_MANY_ITEMS`; the same
  URL four times collapses to one source and is allowed; five `authorize` calls
  leave `used: 0`. The button renders in the SSR HTML of both `/` and a
  downloader page, and `"Batch Download"` appears in neither.

## Known limitation, stated rather than hidden

**The daily batch cap does not bite in local dev.** `UPSTASH_REDIS_REST_URL`
and `UPSTASH_REDIS_REST_TOKEN` are present but set to the EMPTY STRING in
`.env.local`, so `hasUpstash` is false, `dailyRedis` is null, and
`consumeDaily` fails open returning `used: 0` — confirmed live: three `commit`
calls for the same batch all returned `used: 0`. That is the intended
fail-open behaviour (a broken counter must never stop a download) and it is
shared with every other counter in the app, including the existing per-plan
download cap.

It does mean a dev-server probe cannot see this code work or fail, which is why
`multi-link.server.test.ts` exercises the lifecycle against a faithful
in-memory stand-in with the real `INCR` + receipt semantics. **Production must
have real Upstash values for the cap to apply** — the same requirement
`lib/rate-limit.ts` already documents for downloads.

## Not built, and why

- **Cancelling an ACTIVE download** (§32) — pending fetches and queued
  downloads cancel properly (`AbortController` per source, cleared on remove /
  edit / unmount). Aborting a transfer already in flight is the download
  manager's own `cancelDownload`, which the batch panel does not surface a
  per-item control for; the floating progress card already does. Adding a
  second cancel affordance for the same task felt like a duplicate control
  rather than a missing one.
- **Virtualized result rendering** (§26) — the item ceiling is 50, which is a
  grid no phone struggles with. Virtualization for a bounded 50-item list would
  be complexity with no measurable payoff. If the cap ever rises materially,
  this is the first thing to add.
- **Per-item "Retry" buttons** — retry is offered per source and per batch
  (§12's "Retry Source" / "Retry Failed"). A third control on every failed tile
  would crowd a 2-4 column grid on mobile for a case the source-level control
  already covers.

---

## Round 2 (2026-08-25) — premium intro section + per-feature ad network

### The explanatory section above the control

`multi-link-intro.tsx` — heading, description, capability chips, and the
collapsed card, all above the Multi-Link placeholder. The point of the copy is
the one thing "＋ Multiple Links" cannot say on its own: that the links may come
from **different** platforms. Someone with a TikTok and an Instagram link in
their clipboard has no reason to guess that.

It names **no platforms**. `SupportedPlatforms` already renders the real set from
the registry; a second hand-written list here would be exactly the drift this
codebase keeps having to remove, and would start overpromising the moment a
platform is added or (as with YouTube) removed.

- Collapsed card: the whole surface is the button, with a chevron that rotates
  on `transform` only.
- Free sees *"Add up to 3 sources"*, Pro *"Add up to 6 sources · PRO"* — the same
  sentence shape, so the free tier is never framed as a restriction.
- The daily allowance is a separate line, never folded into the description: two
  different numbers in one paragraph read as one confusing rule.

### Where each number comes from, and why

| Value | Source | Cost |
| --- | --- | --- |
| Source limit (admin-configurable) | server-threaded prop (`publicMultiLinkConfig`) | free |
| Which plan the visitor is on | `useEntitlements` — already fetched by the download box | free |
| Daily allowance (per-identity) | `/api/downloads/batch/policy` | **not fetched until the panel opens** |

The allowance genuinely cannot come from a prop or a memoised hook, and a
per-visitor, uncacheable round trip on every cold landing visit is what the
1.6-second budget refuses. Once the panel has been opened, the policy is lifted
back up to the button and the collapsed card shows it from then on.

### Autofocus is desktop-only

§9 asks to focus the first input on open. On a phone that raises the keyboard
over the panel the visitor just opened, so it is gated on
`matchMedia("(hover: hover) and (pointer: fine)")` — pointer type, not width,
because that is what actually decides whether a soft keyboard appears.

### Weight after this round

| Route | Before | After | Ceiling |
| --- | --- | --- | --- |
| `/` (landing) | 265.6 kB | **266.6 kB** | 275 kB |
| `/[downloader]` | 263.0 kB | **263.9 kB** | 275 kB |
| `/downloads` | 248.9 kB | **252.1 kB** | 300 kB |

+1.0 kB on the landing for the whole intro section — text, two icons, a border.
The panel is still absent from all three manifests (verified by chunk content,
since hashed filenames hide it), and `"Batch Download"` still appears nowhere in
the landing's server-rendered HTML.

### The batch gate is now routable

The multi-link gate declares `surface="multilink_batch"`, so an admin can point
it at a different network from the single-link batch — see
`docs/REWARD_AD_NETWORK_ROUTING.md`. When routed to Google's rewarded slot the
gate runs the existing verified GPT flow (a new `BATCH_UNLOCK` context reusing
the SAME `"batch"` reward-session type, so nothing server-side changes), and
declining that ad now reports a **cancellation** rather than falling open —
backing out of a rewarded ad must not hand over the download, and it costs no
allowance because `/commit` is never reached.

---

## Round 3 (2026-08-25) — ad placements, monitoring, and two UI corrections

### Two new ad zones

| Zone | Where | Formats | Skippable |
| --- | --- | --- | --- |
| `multilink_between_sources` | Between each fetch card | any (banner, native, AdSense unit, video) | no — it's furniture |
| `multilink_fetch_gate` | Full-screen vignette after a fetch | any | **yes** |

The inline slot renders **between** cards only (`i > 0`), never after the last
one — a unit after the final card is not "between" anything, it's filler
directly above the Download button, which is the one place an ad must never
be. It uses `AdSurface`, so an unseeded zone renders *nothing*: an
unconfigured site sees the panel exactly as before.

Neither zone is prefetched. The whole panel is behind a lazy gate most visitors
never open, so warming them would spend a round trip on every cold landing visit
for a placement that usually never renders.

### The fetch vignette fires once per fetch ACTION

Triggered on the falling edge of "anything is fetching" — so "Fetch all" across
three sources produces **one** ad, and a single card's Fetch produces one.
Firing per source would mean three full-screen interruptions from a single tap:
miserable, and exactly the ad density that gets a site refused (this project
already carries three AdSense rejections). It also shows nothing when a fetch
produced no results — an ad on top of an error is the worst moment for one — and
every dead end (no creative, slot never answers, premium viewer) closes itself,
because the posts are already on screen underneath.

Routable like every other moment via `multilink_fetch` in the reward-network
table (interstitial or none — it runs after the results arrive, so there's
nothing a rewarded format could unlock).

### The Download button

Owner: *"too thin and looks like a glitch and is unprofessional."* Three
problems, one root cause — it was sized like a secondary control while being the
panel's primary action:

- `h-12`/`text-sm` against the `h-14`/`text-base` the paste box's own Download
  button uses.
- `flex-1` **beside** the ZIP button, so the primary action rendered at roughly
  half width. That is what "too thin" was describing. It is full width now, and
  ZIP moved below it where a secondary action belongs.
- `disabled:opacity-45` over a saturated gradient renders as a washed,
  half-drawn slab — the "glitch". The disabled state is now a flat neutral
  surface: plainly off, rather than a damaged version of on.

### The intro description is hidden by default

Owner: *"the gray description occupied a lot of space in hero section."* The
heading and the three chips stay; the description moved behind a **Learn more**
control beside the heading, which becomes **Hide** while open and auto-dismisses
after 3 seconds.

It is an **overlay** (`absolute`), not a collapsing block — "so it doesnt occupy
space" is the requirement, and a block that expands in place occupies space by
definition and would push the paste box down, a layout shift on the page whose
CLS was measured at 0.684 once already. Hovering it pauses the timer so reading
it isn't a race.

### Admin monitoring

**Live activity** now shows `batch_authorized`, `batch_started` and
`batch_refused` with the user attached — answering "which user used multi
links" — each with a detail line (`3 sources · 16 items · free`, or *which*
limit bit on a refusal). All three, because a feed showing only successes makes
a limit that is turning people away look like an absence of demand.

**Revenue** gained two charted series: Multi-Link batches (from `batch_started`,
not `batch_authorized` — authorization happens before the ad and before the
allowance is spent, so it would count batches nobody completed) and Multi-Link
refused.

**Multi-Link activity panel** (Admin → Ads & networks): batches run, authorized,
refused, distinct members; free-allowance usage today (used up vs. still have
some left); ad impressions split by the two zones; the reward funnel with
completion rate; refusals broken down by which limit bit; and average sources
and items per batch.

To make "how many reward ads from multi-download" answerable at all, reward
sessions now carry a **surface tag**. Both batch gates open reward type
`"batch"` deliberately — identical server behaviour — so the type alone merges
them. The tag is stored on the session, so the *grant* event is attributed to
the same surface that started it even though the client never re-sends it. It is
reporting only, and can never widen what a reward grants.

**One attribution limit, stated in the panel rather than hidden:** the
free-allowance breakdown covers **signed-in members only**. The allowance is
keyed per identity, and a signed-out visitor's identity is their IP hash, which
is deliberately never written to the events table. Their batches are counted in
the totals and reported separately as `anonymousBatches` rather than folded in
and silently overstating the user count.

### Verified

`tsc` + `next build` + ESLint clean; full suite **2325/2325**. Landing 267.0 kB
gz against its 275 kB ceiling, panel still absent from every entry manifest.
Live: both new zones serve `200`, the routing table exposes `multilink_fetch`,
and the landing's HTML contains the heading and chips but **zero** occurrences
of the description.
