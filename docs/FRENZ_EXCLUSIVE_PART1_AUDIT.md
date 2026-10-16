# Frenz Exclusive — Part 1: foundation and architecture audit (2026-10-16)

Owner brief "FRENZ EXCLUSIVE — PART 1". An audit only: no code, schema, RLS,
payment configuration or production data was changed. Read with
`docs/SUB_MONETIZATION.md` (the system this audit found) and `docs/HANDOFF.md`.

Classification used throughout: **Complete** (reusable as is) · **Partial** ·
**Missing** · **Risk** (potentially insecure) · **Verify** (needs production or a
live test).

---

## A. Executive summary

Frenz Exclusive is **not greenfield**. On 2026-10-11/12, "SUB" was built: paid creator
subscriptions, subscriber-only ("private") posts, private storage, likes and
comments, notifications, creator earnings and withdrawals. It shipped as migrations 0227, 0231 and
0237–0239, `lib/sub/*`, `features/sub/*`, `features/members/*` and `/api/sub/*`.

The security design is sound and must be kept:

- Exclusive posts live in their **own tables** (`sub_posts`, `sub_post_media`), so no
  feed, search, share or sitemap path can leak them.
- Media sits in a **private R2 bucket** and leaves only as **five-minute presigned
  links**, minted after `hasActiveSub` passes. That check fails closed.
- Access comes **only** from a Paystack charge verified on the server, through one
  idempotent SQL function (`settle_sub_purchase`).

