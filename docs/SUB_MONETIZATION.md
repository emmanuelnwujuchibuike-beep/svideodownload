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
6. **Paystack is recommended** for AI top-ups and every deposit; Bachs stays
   available behind "More payment methods".

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
| Paystack "Recommended", Bachs behind "More payment methods" | `features/ai/wallet/payment-provider-picker.tsx` | built |
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
