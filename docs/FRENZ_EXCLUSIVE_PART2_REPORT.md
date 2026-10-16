# Frenz Exclusive — Part 2 report (2026-10-16)

Security, payment reliability, authorization and moderation. Committed locally as `6e87649`, **not pushed**.
Audit it builds on: `docs/FRENZ_EXCLUSIVE_PART1_AUDIT.md`. Detailed design notes: `docs/SUB_MONETIZATION.md`
("Frenz Exclusive Part 2").

## A. Changes made

- **Migration:** `supabase/migrations/0247_sub_settlement_hardening.sql`, with its PGlite test
  `supabase/tests/0247_sub_settlement.pglite.mjs`.
- **New files:**
  - `lib/sub/guards.ts`
  - `lib/sub/moderation.ts`
  - `lib/sub/upload-check.ts`
  - `app/api/admin/moderation/sub-review/route.ts`
  - `lib/testing/fake-supabase.ts`
- **Changed:**
  - `lib/sub/server.ts`, `lib/sub/posts.ts`, `lib/sub/interactions.ts`
  - `app/(app)/sub/return/page.tsx`
  - `app/api/paystack/webhook/route.ts`
  - `app/api/report/route.ts`
  - `app/api/admin/moderation/route.ts`
  - `app/api/sub/posts/[id]/route.ts`
  - `lib/social/moderation.ts`
  - `lib/creator/membership/server.ts`
  - `lib/storage/r2.ts`, `lib/rate-limit.ts`, `lib/security/audit-log.ts`
  - `lib/platform/api-registry.ts` and its test
  - `features/admin/moderation-queue.tsx`
  - `features/sub/sub-gallery.tsx` (Report buttons)
  - `features/social/report-sheet.tsx`
  - `docs/SUB_MONETIZATION.md`, `docs/HANDOFF.md`
- **New tests:**
  - `lib/sub/guards.test.ts`
  - `lib/sub/payments.server.test.ts`
  - `lib/sub/access-moderation.server.test.ts`
  - `app/api/paystack/webhook/sub-reversal.test.ts`
  - the `/api/sub` completeness test in `lib/platform/api-registry.test.ts`

## B. Security fixes

1. **Checkout race (High, audit S1).** A checkout still in progress was marked failed after about 2
   minutes, so the payment that followed was refused: the subscriber was charged and got no access.
   - Paystack's "abandoned" now counts only after **30 minutes** (the ad checkout's window).
   - Every failure records why, in `failure_source`.
   - 0247's `settle_sub_purchase` settles a failure the app assigned when Paystack later confirms the
     charge at the quoted amount and currency.
   - A Paystack reversal, or a refund that arrived before settlement, stays final.
   - Only references we issued, and only open ones, are ever sent to Paystack. A paid purchase
     answers from the database.
   - Refusals and recoveries are written to the financial audit log.
2. **Refund and dispute webhook (Medium, S2).** A failure to apply now answers **500**, and the
   delivery log stays unprocessed, so Paystack retries.
   - A repeat delivery does nothing: reversals are safe to run twice.
   - An unknown reference is acknowledged with 200, so Paystack doesn't retry it forever.
3. **Open redirect (Low, S3).** `/sub/return` now uses `safeNext()` for both the redirect and the
   Back link, so `/\evil.com` and `//evil.com` go to `/`.
4. **Removed members (R2).** A charge that arrives after the creator removed someone becomes
   `refund_due`.
   - No access is granted and the creator earns nothing.
   - It is logged as `sub_payment_after_removal`, and the subscriber sees "recorded for a refund".
   - An admin refunds it in Paystack, and the refund webhook closes it.
   - An older bug is also fixed: a refund turned `removed` into `ended`, which let the person pay
     again.
5. **ID validation (R5).** `hasActiveSub`, `startSubCheckout`, `settleOwnPendingSub` and `joinFree`
   check UUIDs themselves before building `.or()` filters.
6. **Rate limit on payment checks (R1).** The return page limits Paystack checks per IP and per
   reference (`RATE_LIMIT_SUB_VERIFY_PER_MIN`, default 12).

## C. Database changes (0247)

Additive and safe to run twice. No existing rows are rewritten.

- **New columns:**
  - `sub_purchases.failure_source`, with a check constraint
  - `sub_posts.moderated_at` / `moderated_by`
  - `sub_post_comments.hidden_at` / `hidden_by`
- **New status:** `refund_due` on `sub_purchases`.
- **Reports:** `reports_target_chk` adds `sub_post` and `sub_comment`; every older value is kept.
- **Functions:** `settle_sub_purchase` and `reverse_sub_purchase` are rewritten with the same
  signatures and return shapes. They still lock rows and stay safe to run twice. They remain
  service-role only: signed-in and signed-out users can't call them.
