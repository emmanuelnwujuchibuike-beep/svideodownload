-- 0273 — Pro / Business site plans on Flutterwave keep their attempts in the ONE attempt ledger (2026-10-23)
--
-- Owner: "Pro and business should be Flutterwave too" (Flutterwave first, Paystack the backup). A Flutterwave
-- site-plan checkout writes its attempt row BEFORE Flutterwave is called — reference frenz_site_fw_<uuid>, the
-- member, the plan (item_id 'pro' | 'business'), provider 'flutterwave', the exact USD amount — so the webhook,
-- and the 10-minute ai-reconcile sweep can verify and settle it exactly once. That needs one more allowed
-- purpose on ai_topup_attempts. Nothing else: no new table, no new ledger, no row rewritten.
--
-- Keeps every existing purpose (wallet_topup, ai_subscription, ad_campaign). NOT VALID then VALIDATE, the
-- lock-friendly pattern of 0168/0178/0271. Run by hand AFTER 0271 (Flutterwave rows need 0271's provider check).

alter table public.ai_topup_attempts drop constraint if exists ai_topup_attempts_purpose_chk;
alter table public.ai_topup_attempts
  add constraint ai_topup_attempts_purpose_chk check (purpose in ('wallet_topup', 'ai_subscription', 'ad_campaign', 'site_subscription')) not valid;
alter table public.ai_topup_attempts validate constraint ai_topup_attempts_purpose_chk;
comment on column public.ai_topup_attempts.purpose is 'What the payment is for: wallet_topup | ai_subscription | ad_campaign | site_subscription (0273, a Pro/Business plan first charge on Flutterwave).';

-- A Flutterwave Pro / Business renewal (and its first charge) is recorded by the transaction it came from, so a
-- redelivered webhook or a retry can never add a period twice (lib/ai/credits/flutterwave-plans.ts). Additive.
alter table public.subscriptions add column if not exists last_reference text;
comment on column public.subscriptions.last_reference is 'The last charge that activated or renewed this plan (0273): our first-charge reference or flw_tx_<Flutterwave transaction id>. Once-only guard for Flutterwave site plans.';
