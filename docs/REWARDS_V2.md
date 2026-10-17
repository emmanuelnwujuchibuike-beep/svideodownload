# Rewards v2 (owner brief 2026-10-16) — status and handoff

## The owner's rules (all adjustable in admin)

| Way to earn | Rule |
| --- | --- |
| Sign up | 5 credits, once per account |
| Invite someone who signs up | 5 credits to the inviter (the invitee gets their own 5) |
| An invitee tops up or starts an AI plan | 10 credits to the inviter, every time |
| 100 real followers | 5 credits, once |
| 1,000 real followers | 50 credits, once |
| 5,000+ real followers | contact support → admin approves the affiliate upgrade |
| Affiliate | 10% of EVERY payment by members they invited (top-ups, AI plans, ads), as WITHDRAWABLE credits, for life unless revoked. Private-post subscriptions excluded. |

Everything else (downloads, AI creation, engagement, follows, saves, quests, weekly AI prizes) is OFF.

Owner decisions (2026-10-16, answered in session):
- Existing balances are **recomputed** (not only future earnings): the unspent part of credits from removed rewards is taken back; new-rule rewards that were never paid are paid. Never below zero; reward credits count as spent first, so bought credits are never taken.
- Affiliate share is paid as **withdrawable credits**, on the **full amount paid**.
- Every credit earned shows in notifications and in the AI history (wallet ledger) with how it was earned.
- "Real" follower: not suspended or hidden, confirmed email, account at least 7 days old (no bot score exists in the app — this is a rule, not detection).

## Done (committed locally, NOT pushed)

- **Migration 0255** `supabase/migrations/0255_rewards_v2.sql` (additive; NOT applied):
  rules switched once (`rulesV2Applied`, never re-applied over admin edits), `reward_default_rule` restated to v2,
  `real_follower_count`, `award_follower_milestones` (+ trigger on follows, `sweep_follower_milestones`),
  `affiliate_accounts`, `affiliate_commissions` (+ trigger on settled `ai_topup_attempts`), `grant_affiliate_commission`
  (always withdrawable), `reward_recompute_log`, `recompute_rewards_v2` (preview mode writes nothing), `follower_milestone_checks`.
- **Harness** `supabase/tests/0255_rewards_v2.pglite.mjs`: 48 checks, 0255 applied twice; mutants `spent-last`,
  `usable-aff`, `no-email` each FAIL. Real `grant_reward` (0191) and `reward_config_sync` (0189) are cut from their files.
- **Config** `lib/rewards/config.ts`: `followers`, `affiliate`, `weeklyPrizes`, `rulesV2Applied` typed, normalised and in
  the version fingerprint (so an admin save never drops them); defaults are v2.
- Weekly AI prizes obey `weeklyPrizes.enabled` (`lib/ai/weekly-top.ts`).
- Tests that pinned the old defaults now pin v2 (`lib/rewards/rewards.test.ts`, `lib/profile-landing/earn.test.ts`).

## Still to build (next session)

1. **Sweeps** in `app/api/cron/ai-reconcile/route.ts`:
   - `sweep_follower_milestones(50)` (rpc) + push for what it granted (`pushRewards`).
   - Affiliate commissions: read `affiliate_commissions` where `status = 'queued'` (bounded), convert to USD cents
     (USD as is; else `fx_minor_per_usd`; else `marketRate(currency)` from `lib/ai/character-replace/fx-rate-server`),
     call `grant_affiliate_commission(reference, usd_cents, withdrawals.creditsPerUsd)`, push.
2. **Affiliate flow**: member API to request the upgrade (server checks `real_follower_count` ≥ `affiliate.minFollowers`,
   inserts `pending`); admin API + UI to approve / decline / revoke (audit); member UI showing status and commissions.
3. **Recompute admin action**: API that previews (`p_apply false`) across members in batches and totals, then applies in
   batches (`p_apply true`, admin id as actor); UI in the admin Rewards panel with the totals before the button.
4. **Member UI**: the earn page / rewards card shows only the v2 ways (sign-up, invites, follower progress to 100 / 1k,
   the 5k upgrade); quests UI hidden when quests are off; follower-milestone progress.
5. **Admin rules UI**: fields for followers (milestones, min account age), affiliate (rate, min followers), weekly prizes.
6. **TS tests** for the sweeps, the conversion, and the admin/member APIs; PGlite stays the money proof.

## Owner must run (in order)

0253 (Part 11) → 0254 (Part 12 follow-up) → 0255. Run the recompute only after 0255 AND after the admin preview.