- **Security rules:** the RLS policies are confirmed unchanged by the test.
- **Compatibility:** it works with or without 0239, and the code works before and after it runs.

## D. Reporting and moderation

**Reporting:**
- Anyone who can see a published exclusive post's tile can report it.
- Only someone who can read a comment (a subscriber or the creator) can report it.
- The answer reveals nothing about the content, and there is one report per person and item.
- No automatic hiding of paid content: an admin decides every case.

**Admin → Moderation:**
- **Review** opens five-minute private links. It is admin-only (anyone else gets 404), and every
  review is logged as `moderation_review`.
- **Take down** archives the post or hides the comment. Nothing is deleted, the media is kept, and
  the creator can't delete it while it's archived.
- **Restore** and **Dismiss** work as for public content.
- Every action is logged as `moderation_action`.

**Upload checks:**
- No scanning service exists in this stack; adding one is the owner's decision.
- Enforced now: before a post is published, each file is read back from storage. It must really be
  a photo or video by its own first bytes, at most 50 MB per photo and 1 GB per video. HTML, SVG and
  executables are refused.

## E. Tests

**Database (PGlite):**
- 52 of 52 checks pass with 0247 applied twice, and again when 0239 hasn't run.
- With the old 0227 settle function swapped back in, 17 checks fail.

**Vitest:** 6,407 passed, plus all 6 route-weight budget tests after the build.

| Area | Tests | Against the old code |
|---|---|---|
| Payment | 11 | 7 fail |
| Webhook | 7 | 6 fail |
| Access and moderation | 16 | — |
| Guards, redirect, upload sniffing | 12 | — |
| API registry completeness | 2 | a bad entry fails both directions |

The access and moderation tests check that signed-out users and non-subscribers never get a link,
that subscribers keep access, that only admins can review or take down, and that a reporter learns
nothing.

**Other checks:**
- The type check and lint are clean, and `next build` succeeded.
- On a local `next start`, signed out:
  - `/\evil.com` and `//evil.com` both go to `/`;
  - the admin review answers 404;
  - reporting answers 401;
  - opening a post answers 401;
  - a takedown answers 403.
- A screenshot of the redirect was taken.

**Not checked visually:** the Report buttons in the viewer and the admin Review panel. There is no
signed-in test account or admin login on this machine.

## F. Outstanding risks

- **Uploads aren't scanned for content.** Moderation is reactive (reports plus admin review).
- **Retry after the grace period.** A purchase failed after 30 minutes settles when Paystack resends
  the payment webhook or the payer opens the return page. The 10-minute background job doesn't
  re-check failed purchases.
- **The rate limit is per server instance without Upstash.** The real cost protection is that only
  our own open references reach Paystack.
- **A screen recording by a subscriber can't be prevented** (unchanged).

## G. Production verification still needed

- Run 0247, then check that:
  - `sub_purchases.failure_source` exists and `refund_due` is accepted;
  - `reports` accepts `sub_post`;
  - `sub_posts.moderated_at` and `sub_post_comments.hidden_at` exist.
- Unverified from here: whether 0237–0239 ran, whether `R2_PRIVATE_BUCKET` is set, and whether
  Paystack is subscribed to `refund.processed` and `charge.dispute.create`.
- A Paystack test-mode bank transfer that takes more than 2 minutes, to confirm the race fix end
  to end.
- Production was not probed. One local check did read the production database once, a single
  read-only lookup of a fake reference that found nothing.

## H. Part 3 readiness

The access rules (`hasActiveSub`), the private media path, moderation status, and the indexes on
`sub_posts` and `creator_memberships` are in place. The Exclusive feed can filter
`status='published'` and reuse the gallery's single access check per page. Hidden posts need one
new column, `sub_posts.audience`, in Part 3's migration.

## Also done this session (separate local commits)

- **`cb14ca6`:** the full-screen ad's engagement rail now sits just above the CTA, like a TikTok ad.
  Screenshotted with and without a footer.
- **`2998750`:** the Monetag Multitag has its own switch, so the direct link can run alone (master
  on, Multitag off, per-type tags off).
- **`5aa7aee`:** a banner video plays to its end before rotating (a stalled video still moves on
  after 20 s), and ad video uploads are capped at 15 s. The cap applies to every ad format. The
  browser timing was not measured: the build for it was stopped when the machine ran low on memory.

Nothing pushed. Waiting for approval before Part 3.
