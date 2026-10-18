# SUB — paid subscriptions, private content and withdrawals

Owner brief, 2026-10-11: "AI credit withdrawals, paid subscriptions & private
content monetization" plus "Get paid for your content". This file is Phase 1 (the
audit), the design decisions taken from it, and the build ledger.

## Phase 1 — what exists, and what is reused

| Need | Exists | Reused as |
|---|---|---|
| One wallet, AI credits | `ai_product_balances` / `ai_product_ledger` (0154–0202): Credits (cashable) and Tokens | untouched. **SUB never touches it** |
| Withdrawal qualification | 0187/0191: account age + qualifying engagements → member **applies** → an **admin approves** (`reward_profiles.qualification_status`, `qualified_at`) | the gate for credit withdrawals; for SUB only when the admin turns `requireQualification` on (off by default, owner), checked inside the SQL that holds the money |
| Withdrawal requests | `withdrawal_requests` + `request_withdrawal` / `resolve_withdrawal` (0187): held at request, returned on rejection, manual payout | extended with `source` (`credits` / `sub`) and gross / fee / net cents. A rejected SUB withdrawal returns to the SUB balance, never to the AI wallet |
| Paystack money in | checkout `initialize` + signed webhook + `claimProviderEvent` dedupe (ad campaigns 0197 are the closest pattern), live NGN rate via `resolveCheckoutRate` | the SUB purchase |
| Paystack money out | none before today | Paystack Transfers (`lib/rewards/paystack-payouts.ts`, built this session): bank list, account-name check by Paystack, fixed reference, webhook + cron verify |
| Memberships | `profile_membership_tiers` (0110, description only), and Part 13 (0227, **not yet run**) | 0227 is reworked before it ships: memberships become SUB subscriptions paid in money. The credit-billed path built earlier the same day is removed |
| Admin | Admin → Rewards (qualification review, withdrawal queue), Admin → AI Plans | a SUB section in Admin → Rewards; settings in the same config store |
| Audit log | `config_audit_log` (0093), `security_audit_log` (0053) | a dedicated `financial_audit_log` for money actions (admin identity, time, action, reference) |
| Profile | universal profile with modules and tabs (Feature 18) | a SUB POSTS tab and the Get Paid card |
| Post media | R2 bucket on a **public** CDN domain (`R2_PUBLIC_BASE_URL`), Cloudflare Stream for video | NOT usable for private content — see below |

## Decisions (and why)

1. **SUB is money, not credits.** Prices and balances are integer **USD cents**
   (the unit every Frenz price is set in). The subscriber pays through the existing
   Paystack checkout, in naira at the live rate, exactly like an AI plan or an ad
   campaign. SUB revenue sits in its own balance and ledger and can never reach the
   AI wallet, and AI credits can never pay for a SUB.
2. **Fees, at their own stage, never twice.** Purchase: the subscriber pays the
   creator's price **plus 10 %** (a $10 price costs $11, the creator earns $10, the
   platform $1). Withdrawal: **10 %** of the amount withdrawn ($100 → $10 fee, $90
   paid). Both percentages, the price bounds and the minimum withdrawal are admin
   settings. All arithmetic is integer cents, rounded in the platform's disfavour
   on the creator side only where a fraction exists.
3. **Withdrawable at once, reversible honestly.** Owner (same day): money a
   subscriber paid through Paystack is withdrawable **instantly**, **without the
   reward qualification**, and paid out **straight through Paystack**. So the
   defaults are `holdDays` 0 (a verified purchase lands in *available*),
   `requireQualification` false and `autoPayout` true — each an admin switch (Admin
   → Rewards → SUB). If an admin sets a hold, earnings sit in *pending* until it
   ends and a refund in that window simply removes them. A refund or dispute after
   the money is available takes the price back; whatever was already withdrawn
   becomes a **debt** that the next earnings settle — the balance never goes
   negative and never shows money that isn't there.
4. **Subscriber-only posts are a separate store with private media.** Adding an
   access column to `posts` would make every one of the many service-role post
   reads (feed, reels, search, trending, reposts, collections, sitemaps, previews,
   notifications) responsible for filtering it, and one miss leaks paid content.
   Instead `sub_posts` + `sub_post_media` live apart: no existing feed or search can
   read them. Media goes to a **private R2 bucket** (no public domain) and is served
   by **short-lived signed URLs minted only after an access check**. An optional
   public cover is the only thing a non-subscriber ever receives.
   ⚠️ Needs the owner to create the private bucket (see Deployment). Until it
   exists, subscriber-only uploads are refused rather than stored publicly.
5. **One subscription per creator**, 30 days of access per payment. Renewal is a new
   payment (Paystack one-off charge); automatic renewal by a saved card is planned.
6. **Paystack is the only payment provider** for AI top-ups and every deposit (Bachs
   was removed on 2026-10-17).

## Deployment steps the owner must do

- Run migrations in order (see `docs/HANDOFF.md`).
- Create a **private** R2 bucket (no public access, no custom domain) and set
  `R2_PRIVATE_BUCKET` (same account and keys as the public one).
- Paystack dashboard: enable **Transfers**, keep an NGN balance, turn **OTP for
  transfers off**; add `refund.processed` and `charge.dispute.create` events to the
  webhook (same URL).

## Private SUB posts — what protects them, honestly

Owner brief "Private SUB posts — strict privacy and anti-sharing protection".

**Enforced by the server (cannot be bypassed from the browser):**

- `sub_posts` / `sub_post_media` are their own tables. No feed, reel, search,
  trending, repost, collection, sitemap, notification or share path reads them.
- There is no URL for a SUB post and no share, copy-link, repost, embed or
  download action for one. It opens only inside its creator's SUB POSTS tab.
- Files live in the **private** bucket. A viewer without an active, paid
  subscription gets the public cover (if any), the date and an item count —
  never the caption, a storage key or a URL (`listSubPosts`).
- Opening a post re-checks the subscription (`hasActiveSub`, fails closed) and
  only then mints **five-minute** signed links (`openSubPost`). An expired,
  refunded or removed subscription gets `403` and nothing. Responses are
  `private, no-store`.
- A creator can only attach files from their own private folder.

**Deterrents in the web app (real, but limited):**

- The viewer covers the content the moment the app is hidden or loses focus
  (app switcher, notification shade, another app on top).
- Long-press save, drag, the context menu, picture-in-picture and the video
  download control are off.
- A light watermark with the **viewer's** `@handle` (never an email, phone or
  payout detail) sits over the media, so a leaked capture names who leaked it.
  Admin switch: `watermark`.
- **Screenshot alert, Block or Ignore** (owner, same day). When a viewer presses a
  screenshot **keyboard shortcut** while a SUB post is open — Print Screen on
  Windows, Cmd+Shift+3/4/5 on a Mac, Win+Shift+S when the browser sees it — the
  content is covered at once and the creator gets a push and a card in the
  notification page: "@handle took a screenshot of your SUB post", with **Block**
  and **Ignore**. Block uses the normal block and also ends that person's SUB
  access immediately (no refund); Ignore clears the alert. One alert per viewer per
  post per ten minutes. Only an active subscriber can be reported, never the
  creator (`lib/sub/capture.ts`). Viewers see "Screenshots taken with a keyboard
  shortcut are reported to the creator".
  ⚠️ **Phones send no signal at all.** iOS and Android do not tell a web page or a
  PWA when a screenshot or screen recording is taken, so a phone screenshot is
  NOT reported. The alert is never guessed from the app losing focus — that would
  accuse people who only pulled down a notification.

**What a web app cannot do:** no website or PWA can block screenshots or screen
recording on Android, iOS or desktop. The Android app is a TWA (a Chrome window
around the site, no Android source in this repo), so `FLAG_SECURE` cannot be set
from here; it would need a native wrapper change, and it applies to the whole
app window, not one post. Android 14+ also lets a native app be told about a
screenshot (`ScreenCaptureCallback`), and iOS tells native apps after the fact
(`userDidTakeScreenshotNotification`) — both need native code, so phone alerts
are planned with a native wrapper. Nothing in the product claims screenshots are
impossible.

## Payout account, auto-withdrawal and "new subscriber" alerts

- **Saved beneficiary** (`sub_payout_accounts`, 0227): the creator saves a bank
  once; Paystack names the holder when it is saved. No RLS policy — only the server
  reads it, and the app is sent the bank, the holder and the last four digits.
  Every add, change, removal and switch is in `financial_audit_log`. The withdraw
  sheet pays to it with "useSaved" — the full number never reaches a browser.