What is missing is mostly **product surface**. There is no Exclusive feed (posts
show only inside one creator's profile tab), no favourite creators or Favourites
feed, no creator announcements, no reporting or admin moderation of exclusive
content, no subscriber-facing subscription manager, and recurring billing is still
manual.

Two confirmed defects belong in Part 2:

1. A checkout that is still in progress can be marked `failed` after two minutes.
   The subscriber is then charged with no access.
2. A refund webhook that fails is acknowledged and never retried.

There is also a low-severity open redirect.

Production state (which migrations ran, whether `R2_PRIVATE_BUCKET` exists) **could
not be verified** from the repository.

## B. Existing architecture

| Layer | What is actually there |
|---|---|
| App | Next.js 15 App Router, React 19, TS strict. `(marketing)` public, `(app)` signed-in shell, profile at `app/u/[handle]/page.tsx` |
| Data | Supabase Postgres + RLS. Server reads use the service role (`lib/supabase/admin.ts`, `server-only`) and enforce access in code; RLS is defence-in-depth |
| Public posts | `posts` (0007) with `visibility in ('public','followers','private')`. In this table `private` means **only me**, which has nothing to do with SUB. RLS policies are `posts public read` and `posts owner all` |
| Exclusive posts | `sub_posts` (caption, public `cover_url`, status), `sub_post_media` (object_key, thumb_key 0237), `sub_post_likes` / `sub_post_comments` (0239) |
| Subscriptions | `creator_membership_settings` (price, `sub_active`, setup, `promo_dismissed_at` 0231), `creator_memberships` (one row per creator+member, `billing free/sub`, `status active/lapsed/ended/removed`, `period_end`) |
| Money | `sub_purchases` (price + fee snapshot, charged currency/amount, status), `sub_balances` (pending/available/held/debt), `sub_ledger` (unique `(kind, reference)`), `financial_audit_log`, `withdrawal_requests.source='sub'`, `sub_payout_accounts` |
| Money functions (service role only) | `settle_sub_purchase`, `reverse_sub_purchase`, `release_sub_earnings`, `request_sub_withdrawal`, `resolve_withdrawal` — each locks rows and is idempotent |
| Payment flow | `POST /api/sub/checkout` → `startSubCheckout` (server price, live FX, reuses an open checkout < 30 min) → Paystack → `/sub/return` **and** webhook `charge.success` (purpose `SUB_PURPOSE`, HMAC-SHA512 on raw body, `claimProviderEvent` dedupe) → `confirmSubPayment` re-verifies with Paystack → `settle_sub_purchase` (amount + currency must match). Safety nets: `reconcilePendingSubPurchases` in the 10-min `ai-reconcile` cron; `settleOwnPendingSub` self-heal on gallery view |
| Reversal | webhook `refund.processed` / `charge.dispute.create` → `reverse_sub_purchase` (claws back, debt if already withdrawn, shortens access); admin reversal `POST /api/admin/memberships` |
| Payouts | Paystack Transfers (`lib/rewards/paystack-payouts.ts`), webhook `transfer.*`, optional auto-withdraw (`lib/sub/payout-account.ts`) |
| Storage | Public R2 (`R2_PUBLIC_BASE_URL`) for covers; private R2 (`R2_PRIVATE_BUCKET`, `hasPrivateR2` requires it to differ from the public bucket) for originals and thumbs under `sub/<creatorId>/` |
| Notifications | `notifications` table + `sendSmartPush` (respects category settings) + `emailMember`; per-creator prefs `creator_notification_prefs` (0129) with `private_posts off/push/email/both` (0238) |
| Admin | Admin → Rewards → SUB (`features/admin/sub-admin.tsx`): rules, purchases, reversals, balances, audit log; withdrawal queue shows source |

## C. Existing features (reusable)

| Capability | State | Where |
|---|---|---|
| Paid creator subscription (30-day, one-off charge) | Complete | `lib/sub/server.ts`, 0227 |
| Price setting with admin min/max, purchase fee, period | Complete | `saveSubSettings`, `validatePrice` (`lib/creator/membership/engine.ts`) |
| Exclusive composer (gallery + camera, ≤10 items, private upload, thumbs, optional public cover) | Complete (basic UI) | `features/sub/sub-composer.tsx`, `/api/sub/posts/upload` |
| Locked gallery for non-subscribers (cover or lock tile, item count, video flag, no caption) | Complete | `listSubPosts`, `features/sub/sub-gallery.tsx` |
| Subscriber viewer (signed links, watermark with viewer @handle, hide on blur, no download/PiP/context menu) | Complete | `openSubPost`, `sub-gallery.tsx` |
| Likes and comments, subscribers + creator only | Complete | `lib/sub/interactions.ts`, 0239 |
| Screenshot-shortcut alert → Block/Ignore (desktop only; block ends access) | Complete | `lib/sub/capture.ts` |
| New-private-post push/email per creator | Complete | `lib/sub/private-notify.ts`, 0238 |
| "New subscriber" push/email/in-app | Complete | `lib/sub/notify.ts`, `settle_sub_purchase` |
| Expiry and refunds change access | Complete | `hasActiveSub` checks `period_end > now()`; `reverse_sub_purchase` |
| Creator earnings, ledger, withdrawals, saved payout account, auto-withdraw | Complete | `subEarnings`, `request_sub_withdrawal`, `features/sub/sub-withdraw.tsx` |
| Creator member dashboard (members, retention, countries, roles, remove, export CSV) | Partial (mixes free community + paid) | `features/members/creator-dashboard.tsx`, `creatorDashboard()` |
| Subscriber's own list ("access until …") | Partial | `myMemberships()`, `/members` |
| Admin money controls | Complete for money; Missing for content | `features/admin/sub-admin.tsx` |
| Blocks/mutes respected in fan-out | Complete | `excludedFor` in `private-notify.ts` |

## D. Missing features

1. **Exclusive feed.** Exclusive posts appear only in `/u/<handle>?tab=sub`, and there is no
   cross-creator feed of the creators a viewer subscribes to.
2. **Discovery previews.** Locked cards are not shown outside the profile tab.
3. **Hidden posts.** A creator can't make an exclusive post fully hidden from non-subscribers;
   today every non-subscriber sees a tile and the item count.
4. **Favourite creators and a Favourites feed.** `friend_favorites` (0021) requires a friendship,
   so it does not fit creators.
5. **Creator announcements.** `creator_notes` exists (with `min_role`) but no endpoint serves
   it to subscribers.
6. **Subscriber management for the subscriber.** No renew, no "don't renew", and no
   receipt/transaction history page. **`leave()` ends paid access at once with no refund.**
7. **Recurring billing.** Doc'd as planned. Every renewal is a new manual payment, there is no
   renewal reminder job (the `renewal_reminder` notification type exists but nothing sends it),
   and there is no expiry notice.
8. **Reporting and moderation of exclusive content.** `reports.target_type` allows only
   `post | comment | user`. No admin can list, view or take down a `sub_post`, and uploads are
   not scanned.
9. **Subscription analytics.** No per-post views, conversion from locked view to subscribe,
   or churn over time beyond 30/90-day retention.
10. **API registry.** `/api/sub/*` is not in `lib/platform/api-registry.ts`, which AGENTS.md
    requires.
11. **Behavioural tests.** The only SUB tests are source-string assertions
    (`lib/sub/private-posts.test.ts`, `features/owner-list-2026-10-12b.test.ts`). No test
    exercises `hasActiveSub`, `openSubPost` or the SQL money functions, and the PGlite harness
    mentioned in the docs lives outside the repo (`%TEMP%/pgt`).

## E. Security findings

### Confirmed (by code, plus a reproduction where noted)

| # | Severity | Finding | Evidence | Impact |
|---|---|---|---|---|
| S1 | **High** | An in-progress checkout can be marked `failed`, and the payment that follows is then refused | `confirmSubPayment` sets `status='failed'` whenever Paystack verify says `abandoned` (`lib/sub/server.ts`). `reconcilePendingSubPurchases` verifies any checkout **≥ 2 min** old, and Paystack reports a started-but-unfinished transaction as `abandoned`. `settle_sub_purchase` then answers `not_payable` for a non-`initiated` row, and **writes no audit entry** for that. The ad flow avoids this: it only releases `abandoned` after 30 min (`lib/ads-platform/payment-server.ts:516`) | A subscriber paying by bank transfer/USSD, or taking > 2 min, can be charged and get no access, while the creator gets no earnings. It is silent: only a manual refund fixes it. *Confirm in Paystack test mode.* |
| S2 | **Medium** | A failed SUB refund/dispute is acknowledged and never retried | `app/api/paystack/webhook/route.ts`: on `reverseSub` returning `ok:false` (including a DB error, status 500), the route still returns **200** `{received:true, note}`, so Paystack does not redeliver | After a refund or chargeback, the subscriber can keep access and the creator's balance is not clawed back. An admin can reverse by hand, but nothing flags it |
| S3 | **Low** | Open redirect on `/sub/return` | `next` is checked only with `startsWith("/") && !startsWith("//")`. `/\evil.com` passes, and the URL parser resolves it to `https://evil.com/` (reproduced with Node's WHATWG `URL`). It is used in `redirect(next)` (needs a paid reference, and any reference the attacker paid works again as `duplicate`) and in the "Back" link. The repo already has `safeNext()` (`lib/auth/safe-next.ts`), but this page doesn't use it | A phishing hop from a real frenzsave.com URL |

### Potential risks (need a decision or a test, not proven exploitable)

| # | Risk | Evidence |
|---|---|---|
| R1 | `/sub/return` needs no session and calls Paystack `verify` for any `frenz_sub_*` reference, with no rate limit | Paystack API cost and possible throttling. It grants nothing (settlement is bound to the purchase row) |
| R2 | A removed member can be re-activated by a checkout opened before the removal | `startSubCheckout` refuses `removed`, but `settle_sub_purchase` sets `status='active'` unconditionally |
| R3 | Exclusive uploads are not moderated, and exclusive posts can't be reported or taken down by admins | §D.8. Paid private content is the highest-risk content class for illegal material: a compliance exposure |
| R4 | Cover URL may be **any** object on the public R2 host or the Supabase host | `validCover` checks the host only, so a creator can use someone else's public image as a teaser |
| R5 | `.or(...)` filters build PostgREST strings from IDs (`hasActiveSub`, `startSubCheckout`, `joinFree`) | Safe today: every route validates a UUID first. A new caller passing raw input would be a filter injection, so validate inside the helper |
| R6 | Signed links are bearer URLs for 5 min | A subscriber can paste one elsewhere for ≤ 5 min. This is accepted by design and documented. Watermark + no-store limit it |
| R7 | Comments on exclusive posts don't check blocks between commenters, and there is no profanity/abuse filter | `lib/sub/interactions.ts` |
| R8 | `/api/sub/posts` GET (anon allowed) runs the full gallery read per request, with no rate limit | Scraping of covers/counts is possible, but that data is public by design |

### Checked and **not** vulnerable (from the code)

- **Reading exclusive posts without authorisation.** Not possible. RLS on `sub_posts` lets only the
  owner select. `sub_post_media`, `sub_post_likes` and `sub_post_comments` have **no** client
  policy. Every server path calls `hasActiveSub` first.
- **Private originals by public URL.** Not possible. Keys live only in `sub_post_media` (no client
  policy), and the bucket has no public domain.
- **Changing your own subscription status.** Not possible. `creator_memberships`, `sub_purchases` and
  `sub_balances` have SELECT-only policies for the parties. All writes go through service-role
  functions, and `EXECUTE` is revoked from `anon`/`authenticated`.
- **Editing another creator's posts or prices.** Not possible. Create, delete and PATCH use the session
  user's id with `.eq("creator_id", user.id)` or an ownership check. Settings writes use the
  session id (`/api/members` op `settings`).
- **Reading others' subscriptions.** Not possible. Policies limit reads to `auth.uid() in (creator_id, member_id)`.
- **Trusting client-supplied ids, roles, statuses or prices.** Not found. Price, fee and FX are server-side,
  access comes only from a verified charge, and amount/currency must match.
- **Alternate endpoints.** None found. Only `lib/sub/*`, `lib/creator/membership/server.ts` (reads only
  the latest `created_at`), the graph permission check and the portability export (the
  creator's own captions; no keys and no links) touch these tables.
- **Service role.** `createAdminClient` modules are `server-only`.

### Could not verify (needs production access)

- Whether 0227, 0231, 0237, 0238 and 0239 are applied. HANDOFF says 0227 was applied 2026-10-11,
  and that 0238/0239 were **not** live when probed 2026-10-12.
- Whether `R2_PRIVATE_BUCKET` is set on Vercel, and whether that bucket truly has no public access
  or r2.dev domain. If it is unset, uploads are refused (fail-safe).
- The live RLS state: whether any policy was changed by hand in the dashboard.
- The Paystack dashboard: webhook events `refund.processed` and `charge.dispute.create`
  subscribed, Transfers enabled.
- How Paystack actually reports an in-progress bank-transfer checkout (S1).

## F. UI/UX findings

- The building blocks are already there: a bottom-sheet dialog pattern (portal + `rounded-t-[28px]`),
  `primaryPill`/`quietPill` (`features/friends/ui.tsx`), the glass utilities in
  `app/globals.css`, `.dark` theming, and brand tokens in `lib/platform/design-tokens.ts`
  (primary Electric Blue `210 100% 45%/58%`, accent Royal Purple `250 100% 65%`,
  `brand-blue`/`brand-purple`).
- The SUB UI hard-codes Tailwind palette colours (`indigo-*`, `rose-*`; 11 uses in
  `sub-gallery.tsx`, 14 in `sub-tab.tsx`) instead of the tokens. The redesign should move them
  onto the tokens. AGENTS.md: "No hardcoded hex", and the token is the brand.
- Locked tiles are a flat `bg-black/35` lock with "N items" over the cover. A premium
  locked card needs the creator identity, price, a blurred cover, a "subscribe for $X/mo"
  call to action, and a consistent skeleton.
- The terminology is inconsistent. The UI says "Private posts (formerly SUB)", the URL says `?tab=sub`,
  the admin says "Private post withdrawals", and `posts.visibility='private'` means *only me* in
  `features/studio/content-manager.tsx`. "Exclusive" should become the one user-facing word,
  and the code identifiers can stay.
- The composer has no audience step in the main create flow (`app/(app)/create`). Exclusive posts
  can only be made from your own profile tab.
- The smallest upgrade set: `SubLockedCard`, `SubPostTile`, `CreatorSubscribeCard` (price +
  benefits + CTA), `ExclusiveFeedList`, the composer sheet re-skin, and `SubscriptionManager`
  (subscriber side). The viewer (`sub-gallery.tsx` `SubViewer`) only needs a visual polish.

## G. Database and architecture recommendations (minimum, additive)

| Need | Recommendation | Why not a new system |
|---|---|---|
| Hidden posts | `sub_posts.audience text default 'locked' check in ('locked','hidden')`. `listSubPosts` drops `hidden` rows for non-access viewers | Extends the existing table |
| Exclusive feed | **No new table.** A server function reading `sub_posts` where `creator_id in (my active subs)`, using index `sub_posts_creator_idx` plus the existing `creator_memberships_access_idx`, keyset-paged by `created_at`. One `hasActiveSub`-equivalent set read per page, not per post | Keeps the "separate store" rule: feeds of `posts` stay untouched |
| Favourite creators | Add kind `'favourites'` to `social_circles` (0217 has `kind` with a unique-per-owner index) and use `circle_members`. Alternatively, a `favourite` boolean on `creator_notification_prefs`. **Decide one; recommend circles** (it already has UI and rules) | Avoids a third "favourite" table |
| Announcements | Reuse `creator_notes` (has `min_role`). Add `audience 'members'/'subscribers'` and serve it through an access-checked endpoint | The table exists |
| Reporting | Widen `reports_target_chk` (and 0063/0064) to include `'sub_post'` and `'sub_comment'`. Admin read of a reported sub post mints signed links for admins only, and is audited | Reuses the moderation queue |
| Checkout race (S1) | No schema change. Treat `abandoned` as terminal only after 30+ min (as ads do). Let `settle_sub_purchase` accept a verified charge on a `failed` row whose failure was ours (status `failed` + no `reversed_at`), and audit `not_payable` | Fix in place |
| Auto-renew (later) | Paystack `authorization_code` on `sub_purchases` + `creator_memberships.renew boolean`. Re-uses `settle_sub_purchase` for each renewal charge | One subscription row per pair stays the rule |
| Analytics | One daily rollup `sub_post_daily (post_id, day, opens, locked_views)`, written in bulk from events, or reuse `ad`-style daily stats | Only if Part 7 needs it |

Each migration must be additive, idempotent, PGlite-tested twice plus a mutant, and work before
and after it runs. Rollback means dropping a new column or constraint. No data is rewritten.
Check origin's highest number first: **0246 is the latest, so the next is 0247.**

## H. Performance findings

| Finding | Evidence | Cost |
|---|---|---|
| A subscriber's gallery page signs **every** media item of 24 posts up front (≤ 240 + thumbs) | `listSubPosts` (`opening` branch) | CPU-only HMAC, no network, so it's cheap. The bigger cost is that full-size originals are eagerly *available*. Images load only when opened |
| Opening one post triggers 3 separate requests (open is cached from the gallery, then `/like` GET and `/comments` GET), each re-running the access check (≈3 queries) | `interactions.ts` `access()` | ~6–9 Supabase queries per open. Could be one combined call |
| `notifyNewPrivatePost` sends to up to 2,000 recipients **sequentially** inside `after()` | `lib/sub/private-notify.ts` | Long Vercel invocation, and it may hit `maxDuration` for big creators. Batch it, or use the existing smart-delivery queue |
| `creatorDashboard` reads up to 2,000 memberships, 2,000 feedback rows, 5,000 recognitions and 5,000 comments per load | `lib/creator/membership/server.ts` | Fine now, but will need paging and aggregation in SQL |
| Comments load up to 200 at once, with no paging | `listComments` | Small |
| Gallery tiles: first 9 eager, rest lazy. Videos `preload="metadata"`, autoplay only in the viewer | `sub-gallery.tsx` | Good, keep |
| No polling. The watermark corner timer runs only while the viewer is open | `sub-gallery.tsx:756` | Good |
| Paged by keyset (24 per page) | `listSubPosts` | Good |

## I. Implementation plan (Parts 2–8)

| Part | Objectives | Builds on | Security | Tests |
|---|---|---|---|---|
| **2 Security & access** | Fix S1, S2, S3. Address R2 (settle must not re-activate `removed`), R5 (UUID guard inside helpers) and R1 (rate-limit `/sub/return`). Add `reports` targets for sub posts plus an admin takedown path. Register `/api/sub/*` in the API registry | `lib/sub/server.ts`, webhook, `/sub/return`, 0227 functions | No RLS loosened. Admin views audited | Behavioural tests with mocked Paystack (abandoned → later success settles, refund failure → 500). Each test must fail on the current code. PGlite tests for the SQL changes |
| **3 Exclusive feed** | Cross-creator feed of subscribed creators, plus locked discovery cards. Hidden audience (`audience` column) | `listSubPosts`, `hasActiveSub`, indexes | One access set per page. Hidden rows never leave the server | Feed never includes a non-subscribed creator's caption or keys (assert the JSON) |
| **4 Profiles & studio** | Premium profile tab, creator subscribe card, composer re-skin + entry from `/create`, tokens instead of palette classes | `sub-tab.tsx`, `sub-composer.tsx`, design tokens | Same upload rules (own folder, private bucket) | Screenshots in light and dark at 375 px and desktop. Cold-entry budget unchanged |
| **5 Subscriptions** | Subscriber manager (status, access until, renew, receipt history). Change `leave()` semantics to "stop at period end". Renewal reminder + expiry notice. Optionally Paystack auto-renew | `creator_memberships`, `sub_purchases`, `renewal_reminder` type | Renewal only via a verified charge | Lifecycle tests: renew before/after expiry, refund mid-period, removed member |
| **6 Favourites & notifications** | Favourite creators (circles kind), Favourites feed, per-creator prefs UI, announcements via `creator_notes` | `social_circles`, `creator_notification_prefs`, `private-notify.ts` | Announcements are access-checked. Notifications never carry content | Fan-out is bounded and batched. Blocks/mutes are excluded |
| **7 Earnings & admin** | Creator analytics (subs over time, churn, conversion), admin content moderation of sub posts, admin subscription search | `subEarnings`, `sub-admin.tsx`, `financial_audit_log` | Admin media access audited | Admin-only API returns 403 to non-admins |
| **8 Perf, testing, polish** | Combine open/like/comments into one call. Batch the fan-out. Page the dashboard. End-to-end Playwright run (subscribe in Paystack test mode → unlock → refund → relock) | — | — | Budget test, e2e, screenshots |

Dependency note: Part 2 must land before Part 3. The feed widens the surface, so the access
and payment edge cases are fixed first. Part 5's `leave()` change affects Part 3's feed
membership, which is fine in that order.

## J. Part 2 readiness — the exact targets

- `lib/sub/server.ts`: `confirmSubPayment` (the abandoned handling), `reconcilePendingSubPurchases` (age gate), `settleOwnPendingSub`, `hasActiveSub` / `startSubCheckout` (UUID guard).
- `supabase/migrations/0247_…` (new): replace `settle_sub_purchase` so it (a) audits `not_payable`, (b) can settle a verified charge on a row we failed ourselves, and (c) does not re-activate a `removed` membership. Widen `reports_target_chk` (and the 0063/0064 target checks) to include `sub_post`, `sub_comment`.
- `app/api/paystack/webhook/route.ts`: the SUB refund/dispute branch should return 500 on a non-final error.
- `app/(app)/sub/return/page.tsx`: use `safeNext()`, and rate-limit the verify call.
- `app/api/report` + `lib/social/moderation.ts`: sub-post targets. Admin takedown sets `sub_posts.status='archived'`.
- `lib/platform/api-registry.ts`: declare `/api/sub/*`.
- Policies to keep exactly as they are: `sub posts owner`, `creator memberships parties read`, `sub purchases parties read`, `sub balances owner read`, `sub ledger owner read`, `financial audit admin read`. Also keep "no policy" on `sub_post_media`, `sub_post_likes`, `sub_post_comments` and `sub_payout_accounts`.

## K. Outstanding questions (genuine blockers)

1. **Production state.** Were 0237, 0238 and 0239 applied, and is `R2_PRIVATE_BUCKET` set? I can probe read-only from this machine if you allow it.
2. **Cancel semantics.** Should "Leave" on a paid subscription keep access until `period_end` (recommended) or end it now (current)?
3. **Favourites store.** Use a `social_circles` kind (recommended) or a flag on `creator_notification_prefs`?
4. **Auto-renew.** Should Part 5 add Paystack card auto-renewal, or keep manual renewal with reminders?
5. **Hidden posts.** Must a hidden post be invisible even in the item count/existence (recommended), or only lose its cover?
