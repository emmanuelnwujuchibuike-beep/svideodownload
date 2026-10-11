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