- **Auto-withdrawal** (owner: "every sub goes straight to their balance"): with the
  switch on, every verified subscription payment requests a SUB withdrawal of the
  whole available balance to the saved account, through the SAME
  `request_sub_withdrawal` (minimum, 10 % fee, one open withdrawal, replay key) and
  paid through Paystack at once while `autoPayout` is on. The replay key is the
  creator's latest ledger row, so the webhook and the return page can't ask twice.
  The 10-minute reconcile cron sweeps money a hold released later or that waited
  behind an open withdrawal (`sweepAutoWithdrawals`, bounded, one read when idle).
  Settings: SUB POSTS tab (Get Paid step 3 and the creator overview) and Members.
- **"New subscriber" push and email** (`lib/sub/notify.ts`): sent once, by the
  call that actually settled the payment, past the response; a free community
  join pushes and emails too. Push follows the creator's notification settings.

## Build ledger

| Piece | Where | State |
|---|---|---|
| Schema, money functions, audit | `supabase/migrations/0227_sub_monetization.sql` | built, PGlite-tested (incl. mutants). **Not applied** — the owner runs it |
| Fee arithmetic (price + fee, withdrawal − fee) | `lib/creator/membership/engine.ts` + SQL, tests pin both | built |
| Checkout, verify, settle, reverse | `lib/sub/server.ts`, `/api/sub/checkout`, `/sub/return`, Paystack webhook (charge, refund, dispute) | built |
| SUB withdrawals via Paystack Transfers | `lib/rewards/paystack-payouts.ts`, `/api/sub/withdraw`, webhook `transfer.*`, cron verify | built |
| Subscriber-only posts, private storage | `lib/sub/posts.ts`, `/api/sub/posts*`, `lib/storage/r2.ts` private bucket | built; needs `R2_PRIVATE_BUCKET` |
| SUB POSTS tab, notice, Get Paid (4 steps), share card, creator overview | `features/sub/sub-tab.tsx`, profile tabs | built |
| "Get paid for your content" card on the owner's profile, between the hero and the posts tray: opens the setup, then shows the subscribe link (/u/<handle>?tab=sub) with share and copy | `features/sub/sub-promo-card.tsx` | built |
| SUB withdraw sheet (bank check, live fee, replay key, history) | `features/sub/sub-withdraw.tsx` | built |
| Withdraw button on the AI credit dashboard (replaces "Explore AI tools") | `features/ai/wallet/withdraw-chooser.tsx` | built |
| Paystack "Recommended", Bachs behind "More payment methods" | `features/ai/wallet/payment-provider-picker.tsx` | superseded 2026-10-17: Bachs removed, Paystack is the only provider |
| Members dashboard and membership page on SUB | `features/members/*` | built |
| Admin: SUB rules, purchases + reversal, balances, audit log; queue shows source and net | `features/admin/sub-admin.tsx`, `lib/rewards/admin.ts` | built |
| Saved payout account, auto-withdrawal, cron sweep | `lib/sub/payout-account.ts`, `/api/sub/payout-account`, `features/sub/payout-settings.tsx` | built |
| New subscriber / member push + email | `lib/sub/notify.ts` | built |
| Screenshot-shortcut alert with Block / Ignore; block ends SUB access | `lib/sub/capture.ts`, `/api/sub/posts/[id]/capture`, notification card | built (computers only — see above) |
| Phone screenshot alerts | needs native code | planned |
| Automatic renewal by saved card | — | planned |
| Native screenshot block (Android `FLAG_SECURE`) | needs the Android wrapper | planned |

## Frenz Exclusive Part 2 — payment reliability, authorization and moderation (2026-10-16)

Audit: `docs/FRENZ_EXCLUSIVE_PART1_AUDIT.md`. Migration **0247** (`0247_sub_settlement_hardening.sql`,
PGlite-tested twice + a mutant: `supabase/tests/0247_sub_settlement.pglite.mjs`). The site works
before and after it runs; until it runs, the old settle/reverse behaviour stays (no recovery of a
prematurely failed checkout, no `refund_due`), and exclusive reports answer "arrives with the next
update".

**The checkout race (was: charged, no access).** Paystack reports a checkout the payer has not
finished as `abandoned`, and the 10-minute reconcile asked about checkouts from 2 minutes old. Now:
- `confirmSubPayment` reads our own row first: an unknown reference never reaches Paystack, a paid
  one answers from the database, a final one (refunded / disputed / reversed, or failed with a
  final `failure_source`) is never re-asked.
- `abandoned` / `failed` only become a failure after **30 minutes** (`SUB_ABANDON_GRACE_MS`, the
  ad checkout's window), and the failure records why (`sub_purchases.failure_source`).
- `settle_sub_purchase` settles a `failed` row whose failure the APP assigned (`verify_abandoned`,
  `verify_failed`, `init_refused`, or an older row with none) when Paystack later verifies the
  charge at the quoted amount and currency. A Paystack reversal (`provider_reversed`) or a refund
  that arrived before settlement (`reversal_before_payment`) is final. Refusals are audited
  (`sub_settle_refused`, `sub_payment_mismatch`); a recovery is audited (`sub_purchase_recovered`).
- A recovered failure is found by the webhook (Paystack redelivers `charge.success`) and by the
  return page. The reconcile cron still only sweeps `initiated` rows (no extra Paystack calls
  for every abandoned checkout).

**A payment after removal.** A creator's removal and the money are separate. A verified charge for
a member the creator removed is recorded as `refund_due`: no access, no creator earnings, audited
as `sub_payment_after_removal` (with creator, subscriber, amount). The subscriber sees "Your payment
was received … recorded for a refund". An admin refunds it in Paystack; the `refund.processed`
webhook closes it as `refunded` with no balance change. A refund of a paid member who was then
removed keeps them `removed` (before 0247 it turned them into `ended`, which let them pay again).

**Refund / dispute webhook.** Only a final answer is acknowledged: reversed, already reversed, or a
permanently invalid event (unknown reference). A database error or a throw answers **500** and the
delivery log stays unprocessed, so Paystack's retry runs. The SQL is idempotent on the reference,
so a redelivery can never claw back twice.

**Return page.** `next` goes through `safeNext` (`subReturnPath`); verification is rate-limited per
IP and per reference (`subVerifyLimiter`, `RATE_LIMIT_SUB_VERIFY_PER_MIN`, default 12). Without
Upstash the limiter is per-instance memory, so it bounds a burst, not a distributed flood — the
real cost guard is that only references we issued, and only open ones, ever reach Paystack.

**Identifiers.** `hasActiveSub`, `startSubCheckout`, `settleOwnPendingSub` and `joinFree` check
UUIDs themselves before building `.or(...)` filter strings.

**Reporting and moderation.** `reports.target_type` gains `sub_post` and `sub_comment`.
- Anyone who can see a published post's tile may report it; only someone who can read a comment
  may report it. The answer is `{ ok: true }` and nothing else. One report per person and target.
- No auto-hide threshold for exclusive content (three strangers could otherwise switch off a
  creator's income) and no AI scoring of paid content: an admin decides every exclusive report.
- Admin → Moderation shows them with **Review** (`/api/admin/moderation/sub-review`, admin only,
  404 to anyone else): five-minute links, every review written to `security_audit_log`
  (`moderation_review`). **Take down** archives the post (`status 'archived'`, `moderated_at/by`;
  media kept as evidence; the creator cannot delete it while archived) or hides the comment
  (`hidden_at/by`). **Restore** reverses it. Every action is `moderation_action` in the audit log.

**Upload scanning.** No scanning service exists in this stack (no image/video classifier, and
Cloudflare R2 has none built in). What IS enforced now (`lib/sub/upload-check.ts`): before a post
is published, each file is read back from private storage (one ranged read) and must really be a
photo or video of the declared kind by its own first bytes, at most 50 MB (photo) / 1 GB (video).
HTML, SVG, archives and executables wearing a media name are refused. Follow-up options, each an
owner decision because they cost money or send private content to a third party: a hash-matching
service for known illegal imagery (e.g. a PhotoDNA-class service), or a moderation model on the
worker for new uploads. Until then exclusive content is reactive: reports plus admin review.

| Piece | Where | State |
|---|---|---|
| Settlement hardening, refund_due, report targets, takedown columns | `supabase/migrations/0247_sub_settlement_hardening.sql` | built, PGlite-tested. **Not applied** — the owner runs it |
| Grace period, record-first confirm, failure reasons | `lib/sub/server.ts`, `lib/sub/guards.ts` | built, tested |
| Retryable refund/dispute webhook | `app/api/paystack/webhook/route.ts` | built, tested |
| Return page: safeNext, rate limit, "held" | `app/(app)/sub/return/page.tsx` | built |
| Exclusive reporting and admin review/takedown | `lib/sub/moderation.ts`, `/api/report`, `/api/admin/moderation`, `/api/admin/moderation/sub-review`, `features/admin/moderation-queue.tsx`, Report in `features/sub/sub-gallery.tsx` | built, tested |
| Upload byte check | `lib/sub/upload-check.ts`, `lib/storage/r2.ts` `readPrivatePrefix` | built, tested |
| `/api/sub/*` in the API registry, with a completeness test | `lib/platform/api-registry.ts` | built, tested |
| Content scanning of uploads | — | planned (owner decision) |

## Frenz Exclusive Part 3 — the Exclusive feed, locked previews and hidden posts (2026-10-16)

Migration **0248** (`0248_sub_post_audience_feed.sql`, PGlite-tested twice + a mutant:
`supabase/tests/0248_sub_post_audience.pglite.mjs`). Not applied — the owner runs it. The site works
before and after: before 0248 every post behaves as `locked` (its old behaviour), a creator who tries
to publish a hidden post is refused ("arrives with the next update", nothing is published), and the
discover section stays empty.

**Locked vs hidden (`sub_posts.audience`, default `locked`, every existing post `locked`).**

| | A viewer WITH access (the creator, an active subscriber) | A viewer WITHOUT access |
|---|---|---|
| `locked` | everything, as before | the public tile only: the creator's cover (if they set one), the date, the item count and whether there is video. Never the caption, a storage key or a link |
| `hidden` | everything, with a "Hidden / Subscribers only" mark | **nothing**: no id, no tile, no count, no date, no feed placeholder, no discover card, no notification, and no page cursor built from it |

Enforced on the server before any response is built — never a CSS hide:
- the gallery (`listSubPosts`) decides access FIRST and then reads with `audience = 'locked'` for a
  viewer without access, so even the "next page" cursor can only point at a post they may know of;
- opening a post, likes, comments, the screenshot alert and reporting answer a hidden post exactly
  like a missing one (the same 404 body) for a viewer without access (`readSubPostGate` + `visibleTo`);
- "new private post" notifications for a hidden post go to ACTIVE subscribers only;
- the discover query reads `audience = 'locked'` rows only.
The creator chooses at publish time (composer: "Locked preview" / "Hidden") and can switch any of
their own published posts from the viewer (PATCH `/api/sub/posts/[id]` `{ audience }`, own posts only;
someone else's or a taken-down post answers 404).

**The Exclusive feed (`/exclusive`, `GET /api/sub/feed`, `lib/sub/feed.ts`).**
- Signed in only (guests are sent to sign-in at the edge). Nothing is cached (`private, no-store`).
- Each page reads the viewer's ACTIVE subscriptions in one batch — the `hasActiveSub` predicate
  (active, paid, unexpired) — minus blocks in either direction and suspended or hidden creators, then
  `sub_posts` of those creators with `status = 'published'`. Expiry, removal, a refund (which ends
  the membership), a block or a takedown take effect on the very next page.
- At most `FEED_MAX_CREATORS` (150) subscribed creators feed one page (their ids travel in an
  `in (…)` filter that must fit in a request URL); the most recently renewed come first.
- Keyset paging on `(created_at desc, id desc)`, 12 per page, 13 read to know if there is more. The
  cursor is opaque (base64url of the last row's exact timestamp and id) and validated before use; a
  bare timestamp (the older gallery cursor) is still accepted. A post published while scrolling never
  shifts a page; ties on `created_at` never skip or repeat a post.
- A card carries id, creator, date, caption, item count, has-video, hidden, and ONE five-minute link
  to the first item's small preview (thumb, else the first photo; a video without a thumb shows a
  placeholder). Opening a post goes through `/api/sub/posts/[id]`, which checks access again and only
  then signs the media.
- First page only: **discover** — the latest LOCKED post of up to 8 creators the viewer follows,
  takes subscriptions now (price inside the admin's bounds) and does not subscribe to. Each card has
  the public cover only, and the creator's price + fee from the server (`subscriptionCharge`). Subscribe
  calls the existing `/api/sub/checkout`, which recomputes the price on the server and refuses any
  extra field (strict body). The feed itself never creates or settles a purchase.

**Indexes.** `sub_posts_feed_idx (creator_id, created_at desc, id desc) where status = 'published'`.
Checked with EXPLAIN in PGlite (3,000–20,000 rows): a creator's gallery page is an index-only scan on
it with no sort. The cross-creator feed query is served by the existing per-creator index plus a
top-N sort over the subscribed creators' published posts — bounded by those creators' post counts,
fine at today's scale; if a viewer's subscribed creators ever hold very many posts, a per-creator
merge (one indexed read per creator, merged in code) is the next step.

**UI.** `features/sub/exclusive-feed.tsx`: one request at a time, the previous one aborted on
unmount, ids de-duplicated across pages, the next page ~600 px before the end, "Load more" after a
failed page, skeletons sized like the cards, an empty state with a way to find creators. The
`LockedPreviewCard` there is the reusable locked card. Entry: Account → Exclusive.

**Known limitations.** Discover only uses creators the viewer follows (no ranking or global
discovery — later parts). Feed preview links last five minutes: a tab left open longer shows a
placeholder until refreshed. The profile gallery's own locked tile is unchanged (Part 4 redesigns
the profile).

## Frenz Exclusive Part 4 — creator profiles and the publishing studio (2026-10-16)

No migration. Everything builds on 0247/0248.

**The profile's Exclusive tab (`lib/sub/profile.ts` `subTabFor`, moved out of the page so its rules are tested).**
- The creator always has the tab: "Get paid for your content" until they go live, then their studio
  (share card, overview with price/pause/withdraw, New exclusive post, their gallery).
- A visitor has the tab only while the creator is live (active, priced, purchases on). A creator
  without subscriptions shows no tab and no settings.
- A visitor who blocked the creator gets no tab. A creator who blocked the visitor, or a suspended
  creator, is a 404 profile already. A creator under an admin hide keeps the tab for the friends who
  can see the profile (existing subscribers still read what they paid for) but offers no new
  subscription.

**One subscription card per tab (`features/sub/subscribe-card.tsx`, wording from `lib/sub/offer.ts`).**
It replaces the old notice, price box and "You're subscribed" banner. States:
- offer: what the visitor actually pays — price + the platform fee, e.g. "$11.00 for 30 days, $10.00
  to the creator + $1.00 service fee" (the old box showed only the creator's price, $10.00, while
  checkout charged $11.00);
- renew: a lapsed subscriber ("Your subscription ended on …"), same checkout, today's price;
- active: "Access until …. It doesn't renew automatically." — no button, no second purchase;
- signed out: "Sign in to subscribe";
- unavailable: "isn't taking new subscriptions right now" (no price shown).
A removed member is shown the plain offer (removal is never announced); checkout refuses them with
its own message. Every number is the server's; checkout recomputes it and refuses any extra field.
The membership state comes with the gallery read (`listSubPosts` → `membership`), one query.

**Publishing studio (`features/sub/sub-composer.tsx`).** Two steps: compose (media from the gallery
or camera, caption, audience, an optional public cover — offered for Locked preview only, since a
hidden post has no public tile and its cover would never be shown, so it is not uploaded), then
preview ("What subscribers see" next to "What visitors see" — a locked tile, or "Nothing" for
Hidden). Nothing is uploaded or published before Publish; closing with unsaved work asks first
("Nothing has been published or uploaded"). Uploads show a progress bar. Server side unchanged:
own private folder only, bytes checked (Part 2), audience validated (Part 3).

**Managing posts.** The creator's gallery marks every tile Locked or Hidden, and shows a post
Frenzsave took down as "Removed by Frenzsave" (not openable, not deletable — the creator sees it;
nobody else ever receives an archived row). In the viewer the creator can edit the caption
(`PATCH /api/sub/posts/[id] { caption }`: own published post only, plain text, ≤ 2,200 characters;
a taken-down post can't be edited back) and switch Locked/Hidden. Edits are rate-limited.

**Not built (later parts):** drafts saved across sessions (the composer keeps an unsent post only
while open — a draft table was not needed for "never publish by accident"), editing a post's media
or cover after publishing, subscriber management, favourites, announcements, analytics, renewals.

## Frenz Exclusive Part 5 — subscriber management, cancellation and the lifecycle (2026-10-16)

Owner decisions (2026-10-16): "Leave" on a paid subscription keeps access until the paid period
ends; renewals stay MANUAL (no stored cards, no auto-charge) with reminders.

**Migration 0250 (`0250_sub_membership_lifecycle.sql`, run after 0247–0249).** Additive only; no
function, policy or grant changed.
- `creator_memberships.cancelled_at` + `cancel_period` — "I won't renew", for one period
  (`cancel_period` = the `period_index` it belongs to; a check keeps the two together).
  `settle_sub_purchase` already moves `period_index` on with every paid renewal, so a renewal makes
  an older cancellation stale by itself.
- `sub_membership_reminders` — one row per (membership, period, reminder) sent; the primary key is
  the dedupe. RLS on, no policy, no grant to anon/authenticated.
- `creator_memberships_expiry_idx` (reminder sweep), `creator_memberships_creator_sub_idx`
  (the creator's paged list).
- PGlite: `supabase/tests/0250_sub_membership_lifecycle.pglite.mjs` — applied twice; it drives the
  REAL settle/reverse functions around a cancellation (28 checks). The mutant (no primary key, no
  checks) fails 5 of them.
- Before 0250 runs: the manager works, cancelling answers "arrives with the next update" (503),
  and the reminder sweep sends nothing (it never sends without the dedupe table).

**Cancellation (`lib/sub/subscriptions.ts` `cancelSubscription` / `resumeSubscription`; `leave()`
delegates for a paid subscription with time left).**
- Writes ONLY the two intent columns. Status and `period_end` stay as the payment left them, so
  access runs to the paid end and is never extended. No refund. Free memberships still end on the tap.
- Idempotent: a repeat answers `already` with no write. The write is conditional on the row not
  having moved (same `period_index`, same cancel value) — a renewal settling at the same moment
  wins and the member is asked to look again.
- Resume clears the intent only while paid time is running; it never grants or extends access.
- Both are audited in `financial_audit_log` (`sub_membership_cancelled` / `_resumed`).
- Access rules are unchanged: `hasActiveSub` never reads the cancellation columns. Refunds,
  disputes, removals, blocks and suspensions end access exactly as before (PGlite proves a refund
  of a cancelled subscription still ends it, and clearing the flag brings nothing back).

**No accidental second purchase (`startSubCheckout`).** A subscriber paid up beyond the last
`RENEW_WINDOW_DAYS` (3) is refused (409 `already_active`) before any purchase row is created.
Inside the window a renewal extends from the current end (settlement, unchanged); after expiry it
starts now. This is the existing extension behaviour, not new stacking.

**Subscriber manager — `/account/subscriptions`** (linked from Account, Members → Your memberships,
the membership page and the profile card). Per paid subscription: creator + profile link, state
(Active / Ending / Payment pending / Expired / Refunded / Ended / Unavailable), subscribed since,
access until (date and time), and Renew (existing checkout, returns here), Cancel (confirmation
sheet: access kept until …, nothing refunded, no automatic renewal so no charge is being stopped),
or Keep subscription. A payment in flight is shown as pending, never as access. A block or a
suspended creator shows "Unavailable" even with paid time left (as `hasActiveSub`). States are
derived in `lib/sub/lifecycle.ts` (pure, tested). APIs: `GET/POST /api/sub/subscriptions`.

**Payments and receipts.** `GET /api/sub/transactions` — the member's own `sub_purchases`, 20 a
page, keyset on (created_at, id). `/account/subscriptions/receipt/[id]` renders one row on the
server; another member's id is a 404. Statuses are distinct: Pending, Not completed, Paid, Refund
due, Refunded, Disputed, Reversed. Only a settled charge is a receipt (with the charged amount in
its currency, the USD price/fee/total, the access period and a shortened reference); an
open checkout says "This is not a receipt". Never sent: `provider_ref`, `checkout_url`,
`failure_source`, FX internals. Print / save as PDF uses the browser.

**Creator's subscriber list.** Members → directory → "Paid subscribers"
(`features/members/subscribers-list.tsx`, `GET /api/members/subscribers`): 30 a page, keyset on
(joined_at, id), "With access" or "Everyone who subscribed". Shows name, avatar, Active / Ending /
Expired / Refunded / Removed / Left / Blocked, subscribed since and access until. No amounts,
references or payment data. The creator is always the session user. Suspended accounts are not
listed (as on the dashboard). Remove uses the existing `op: remove`.

**Reminders (`lib/sub/reminders.ts`, inside the existing 10-minute `ai-reconcile` run, 25 a run).**
`renew_3d` (push + in-app + email), `renew_1d` (push + in-app), `expired` within two days of the
end (push + in-app + email). Only the most relevant one is sent. Claimed in
`sub_membership_reminders` BEFORE sending: a second or concurrent run sends nothing. Excluded:
anything not `active` (refunds that ended the period, removals, ended), a cancellation for this
period, a block either way, a suspended creator or member; "renew soon" is not sent when the
creator stopped selling. Push follows the member's settings (`renewal_reminder` category,
priority low / medium for the last day). Copy names only the creator and says it does not renew
automatically. Email has no per-type preference in this codebase (an existing gap); it is sent at
most twice per period.

**Not verified from here:** push or email delivery (no device or mail provider in tests); whether
production's GitHub Actions clock for `ai-reconcile` is running; 0250 applied.

## Frenz Exclusive Part 6 — favourite creators, notification preferences and announcements (2026-10-16)

**Migration 0251 (`0251_exclusive_favourites_announcements.sql`, run after 0250).** Additive; no
policy, grant or function changed. PGlite: `supabase/tests/0251_exclusive_favourites_announcements.pglite.mjs`
(applied twice; 32 checks; the mutant fails 12).
- `social_circles.kind` gains `favourite_creators` (0217's check restated whole).
- `creator_notification_prefs.announcements` off/push/email/both, default `push`; every other
  column on an existing row is untouched.
- `creator_membership_settings.notify_subscribed` off/push/email/both, default `both` (= today).
- `creator_notes.title`, `audience` ('members' — every existing row — or 'subscribers'),
  `idempotency_key` (unique per creator), `deleted_at`.
- `sub_fanout_jobs` (one per announcement / private post) and `sub_fanout_deliveries` (one claim per
  recipient; status claimed / handed_off / skipped / failed — never "delivered"). RLS on, no client
  policy, no grant to anon/authenticated.
- Before 0251 runs: favourites and announcements answer "arrive with the next update" (503), the
  new preference reads its default, and private-post alerts use the older direct path.

**Favourites (`lib/sub/favourites.ts`, `/api/sub/favourites`, `/exclusive/favourites`).** An
ordinary Social Circle of kind `favourite_creators`, created on first use, one per member (0217's
unique index). Safe to reuse because every circle permission in the codebase names ONE exact circle
the owner chose (`circle:<uuid>`, a memory's circle, a presence audience) — nothing grants access to
"anyone in any of my circles" — and members are never told which circles they are in. Add/remove are
idempotent and rate-limited; no self-favourite; a block either way, a suspended, hidden or missing
account all get the same refusal. Favourites grant no access (`hasActiveSub` never reads circles),
removing one never cancels a subscription, and cancelling never removes a favourite. The list is 24 a
page (keyset on added_at, member id), batched (profiles, blocks, settings in one read each), public
fields only, and leaves out blocked, suspended and hidden accounts without saying why. Cap: 500
(the existing per-circle cap). The circle also appears in the member's own circle manager, where they
may rename or edit it like any of their circles.

**Preferences.** Members: on a creator's Exclusive tab, "New private posts" and "Announcements"
(off / push / email / both, saved one column at a time; `/api/sub/notify`). Creators: a
Notifications panel in their studio explains who hears what and sets `notify_subscribed` (the
in-app row is always written by settlement). Push also follows each person's general notification
settings (category, quiet hours, caps). Email has no global per-type opt-out in this codebase (an
existing gap); it is sent only to members who chose email or both.

**Announcements (`lib/sub/announcements.ts`, `/api/sub/announcements`).** Title (≤ 80) + plain
body (≤ 2,000), audience subscribers, published time. The creator is always the session user (no
creator id in a write). Readers: the creator, or `hasActiveSub` right now — expired, refunded,
removed, ended, free and blocked members get `access: false` and nothing else; there is no
read-by-id. A retry with the same idempotency key returns the same announcement and creates no
second job. Delete is soft (kept for audit) and cancels any fan-out still running.
**Leak fixed while building this:** the membership page served EVERY creator note to every current
member, free ones included. Notes are now read through `isMembersNote` there and on the dashboard,
and the community-notes delete refuses an announcement.

**Fan-out (`lib/sub/fanout.ts`).** Used by announcements and, now, private-post alerts. Pages of
200 recipients keyed on the recipient id; the publish request runs up to 2 pages after its response,
the 10-minute `ai-reconcile` run the rest (3 jobs × 3 pages per run). A page is claimed in ONE
insert before anything is sent; only what that insert returned is sent to, so retries, the sweep and
concurrent workers never notify anyone twice; a claim whose worker died stays 'claimed' (at most once,
reported as unconfirmed). Eligibility is re-read for every page at send time: announcements → active
paid subscribers; private posts → members who opted in, and for a HIDDEN post (its CURRENT audience)
only active subscribers among them; then blocks either way and mutes (a failed read sends to nobody
and claims nobody), suspended accounts, and the item must still exist (announcement not deleted; post
published, not taken down). Payloads carry only the creator's public name and photo and a link to
their Exclusive tab — never a title, body, caption, media, storage key or preview link. The creator sees
"notifications queued for N subscribers · M opted out or not eligible · K failed", never "delivered".

**UI (owner's global UI/UX standard, applied from Part 6).** One shared segmented control
(`features/sub/segmented.tsx`: a real radiogroup, raised selected thumb, full names for assistive
tech, no animation library, motion-reduce honoured) replaces the four-block choice grids in the
member and creator panels. Favourite is a labelled toggle (`aria-pressed`, "Add to favourites" /
"In favourites" — not colour alone). Delivery is shown as labelled chips (Sending / Queued / Skipped /
Failed) with a one-line legend. The favourites row keeps the name readable on narrow phones (the
Exclusive link is icon-only below 400 px, with its accessible name). Glass only on the existing cards
(GLASS); no new blur surfaces. Every new panel is dynamically imported on the Exclusive tab, so
nothing is added to a profile's first paint for visitors who never open the tab; the favourites page
is server-rendered with its first page. Verified by screenshots at 320, 375 and 430 px in light and
dark (no horizontal overflow, no page errors, long creator names truncate). Known: the subscriber
announcements block appears after its fetch (subscribers only), a small late insert above the gallery.

**Not verified from here:** real push/email delivery; 0251 applied; the ai-reconcile clock.

## Frenz Exclusive Part 7 — creator earnings, analytics and admin (2026-10-16)

**Sources of truth (traced, not assumed).** Creator money is USD cents (the creator's price):
`settle_sub_purchase` writes `sub_ledger earning +price` and moves `sub_balances.pending/lifetime`;
`release_sub_earnings` moves pending → available (`release`); `reverse_sub_purchase` writes
`clawback −price` (from pending, else available, the rest as `debt`); `request_sub_withdrawal`
moves available → held (`withdrawal_hold −gross`); `resolve_withdrawal` moves held → withdrawn
(`withdrawal_paid`, amount 0) or back to available (`withdrawal_return +gross`). What subscribers paid
(price + fee) is on `sub_purchases` in its CHARGED currency (`charged_currency`, `charged_minor`).

| Figure | Source | Meaning |
|---|---|---|
| Available / clearing / in a withdrawal / owed back / earned all time / paid out | `sub_balances` (never summed from a page of rows) | available, pending, held, debt, lifetime (net of clawbacks), withdrawn (gross) |
| Net earnings (period) | `sub_creator_summary` | ledger `earning` − `clawback` in the period |
| New / renewals | 0252 functions | a settled purchase is NEW when no earlier settled purchase exists for that creator+subscriber |
| Settled purchase | 0252 | `paid_at` set, status not `refund_due` (a later refund doesn't un-settle it; refunds are counted by `reversed_at`) |
| Access ended | 0252 | a paid membership (not removed) whose `period_end` fell in the period |
| Cancellations / ending | 0252 | cancellations still standing for the current period (0250); ending = paid up and cancelled |
| What subscribers paid | 0252 | per charged currency, minor units — never added across currencies |
| Admin creator share / platform fee | 0252 | `price_cents` / `fee_cents` of purchases settled in the period (USD), before refunds |
| Likes / comments | `sub_post_likes`, `sub_post_comments` (visible) | counted in the period |
| Views, impressions, conversion | — | not recorded for exclusive posts, so not shown (the page says so) |

Periods are 7 / 30 / 90 days from UTC midnight N days ago — the same boundary for totals and the
daily series. Amounts are integers end to end (cents / minor units); formatting happens only for display.

**Migration 0252 (`0252_sub_reporting.sql`, after 0251).** Three read-only aggregate functions
(`sub_creator_summary`, `sub_creator_daily`, `sub_admin_summary`) — SECURITY INVOKER, EXECUTE only for
`service_role` — and four indexes for their filters (`sub_purchases (creator_id, subscriber_id,
paid_at)`, `(paid_at)`, `(reversed_at)`, `sub_ledger (creator_id, kind, created_at)`). No table,
policy or money function changed. PGlite (`supabase/tests/0252_sub_reporting.pglite.mjs`) builds the
data with the REAL settle/reverse functions and checks every figure (applied twice; the mutant fails 9).
Before it runs: balances and counts still show; period analytics say they arrive with the next update.

**Creator: `/exclusive/earnings`** (linked from the studio and Members). Server-rendered first view;
`GET /api/sub/earnings/overview?days=` and `GET /api/sub/earnings/ledger?filter=&from=&to=&cursor=`
(session user only — there is no creator parameter). Withdraw reuses the existing sheet and
`request_sub_withdrawal` (minimum, fee, one open request, idempotency — all in SQL); the page explains
why it can't be used (paused, a request in progress, below the minimum). History is the creator's own
ledger, 25 a page, keyset; withdrawal rows show their request's own status (Requested … Paid), never
"paid" before `resolve_withdrawal` completes it.

**Admin (Rewards → SUB, loaded only when opened).** Overview (`/api/admin/memberships/summary`),
search (`/api/admin/memberships/search`: creator/subscriber by @handle or id, reference part limited
to letters/digits/_ , status, date range; 25 a page; no provider ids or checkout links) and Exclusive
moderation by state (`/api/admin/memberships/moderation`: reported, removed, restored — from the
security audit log —, dismissed; posts or comments; 25 a page). Every route checks `getAdminUser()`
itself. Media is reviewed only through the existing audited sub-review.
**Moderation fixes:** remove only takes down what is up (a repeat no longer rewrites the first
admin/time), restore only brings back what an admin removed (restoring visible content is 409), and
the admin's reason plus the real outcome (`changed`, `state`) go on the audit entry.

**Part 6 review fix:** the fan-out sent a whole page (200) at once; it now hands off at most 20 at a
time, and the publish request sends only the first page (the reconcile run sends the rest).

**Not verified from here:** production data, Paystack payouts, 0252 applied.

## Frenz Exclusive Part 8 — integration, security and production-readiness audit (2026-10-16)

**Map (entry → authorization → source of truth).** Checkout `POST /api/sub/checkout` (session;
server price) → Paystack → webhook (HMAC) / `/sub/return` / 10-min reconcile → `confirmSubPayment`
re-verifies → `settle_sub_purchase` (row lock, idempotent; `sub_purchases`, `creator_memberships`,
`sub_balances`, `sub_ledger`). Access: `hasActiveSub` (membership active + paid period + no block +
neither party suspended) is the ONE predicate behind the gallery, opening a post (signed links),
likes, comments, capture, announcements and reports. Refunds: webhook / admin → `reverse_sub_purchase`.
Withdrawals: `POST /api/sub/withdraw` → `request_sub_withdrawal` (locks the balance row; one open
request by unique index; idempotency key) → Paystack Transfers or admin → `resolve_withdrawal`;
"paid" only on `completed`. Fan-out: jobs + per-recipient claims (0251), 20 hand-offs at a time.
Reporting: 0252 functions (service role only). Cron: `cronAuthorized` (secret, hashed DB token, or admin).

**Fixed and tested in this audit**
- A SUSPENDED creator's private media stayed reachable by id for existing subscribers (the feed and
  profile hid them, but `hasActiveSub` didn't check suspension). Now a suspended creator or viewer
  has no access anywhere; a failed read is no access. Regression tests in
  `lib/sub/exclusive.server.test.ts` (fail against the old code).
- The admin moderation queue response now says `private, no-store`.

**Verified (with evidence)**
- Every `/api/sub/*`, `/api/members/*` and `/api/admin/memberships*`/`moderation*` handler checks the
  session or the admin on the server, per method; creator routes take no creator id from the client.
- No reader outside `lib/sub` touches `sub_post_media` keys except the creator's own thumbnail write
  (ownership-checked). Notification payloads carry no caption/title/body/keys (tests).
- Migrations 0247–0252: every PGlite harness passes (each applies its predecessors; each applied twice)
  and every mutant fails; no destructive statement outside function bodies; every SECURITY DEFINER
  function sets `search_path`; reporting functions are not executable by anon/authenticated.
- Withdrawals: balance row locked FOR UPDATE, one open request (unique index), idempotency key;
  "Paid" shown only for `completed`.
- Every private GET in these areas answers `private, no-store`.

**Not verified (needs production or a real device)**
- Live Paystack (charges, refunds, disputes, transfers) and the webhook subscriptions in the dashboard.
- Real push / email delivery; the GitHub Actions clock for `ai-reconcile`.
- Concurrency of two simultaneous withdrawals against real Postgres (PGlite is single-connection;
  the guarantee rests on `FOR UPDATE` + the unique index, read in code).
- Migrations 0247–0252 applied in production; `R2_PRIVATE_BUCKET` set.
- Monetag's own OnClick/Multitag scripts: whether a zone runs as a tab-under (current tab replaced)
  is a Monetag dashboard setting per zone — our own ad and direct-link opens are new-tab.

**Known, recorded, not changed**
- `request_sub_withdrawal` for a creator with no `sub_balances` row compares NULL and then fails safely
  at the ledger's NOT NULL (rolls back, no money moves) with a generic error instead of "insufficient".
- Older Exclusive screens (subscriptions, favourites, feed, studio panels) use the earlier `GLASS`
  cards; the new `.ex-*` glass is on earnings/admin. Visually consistent but two class sets.

**Production verification steps (in order)**
1. Run 0247, 0248, 0249, 0250, 0251, 0252 in the Supabase SQL editor; probe the columns named in HANDOFF.
2. Paystack test mode: subscribe → unlock → refund → relock; a withdrawal → transfer → completed.
3. Confirm webhook events `charge.success`, `refund.processed`, `charge.dispute.create`, `transfer.*`.
4. Publish an announcement to a test subscriber; watch `sub_fanout_jobs` reach `done`.

## Frenz Exclusive Part 10 — notification delivery, the fan-out and the sweep (2026-10-16)

What actually carries an Exclusive notification, and what each word on the creator's screen means.

| Channel | Path | Knows |
| --- | --- | --- |
| In-app row | `sendSmartPush` → `recordInApp` (or written by `settle_sub_purchase` in the money transaction) | the row exists |
| Web Push (VAPID) | `sendSmartPush` → member settings / quiet hours / lock-screen privacy → `sendPushToUser` | per device: sent, retried once, failed, or pruned on 404/410 — in `push_delivery_log`. A push service accepting is not the phone showing it. |
| Email (Resend REST) | `emailMember` → `sendProductEmail` | Resend ACCEPTED (`sent`) or refused (`failed`); no inbox confirmation |

Fan-out (0251) is **at most once per recipient**: a recipient is claimed (primary key) before any send and a claim is never sent again. So a worker that dies mid-page leaves those recipients **unconfirmed** — shown to the creator as "Unconfirmed N", never retried, never duplicated. Exactly-once external delivery is not claimed anywhere.

Fixed in Part 10 (each with a regression test in `lib/sub/part6.server.test.ts` that failed first):

- **Early finish.** A page that held the creator's own id was read as short, so the job finished and later recipients were never notified (2 of 5 in the test). The last-page check now runs on what the database returned.
- **Lost counts.** Job counts were "the row I read + my delta", so two workers (the publish request's `after()` beside the sweep) overwrote each other, down to 0. They are now recounted from the delivery rows (three head counts) and written absolute.
- **Refused email counted as sent.** `emailMember` now returns `sent | skipped | failed` (additive; other callers ignore it). A refusal is `failed / email_failed`.
- **Suspended creator.** A suspended creator's queued alerts are cancelled ("Stopped"); a failed read of the creator fails closed (nothing sent, nothing cancelled).
- **Head-of-line.** The sweep took the 3 OLDEST pending jobs every run; now least-recently-worked first, and a failed page writes `last_error = 'page_failed'` (a code — no recipient, provider text or secret) and goes to the back. Cleared on the next good page.
- **Time budget.** The sweep starts no new page after 45 s (`SWEEP_BUDGET_MS`); the cron function is 120 s and shared with eight other sweeps.

Known limits (not changed): push failures are visible per device in the push log but a fan-out row still says "handed off" for push (the push sender never throws); there is no global email opt-out or unsubscribe link on product email — sending email for announcements is a per-creator choice the member makes ("email" / "both"); an announcement whose job insert failed gets no alerts until the creator retries the same publish (the sweep only works existing jobs). No migration.

## Frenz Exclusive Part 12 — financial verification, payout safety and disputes (2026-10-16)

**Fee rule as built:** the creator keeps the full price; the subscriber pays the purchase fee on top ($10 price + 10% = $11). Not "creator gets 90%".

**Partial refunds** (`reverseSubForRefund`): only a refund of the whole charge, in the charge's currency, reverses a purchase. A partial or other-currency refund changes nothing and is listed for an admin (Admin › Rewards › SUB › Needs review). "Mark reviewed" records that a person looked; it never moves money.

**Uncertain transfers** (`payWithdrawalViaPaystack`): only a Paystack 4xx answer (`PaystackHttpError`, `paystackRefusedForSure`) means "not sent". A timeout, dropped connection, 5xx or non-JSON reply moves the withdrawal to `processing` WITH its `frenz_wd_` reference and an "Outcome unknown" note: the money stays held, no second transfer can start, and the 10-minute sweep asks `/transfer/verify`.

**Releasing held money** (`rejectPaystackWithdrawal`, the admin route): once a reference exists, Paystack decides — success → completed instead; failed / reversed → rejected; a 404 ("no such transfer") → rejected only when the admin ticks "confirm it was never sent" (audited as `withdrawal_transfer_not_found_confirmed`); anything else → refused, still held.

**A paid payout the bank sent back** (0254 `reverse_paid_withdrawal`): `transfer.reversed` on a COMPLETED withdrawal is re-checked with `/transfer/verify` (must say `reversed`), then applied once: status `reversed`, the gross returns to available, withdrawn falls by the same, ledger `withdrawal_reversed`. Unconfirmed → the webhook answers 500 and Paystack retries. AI-credit payouts are audited for a manual return, not moved.

**A dispute the platform won** (0254 `restore_disputed_sub_purchase`): this integration only receives `charge.dispute.create`; no event for a dispute's outcome is wired up, so an ADMIN confirms the outcome in the Paystack dashboard and presses "Dispute won — restore". Once: the earning returns (debt first), and the access comes back up to that purchase's own period end (never for a removed member). Limitation: a purchase restored and then disputed AGAIN hits reverse_sub_purchase's unique clawback key and errors (retry, never a double clawback); it needs manual handling.

**Tests:** `supabase/tests/sub_financial_invariants.pglite.mjs` (83 checks, 6 mutants, 0254 applied twice) — PGlite is one connection, so concurrency rests on the row locks and unique keys, not on a multi-connection test (no local PostgreSQL here). `lib/rewards/payout-safety.server.test.ts`, `app/api/admin/memberships/reviews/route.test.ts`, `app/api/paystack/webhook/sub-reversal.test.ts` — Paystack mocked; nothing is verified against live Paystack.

**Owner must run:** 0253 (Part 11) and 0254, in order. Before 0254: a payout reversal webhook is retried (500) until it runs; the dispute restore says it arrives with 0254.

### Part 12 final verification pass (2026-10-17) — what changed

- **"Never sent" override** (`rejectPaystackWithdrawal`): a 404 releases money only once the attempt is `NOT_SENT_MIN_AGE_MS` (1 hour) old — a fresh 404 may be a transfer Paystack is still accepting. With a recorded reference it also needs a written reason (≥ 3 chars) and the audit row is written FIRST; if it can't be written, nothing is released. A Paystack withdrawal in `approved` / `processing` with NO recorded reference (sent, then the record failed) is checked with Paystack by its fixed reference instead of being released blind. Only Paystack's own JSON 404 counts; a non-JSON answer (proxy page) is "unknown". The admin panel now asks for the reason when Paystack has no such transfer (before, the confirmation could only be sent through the API).
- **Paid after release** (`settlePaystackTransfer`): a `transfer.success` for a rejected / cancelled withdrawal, confirmed by `/transfer/verify`, is recorded once (`withdrawal_paid_after_release`) and listed under "Payouts to settle by hand". There is no automatic clawback; unconfirmed → webhook retried.
- **0254 `reverse_paid_withdrawal`**: the returned gross settles any creator debt first (as `release_sub_earnings` does), the rest is available — a returned payout can't be withdrawn again while the creator owes. AI-credit reversals are audited once (redeliveries add nothing) and also listed for an admin.
- **0254 `restore_disputed_sub_purchase`**: refuses a purchase whose dispute never clawed anything back (`refund_due` → disputed: never earned, restoring would mint money). Access comes back up to the latest end of the member's still-PAID purchases (a renewal after the disputed purchase keeps its days), only while that period runs; an expired period changes no membership (a free membership is never turned into an ended paid one); a removed member stays removed.
- **Second dispute after a restore**: the clawback row's unique key makes the second reversal fail and roll back (no double clawback, no credit); a repeated restore answers "duplicate". The unique `dispute_restore` key alone also blocks a double restore (mutant `dup-restore` crashes on it).
- ~~Still open: a rejected/cancelled withdrawal returns its gross without settling debt~~ — fixed by **0256** (below).

Tests: SUB invariants 98 checks, 9 mutants all failing; payout-safety 23 (7 new ones fail against the previous code); reviews 7.

### Part 12 closure (2026-10-17) — rejection settles debt (0256) and REAL concurrency

**0256 `resolve_withdrawal`** (new migration; 0227 is live, so the function is restated whole, not edited in 0227): a rejected or cancelled SUB withdrawal settles `debt_cents` first — `pay = least(debt, gross)`, available += gross − pay, debt −= pay, held −= gross — exactly like `release_sub_earnings` and `reverse_paid_withdrawal`. The `withdrawal_return` ledger row keeps the full gross (released reserved money, never an earning; it is outside the earnings sum) and its note names the debt settled (`…, after settling a refund (N cents)`), the release row's convention; the audit row carries `debt_settled`. `reversed` is a final state too. Nothing else in the function changed (diffed against 0227). Lifetime, withdrawn and pending are untouched by a rejection.

Run order: 0253 → 0254 → 0255 → 0256 (0256 depends only on 0227).

Where a rejection is decided is unchanged: Paystack's word first (`rejectPaystackWithdrawal`), the audited never-sent override with its hour wait, reason and audit-first rule; the database refuses a second resolution of a finished withdrawal (`final`).

**Real concurrency** (`supabase/tests/sub_concurrency.pg.mjs`): a real PostgreSQL 17.4 (portable `embedded-postgres`, local only, throwaway database, READ COMMITTED like Supabase), SEPARATE connections. Each race is FORCED: A holds the lock in an open transaction, B's call is confirmed blocked on a lock in `pg_stat_activity`, then A commits; plus bursts of 12–16 simultaneous connections. Verified: two withdrawals on one balance (one holds), duplicate settlement (one earning), rejection vs payout confirmation both orders (one wins, money withdrawn or released once, debt settled once), duplicate payout reversal, duplicate dispute restore, debt repayment (release) vs a withdrawal reservation (the debt is paid first). Mutants: without the withdrawal row lock, confirm and reject BOTH succeed (money withdrawn and released — 9 failures); a double hold on one balance needs the balance locks, the one-open-withdrawal index AND the non-negative check all removed before it happens (each alone stops it), and then the 12-connection burst catches it.

## Frenz Exclusive Part 13 — security, authorization and access-control audit (2026-10-17)

Scope: every Exclusive API route (`app/api/sub/**`, `app/api/members/**`, `app/api/admin/memberships/**`, the admin withdrawal routes), the private-media path (R2), the Exclusive tables' RLS and grants, the SECURITY DEFINER functions of 0220–0257, the Paystack webhook and checkout, and admin authorization. Established by source inspection, local tests (in-memory route tests, PGlite with the real functions and policies, real PostgreSQL for concurrency) — NOT against the live Supabase project.

**Fixed**
- **H1 (High) — a user could rewrite the server-controlled fields of their own profile.** "profiles self update" (0001) has no column limit and `authenticated` holds UPDATE on every column; only `role` / `is_admin` were protected (0136/0144). Through the REST API a suspended user could clear `is_suspended` (restoring Exclusive access, checkout as a creator, payouts that trust it), clear an admin hide, set `is_verified`, `trust_score`, `reputation_bonus` or fake follower counts. **0257** adds a BEFORE UPDATE trigger that reverts those columns for end-user sessions; server-side callers (no `auth.uid()`) are unchanged; the follow-count triggers still count (nested, `pg_trigger_depth() > 1`). Proof: `supabase/tests/profiles_protect.pglite.mjs` (11 checks, 0257 applied twice; mutants `no-trigger`, `no-depth` fail).
- **H2 (High) — a suspended creator could still withdraw, automatically.** With `autoPayout` on, `requestSubWithdrawal` sends a Paystack transfer at once and checked only the `restricted` flag, so a creator suspended for fraud could empty the balance before chargebacks, by hand or through the auto-withdrawal sweep. It now refuses a suspended account (403 `suspended`) before anything is reserved, and fails closed when the profile can't be read. Proof: `lib/sub/security-boundaries.server.test.ts` (the four suspension tests fail on the previous code; a positive control shows a non-suspended creator is still auto-paid).

**Verified (no change needed)** — identity always from `getUser()` / `getAdminUser()` (server session, role re-read from the database; `is_admin`/`role` self-changes blocked by 0144); no Exclusive route accepts a user or creator id as identity (strict zod bodies refuse smuggled ids); private media: upload keys minted server-side in `sub/<own id>/`, post/thumbnail keys refused outside it, links signed only after `hasActiveSub` (active, paid, unexpired, not blocked, neither side suspended, fails closed) for 5 minutes, hidden posts indistinguishable from missing ones; covers limited to the site's own public hosts; Exclusive tables are SELECT-only to their parties, every write is service-role; every Exclusive money function is revoked from clients and pins `search_path`; webhook HMAC-SHA512 over the raw body with a timing-safe compare, replays claimed once, `charge.success` re-verified with Paystack and settled only on amount + currency match; prices and fees server-side; return paths through `safeNext`; auth cookies `SameSite=Lax` (no cross-site POST carries the session); the service-role key and Paystack/R2 secrets are server-only (built client bundles scanned: only a placeholder and a masked value).

**Open (backlog, not fixed here)**
- Medium — AI-credit withdrawals (`lib/rewards/withdrawals.ts`) check `restricted` but not `is_suspended`; they are paid by an admin, not automatically. Same rule as H2 would apply; out of this phase (AI-credit system).
- Low — the `ADMIN_EMAILS` recovery path does not require `email_confirmed_at` (sign-up still needs the address, which the real admin holds).
- Low — `/api/members/export` and `/api/sub/earnings` (own data only) have no rate limit.
- Low — a suspended creator can still create private posts/announcements; nobody can see them (every read and the fan-out check suspension).
- Informational — a signed media link stays valid for its 5 minutes after access ends (R2 presigned URLs can't be revoked); Supabase session cookies are JS-readable (`httpOnly: false`, the library default), so an XSS would expose a session — none was found in scope; advertising functions (0240–0246) were scanned only (loop-style revokes present), not changed.

Run order: 0253 → 0254 → 0255 → 0256 → 0257.

## Frenz Exclusive Part 14 — end-to-end journeys (2026-10-17)

**One journey, in order, through the real code** (`lib/sub/journey.server.test.ts`, 19 steps): visitor (no checkout signed out) → creator setup (price below the minimum refused, valid price saved, setup completed and live) → a private post (another user's file refused) → the visitor's quote (price, 10% fee on top, total) → checkout (server-priced in NGN at the pinned rate, client price refused, re-open reuses the same checkout) → an abandoned payment (stays open) → a short payment (mismatch, no access) → the verified payment (membership active 30 days, creator earns the price) → replays (return page, two signed webhooks: one earning) → access (media signed for the subscriber, refused to a stranger) → creator and subscriber views agree (same access-until) → an announcement (subscriber sees it, stranger doesn't) → cancel (twice; access and period end kept) → expiry (no media, no announcement, no second charge — renewals stay manual) → earnings → withdrawal (more than available refused, held, second while open refused) → admin-only (creator 403; admin rejects, money back once; a repeat refused) → a Paystack payout (scripted: completed, withdrawn once) → suspended creator refused. The Part 12 invariants are checked after every money step.

How: the real route handlers and `lib/sub/*`, with every RPC running the REAL migration SQL in PGlite (`lib/testing/pglite-bridge.ts`, which mirrors the in-memory tables into PGlite before each RPC and back after). MOCKED: PostgREST/auth (in-memory client + mocked session), Paystack (initialize, verify, transfers), R2 presigning, push/email senders, the FX rate. NOT covered here: RLS/grants (PGlite harnesses), concurrency (`sub_concurrency.pg.mjs`), the browser UI. PGlite is not a repo dependency: without it the journey SKIPS and a test named "PGlite NOT found" says so. Teeth: `JOURNEY_MUTANT=no-amount-check` (settle accepts a short payment) fails step 7. `dup-settle` and `dup-resolve` are not reachable from the journey (the TS layer answers a paid purchase from the database; resolve's legal-move check refuses a second rejection).

**Where each journey is covered** — lifecycle states (`lib/sub/lifecycle.test.ts`), subscriptions/cancel/resume (`subscriptions.server.test.ts`), profile tab + studio (`profile-studio.server.test.ts`), favourites, alert preferences, announcements fan-out (`part6.server.test.ts`), earnings + admin (`part7.server.test.ts`), payments race (`payments.server.test.ts`), payout safety (`lib/rewards/payout-safety.server.test.ts`), admin reviews (`app/api/admin/memberships/reviews/route.test.ts`), email consent + unsubscribe (`lib/email/consent.test.ts`, `supabase/tests/0253_*.pglite.mjs`), security boundaries (`security-boundaries.server.test.ts`), Reels ad wiring (`features/ads-platform/serve/reels-ad-slide.test.ts`).

**Not verified in Part 14** — the browser UI at mobile/desktop widths and on a real phone (no DOM test environment; a local dev server would read the production Supabase project, which this phase forbids); live Paystack, R2, Resend and Web Push; scheduled delivery (the 10-minute cron) end to end.

## Flat withdrawal fee (owner, 2026-10-17)

"An additional flat $0.2 fee for every withdraw, balance must cover before withdraw can be made … flat fee covers below $300, above flat fee is 0.5, above 500 is flat of $1." Owner's answers: every withdrawal (private-post money AND AI credits), ON TOP of the amount, tiers `< $300 → $0.20 · $300–$500 → $0.50 · > $500 → $1.00`, adjustable in Admin › Rewards › SUB (next to the minimum withdrawal, which was already adjustable).

- Setting: `frenzRewards.sub.flatFees` (`lib/rewards/config.ts`: `withdrawalFlatFeeCents`, `normalizeFlatFees`, defaults `FLAT_FEE_DEFAULTS`); accepted by `/api/admin/landing`.
- Private posts: **0258** restates `request_sub_withdrawal` with `p_flat_fee_cents` — the balance must cover amount + fee; the minimum applies to the amount; payout (`net`) = amount − the percentage fee (unchanged); `fee_cents` = percentage + flat; `gross_cents` = amount + flat, so the hold, a rejection, a payout and a bank return move the flat fee with the rest and the Part 12 invariants hold unchanged. Before 0258 runs, the server falls back to the old function (no flat fee) with a warning. The auto-withdrawal sweep withdraws `available − fee`.
- AI credits: `lib/rewards/withdrawals.ts` reserves `ceil(fee × creditsPerUsd / 100)` extra credits with the request (tier by the withdrawal's USD value); `request_withdrawal` already refuses when withdrawable credits can't cover it, and a rejection returns them. The payout is worth the requested credits only. No SQL change.
- UI: the creator withdraw sheet and the AI withdraw form show the fee and the total; Max leaves room for it; the earnings "can withdraw" reason names it.

Run order: 0253 → 0254 → 0255 → 0256 → 0257 → 0258.

## Frenz Exclusive Part 15 step 2 — the Exclusive feed: polish and first-page speed (2026-10-17)

**What changed**
- **First page from the server.** `app/(app)/exclusive/page.tsx` renders `exclusiveFeed(user.id)` for the signed-in viewer inside `<Suspense fallback={<FeedSkeleton />}>`: the header streams at once, the first cards follow in the SAME response, and the client makes no `/api/sub/feed` request after hydration. Per-user and `force-dynamic` — no shared/public cache (guarded in `lib/sub/exclusive-feed-part15.server.test.ts`). Later pages still go through `/api/sub/feed`. Because `next.config` keeps dynamic pages in the router cache for 6 h (`staleTimes.dynamic`), a first page already shown in this tab, or signed more than a minute ago, is shown and immediately re-asked (`firstPageIsReplay`).
- **Discover alongside the feed.** `lib/sub/feed.ts` reads subscriptions + the block list once (`readAccess`), starts `discover()` straight away (parallel with the feed's profile/post/media reads) and hands it the same block list — one `blocks` read per first page instead of two; a failed block-list read still empties both. Settings, follows run together.
- **Expired preview recovery.** Every page carries `issuedAt` + `previewTtl`. A tile `<img>` error counts as "expired" only when a clock says so (server time OR the browser's monotonic receipt time past ttl − 30 s); then the tile is re-signed through `POST /api/sub/feed/previews` (`feedPreviews`): access decided again from scratch, posts no longer visible are absent (tile says "isn't available any more"), at most 24 ids, rate-limited, `private, no-store`. Failures within 80 ms share one request; one request in flight (`features/sub/feed-previews.ts`). Any other failure shows "Retry preview" (tap only).
- **Opening latency.** The tile's `pointerdown` starts `GET /api/sub/posts/[id]` (read-only; access checked there) and the viewer chunk; `pointercancel` (the touch became a scroll) aborts it; the viewer claims it once (`features/sub/opened-cache.ts`, which now also holds the shared opened-post cache).
- **UI.** Verified tick from the server's `is_verified` (0257-protected); a membership chip from the membership's own `period_end` (same batched read — no per-card query): "Subscribed", "Ends <date>" in the last 3 days (renewal is manual), "Access ended" once past; "Subscribers only" moved onto the media; standard item wording (`itemsLabel`); locked discover tiles are light (no saturated gradient), one lock mark, a label pill; the card shows only the total the subscriber pays ("$11.00 for 30 days", the server's number) — owner, 2026-10-17: the fee breakdown belongs to checkout, not the feed card (guarded in `features/sub/exclusive-feed-client.test.ts`). `DiscoverCreator` still carries `feeCents`/`feePercent` from the server; the card doesn't show them.
- **Not reused: `FeedImage`.** It routes `src` through `next/image` (our server would fetch and cache a private five-minute link), adds double-tap-to-like, and sizes to the photo's own shape. The feed keeps a plain `<img>` in a fixed 4:5 box.

**Deliberately unchanged** — withdrawal fees (see below), thumbnails (the tile already prefers `thumb_key`, else the first PHOTO, never a video original; no backfill), inline like/comment counts (no batched authorized source exists; per-card requests are not allowed — backlog), the gallery's own tiles (still their own markup — backlog).

**0258 release order (open).** 0258 changes only a function signature, so there is no read-only way to detect it; the only detection is the request-time fallback in `lib/sub/server.ts`. Until 0258 runs, the private-post withdraw sheet shows (and its client check requires) a flat fee the server does not charge — the creator is under-charged, never over-charged — and the auto-withdraw sweep leaves the fee amount in the balance. Release rule: apply 0253 → 0258 in order and deploy this code with or after 0258. Not hidden in the UI (no reliable detector; a fragile probe was ruled out).

## Frenz Exclusive Part 16 — release readiness (2026-10-17)

**Migrations 0253–0258 — owner says they were run; checked read-only.** A catalog-only query (no user rows) on the production project found: 0253 `notification_settings.optional_email`; 0254 `reverse_paid_withdrawal` + the `reversed` status; 0256 `resolve_withdrawal` settling `debt_cents`; 0257 the `profiles` protect trigger; 0258 exactly one `request_sub_withdrawal`, with `p_flat_fee_cents`. So the pre-0258 fee mismatch (Part 15) is closed: the withdraw sheet, the server and the SQL charge the same flat fee.
- **Mismatch (Rewards v2, not Exclusive):** production's `sweep_follower_milestones(p_limit)` returns `integer` — the ORIGINAL 0255 — while the repo's 0255 (edited after) returns the `jsonb` grants that `lib/rewards/v2-sweeps.ts` reads. Milestone credits are still granted by the SQL; the sweep just sees no list, so it sends no push for them and logs `granted: 0`. Fix needs a NEW migration (drop + recreate the function with the jsonb return) — owner's decision; not applied.

**Fixed in Part 16 — bounded automatic preview refresh.** With a phone clock ≥ 4.5 min fast every link looks expired on arrival, so an image failing for another reason (object missing, host blocked) refreshed on every error until the limiter answered 429 (≤ 120/min, ~4 DB reads each). `mayAutoRefresh` (`features/sub/feed-previews.ts`) now allows an automatic refresh only once per link lifetime on the monotonic clock; otherwise the tile shows "Retry preview" (tap only). Tests: `features/sub/exclusive-feed-client.test.ts` (teeth: removing the bound fails 2).

**Evidence** — PGlite financial invariants (real migration SQL incl. 0258): 135 ok, 3 mutants fail. Real Postgres concurrency (separate connections; loads 0227's request function, NOT 0258's body — 0258 keeps the same `for update` lock and one-open guard): ALL OK, 2 mutants fail. Vitest focused: Exclusive/rewards/security 504/504, Paystack/admin 141/141; flat fee 19/19 incl. the $9.80 → $10.00 needed → $8.82 paid example.

**Still open (non-blocking)** — AI-credit withdrawal requests don't check `is_suspended` (admin pays them by hand); `ADMIN_EMAILS` admins aren't required to have a confirmed email; exports aren't rate-limited; a signed link keeps working for up to 5 minutes after access ends; no physical-phone test; no production time-to-first-card measurement; feed-card like/comment counts; gallery tiles not on the new preview logic.
