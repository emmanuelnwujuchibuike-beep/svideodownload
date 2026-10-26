-- ═══════════════════════════════════════════════════════════════════════════
--  0283 — Frenz Coin closeout: withdrawals with the PIN, payout quotes, corrections, notifications (2026-10-25)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Withdrawals ──────────────────────────────────────────────────────────────
--   request_coin_withdrawal_with_pin   the PIN check (a counted 'withdrawal' attempt, 0282) and the request (0279
--                                      request_coin_withdrawal: available → held, 6% from the gross, limits, one open)
--                                      in ONE transaction. request_coin_withdrawal is no longer callable by any API role.
--   record_coin_payout_quote           the naira amount and the rate it was worked out at, written ONCE on the withdrawal
--                                      before any payout is sent (payout_currency / payout_minor / payout_fx), never
--                                      after a payout reference exists. A retry pays the recorded amount, never a new one.
--   Payouts, provider outcomes, the reconcile sweep and bank returns are the existing rails (0254 / 0256 / 0279):
--   completed settles the hold and posts the fee once; rejected / failed returns the gross; a bank return restores
--   the full gross and reverses the fee income once.
--
-- ── Corrections ──────────────────────────────────────────────────────────────
--   correct_coin_transfer              an administrator's audited correction of a completed transfer, idempotent on its
--                                      key: 'fee_refund' (the transfer's fee back to the sender, once per transfer, with
--                                      a fee-income reversal) or 'sender_credit' (a platform-funded credit to the sender,
--                                      in total never more than the transfer). The recipient is never debited.
--   apply_coin_deposit_partial_refund  an administrator applies a PARTIAL refund that 0280 put in review: its share of
--                                      the deposit (rounded up), recovered from available coins, the rest a shortfall —
--                                      never the whole deposit. Only once the deposit is released (a deposit still on
--                                      hold is answered 'deposit_on_hold'). The review row becomes 'applied'.
--
-- ── Hardening and notifications ─────────────────────────────────────────────
--   coin_pin_bytes_equal               compares a PIN key or reset-code hash over EVERY byte of the stored value (no
--                                      early exit at the first difference), used by coin_pin_check and
--                                      complete_coin_pin_reset (restated word for word otherwise).
--   coin_notification_claims           one row per notification sent (key), so a retried webhook, sweep or request
--                                      never notifies twice. Service role only.
--   notification types                 coin_deposit_update, coin_transfer_received, coin_transfer_sent,
--                                      coin_withdrawal_update, coin_pin_security (0227's list restated whole, plus these);
--                                      resolve_coin_withdrawal / reverse_coin_paid_withdrawal (0279) restated to write
--                                      coin_withdrawal_update instead of the AI-credit withdrawal_update.
--
-- Depends on 0278–0282. Run by hand AFTER 0282 (and again after re-running 0279–0282). Safe to run twice.
-- No semicolon inside any quoted string. Every dollar-quoted block is last.

-- ── the PIN attempt learns 'withdrawal' ─────────────────────────────────────
alter table public.coin_pin_attempts drop constraint if exists coin_pin_attempts_purpose_chk;
alter table public.coin_pin_attempts add constraint coin_pin_attempts_purpose_chk check (purpose in ('transfer', 'change', 'withdrawal'));

-- ── the payout quote ─────────────────────────────────────────────────────────
alter table public.withdrawal_requests add column if not exists payout_fx jsonb;
comment on column public.withdrawal_requests.payout_fx is 'Frenz Coin (0283): how payout_minor was worked out — the rate, its source and when — recorded once, before any payout is sent.';

-- ── partial refunds become 'applied' ────────────────────────────────────────
alter table public.coin_deposit_reversals drop constraint if exists coin_deposit_reversals_state_chk;
alter table public.coin_deposit_reversals add constraint coin_deposit_reversals_state_chk check (state in ('recovered', 'disputed', 'restored', 'lost', 'review', 'applied'));
alter table public.coin_deposit_reversals drop constraint if exists coin_deposit_reversals_amounts_chk;
alter table public.coin_deposit_reversals add constraint coin_deposit_reversals_amounts_chk check (
  due_cents >= 0 and recovered_cents >= 0 and recovered_cents <= due_cents and due_cents <= deposit_cents
  and shortfall_cents = due_cents - recovered_cents
  and (state not in ('review', 'applied') or due_cents = 0));

-- ── transfer corrections ─────────────────────────────────────────────────────
create table if not exists public.coin_transfer_corrections (
  id              uuid primary key default gen_random_uuid(),
  transfer_id     uuid not null references public.coin_transfers (id),
  sender_id       uuid not null,
  kind            text not null,
  amount_cents    bigint not null,
  reason          text not null,
  admin_id        uuid not null,
  idempotency_key text not null,
  ledger_id       uuid not null,
  created_at      timestamptz not null default now(),
  constraint coin_transfer_corrections_kind_chk check (kind in ('fee_refund', 'sender_credit')),
  constraint coin_transfer_corrections_amount_chk check (amount_cents > 0)
);
create unique index if not exists coin_transfer_corrections_idem_uidx on public.coin_transfer_corrections (idempotency_key);
-- a transfer fee is refunded at most once
create unique index if not exists coin_transfer_corrections_fee_once_uidx on public.coin_transfer_corrections (transfer_id) where kind = 'fee_refund';
create index if not exists coin_transfer_corrections_transfer_idx on public.coin_transfer_corrections (transfer_id);
alter table public.coin_transfer_corrections enable row level security;
revoke all on public.coin_transfer_corrections from public, anon, authenticated;
grant all on public.coin_transfer_corrections to service_role;
comment on table public.coin_transfer_corrections is 'Frenz Coin transfer corrections (0283): an administrator''s audited fee refund or platform-funded credit to the sender of a completed transfer. Append-only. The recipient is never debited.';

alter table public.platform_fee_ledger drop constraint if exists platform_fee_ledger_source_chk;
alter table public.platform_fee_ledger add constraint platform_fee_ledger_source_chk
  check (source in ('credit_transfer_fee', 'coin_transfer_fee', 'coin_withdrawal_fee', 'coin_withdrawal_fee_reversal', 'coin_transfer_fee_reversal'));
comment on column public.platform_fee_ledger.source is 'credit_transfer_fee (0278) | coin_transfer_fee | coin_withdrawal_fee | coin_withdrawal_fee_reversal (0279) | coin_transfer_fee_reversal (0283). A reversal row is fee income given back: coin fee income = fees - reversals.';

-- ── notification claims ──────────────────────────────────────────────────────
create table if not exists public.coin_notification_claims (
  key        text primary key,
  user_id    uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint coin_notification_claims_key_chk check (char_length(key) between 3 and 200)
);
create index if not exists coin_notification_claims_created_idx on public.coin_notification_claims (created_at);
alter table public.coin_notification_claims enable row level security;
revoke all on public.coin_notification_claims from public, anon, authenticated;
grant select, insert, delete on public.coin_notification_claims to service_role;
comment on table public.coin_notification_claims is 'Frenz Coin notifications (0283): one row per notification sent, keyed by what it is about, so a retried webhook, sweep or request never sends it twice. No content.';

-- ── the notification types: 0227's list (the last to set it), restated whole, plus the Frenz Coin ones ──
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction','repost_discovery','reshare',
    'wallpaper_like','wallpaper_save','wallpaper_download',
    'message','message_reaction','message_mention',
    'friend_request','friend_accepted','friend_reminder',
    'download_complete','download_failed','download_ready','processing_finished',
    'community_invite','community_accepted','community_announcement','community_event',
    'news_breaking','news_trending','news_following','news_recommended',
    'subscription_activated','payment_successful','renewal_reminder','premium_expiring',
    'ai_deposit_successful','ai_deposit_failed',
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    'streak_reminder','streak_milestone','streak_lost',
    'system','admin_broadcast',
    'post_under_review','moderation_appeal_resolved',
    -- 0187: rewards and withdrawals
    'reward_earned','referral_reward','withdrawal_update',
    -- 0226: the Professional Network (in-app only)
    'pro_request','pro_accepted','pro_recommendation',
    -- 0227: creator memberships and SUB (member_joined also pushes and emails), and a
    -- screenshot shortcut used on a subscriber-only post (pushes; Block or Ignore on the card)
    'member_joined','membership_update','sub_capture',
    -- 0283: Frenz Coin
    'coin_deposit_update','coin_transfer_received','coin_transfer_sent','coin_withdrawal_update','coin_pin_security'
  )
);

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Compare a presented key or code hash with the stored one over EVERY byte of the stored value: no early exit at the
-- first difference, a length mismatch is just one more difference. (Not a cryptographic primitive — an equality whose
-- work does not depend on where the inputs differ. Attempts are also single-use and counted, 0282.)
create or replace function public.coin_pin_bytes_equal(p_given bytea, p_stored bytea) returns boolean
language plpgsql immutable as $$
declare
  v_len  integer := coalesce(octet_length(p_stored), 0);
  v_glen integer := coalesce(octet_length(p_given), 0);
  v_diff integer;
  i      integer;
begin
  if p_given is null or p_stored is null or v_len = 0 then return false; end if;
  v_diff := case when v_glen = v_len then 0 else 1 end;
  for i in 0 .. v_len - 1 loop
    v_diff := v_diff | (get_byte(p_stored, i) # case when i < v_glen then get_byte(p_given, i) else 0 end);
  end loop;
  return v_diff = 0;
end;
$$;

-- A coin withdrawal confirmed with the PIN: the check and the request in ONE transaction. The only door to
-- request_coin_withdrawal.
create or replace function public.request_coin_withdrawal_with_pin(
  p_user uuid, p_attempt uuid, p_derived bytea, p_gross bigint, p_method text, p_details jsonb, p_idempotency text, p_rules jsonb, p_policy jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_check text;
  v_out   jsonb;
begin
  if p_user is null or p_attempt is null then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  v_check := public.coin_pin_check(p_user, p_attempt, p_derived, 'withdrawal', p_policy);
  if v_check <> 'ok' then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  v_out := public.request_coin_withdrawal(p_user, p_gross, p_method, p_details, p_idempotency, p_rules);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_user, case when (v_out ->> 'ok')::boolean then 'coin_withdrawal_authorized' else 'coin_withdrawal_refused' end, 'withdrawal',
          v_out ->> 'id', case when v_out ? 'id' then 'coin-withdrawal:' || (v_out ->> 'id') end,
          jsonb_build_object('gross_cents', p_gross, 'reason', v_out ->> 'reason', 'duplicate', coalesce((v_out ->> 'duplicate')::boolean, false)));
  return v_out;
end;
$$;

-- The naira amount for a coin withdrawal and how it was worked out — written ONCE, before any payout is sent.
-- A second call (a retried payout) answers what was recorded and changes nothing.
create or replace function public.record_coin_payout_quote(p_id uuid, p_minor bigint, p_currency text, p_fx jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w public.withdrawal_requests%rowtype;
begin
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null or v_w.source <> 'coin' then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.payout_minor is not null then
    return jsonb_build_object('ok', true, 'existing', true, 'payout_minor', v_w.payout_minor, 'payout_currency', v_w.payout_currency, 'payout_fx', v_w.payout_fx);
  end if;
  if v_w.status not in ('pending', 'reviewing', 'approved') or v_w.payout_reference is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_quotable', 'status', v_w.status);
  end if;
  if p_minor is null or p_minor <= 0 or coalesce(p_currency, '') !~ '^[A-Z]{3}$' or p_fx is null or jsonb_typeof(p_fx) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.withdrawal_requests set payout_currency = p_currency, payout_minor = p_minor, payout_fx = p_fx, updated_at = now() where id = p_id;
  insert into public.financial_audit_log (action, target_type, target_id, reference, details)
  values ('coin_payout_quoted', 'withdrawal', p_id::text, 'coin-withdrawal:' || p_id::text,
          jsonb_build_object('net_cents', v_w.net_cents, 'payout_minor', p_minor, 'payout_currency', p_currency, 'fx', p_fx));
  return jsonb_build_object('ok', true, 'existing', false, 'payout_minor', p_minor, 'payout_currency', p_currency, 'payout_fx', p_fx);
end;
$$;

-- An administrator's correction of a completed coin transfer. Idempotent on its key (the same key for something else
-- is refused). The sender only is credited, from the platform: never a debit, never the recipient.
create or replace function public.correct_coin_transfer(p_transfer uuid, p_kind text, p_amount bigint, p_reason text, p_admin uuid, p_idempotency text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t     public.coin_transfers%rowtype;
  v_ex    public.coin_transfer_corrections%rowtype;
  v_amt   bigint;
  v_given bigint;
  v_after bigint;
  v_led   uuid;
  v_id    uuid := gen_random_uuid();
  v_ref   text;
begin
  if p_transfer is null or p_admin is null or p_kind is null or p_kind not in ('fee_refund', 'sender_credit')
     or char_length(btrim(coalesce(p_reason, ''))) < 3 or coalesce(p_idempotency, '') !~ '^[A-Za-z0-9_-]{8,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_t from public.coin_transfers where id = p_transfer;
  if v_t.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform public.ensure_coin_wallet(v_t.sender_id);
  -- every correction of this sender's transfers queues on the sender's coin wallet
  perform 1 from public.ai_product_balances where user_id = v_t.sender_id and product = 'frenz_coin' for update;
  select * into v_ex from public.coin_transfer_corrections where idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.transfer_id <> p_transfer or v_ex.kind <> p_kind or (p_kind = 'sender_credit' and v_ex.amount_cents <> p_amount) then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'amount', v_ex.amount_cents);
  end if;
  if p_kind = 'fee_refund' then
    if v_t.fee_cents <= 0 then return jsonb_build_object('ok', false, 'reason', 'no_fee'); end if;
    if exists (select 1 from public.coin_transfer_corrections where transfer_id = p_transfer and kind = 'fee_refund') then
      return jsonb_build_object('ok', false, 'reason', 'already_refunded');
    end if;
    v_amt := v_t.fee_cents;
  else
    select coalesce(sum(amount_cents), 0) into v_given from public.coin_transfer_corrections where transfer_id = p_transfer and kind = 'sender_credit';
    if p_amount is null or p_amount <= 0 or v_given + p_amount > v_t.amount_cents then
      return jsonb_build_object('ok', false, 'reason', 'amount_out_of_range', 'remaining', v_t.amount_cents - v_given);
    end if;
    v_amt := p_amount;
  end if;
  v_ref := 'coin-transfer-correction:' || v_id::text;
  perform set_config('frenz.coin_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents + v_amt, updated_at = now()
   where user_id = v_t.sender_id and product = 'frenz_coin' returning balance_cents into v_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
  values (v_t.sender_id, 'frenz_coin', case when p_kind = 'fee_refund' then 'refund' else 'adjustment' end, 'settled', v_amt, v_after, 'USD', v_ref,
          case when p_kind = 'fee_refund' then 'Transfer fee refunded' else 'Transfer corrected' end, p_admin, 0,
          jsonb_build_object('transfer_id', p_transfer, 'correction_id', v_id, 'kind', p_kind))
  returning id into v_led;
  perform set_config('frenz.coin_writer', 'off', true);
  if p_kind = 'fee_refund' then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('coin_transfer_fee_reversal', v_led, v_ref, v_t.sender_id, v_amt, 'USD', 0);
  end if;
  insert into public.coin_transfer_corrections (id, transfer_id, sender_id, kind, amount_cents, reason, admin_id, idempotency_key, ledger_id)
  values (v_id, p_transfer, v_t.sender_id, p_kind, v_amt, btrim(p_reason), p_admin, p_idempotency, v_led);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'coin_transfer_corrected', 'coin_transfer', p_transfer::text, v_ref,
          jsonb_build_object('kind', p_kind, 'amount_cents', v_amt, 'sender_id', v_t.sender_id, 'reason', btrim(p_reason), 'correction_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'amount', v_amt, 'balance', v_after);
end;
$$;

-- An administrator applies a partial refund that 0280 put in review: its share of the deposit, rounded UP, recovered
-- from AVAILABLE coins (the rest is a shortfall), once. Never the whole deposit. Not while the deposit is on hold.
create or replace function public.apply_coin_deposit_partial_refund(p_review uuid, p_admin uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r       public.coin_deposit_reversals%rowtype;
  v_d       public.coin_deposits%rowtype;
  v_bal     bigint;
  v_pend    bigint;
  v_already bigint;
  v_due     bigint;
  v_take    bigint;
  v_short   bigint;
  v_id      uuid;
  v_after   bigint;
  v_ref     text;
begin
  if p_review is null or p_admin is null or char_length(btrim(coalesce(p_note, ''))) < 3 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_r from public.coin_deposit_reversals where id = p_review;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = v_r.user_id and product = 'frenz_coin' for update;
  select * into v_d from public.coin_deposits where reference = v_r.reference for update;
  select * into v_r from public.coin_deposit_reversals where id = p_review for update;
  if v_r.state = 'applied' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_r.state <> 'review' or v_r.refunded_minor is null or v_r.paid_minor is null then return jsonb_build_object('ok', false, 'reason', 'not_a_partial_refund'); end if;
  if v_d.status in ('held', 'disputed') then return jsonb_build_object('ok', false, 'reason', 'deposit_on_hold'); end if;
  select coalesce(sum(due_cents), 0) into v_already from public.coin_deposit_reversals where reference = v_r.reference and state in ('recovered', 'disputed', 'lost');
  v_due := least(greatest(0, v_d.amount_cents - v_already), ceil(v_d.amount_cents::numeric * v_r.refunded_minor / v_r.paid_minor)::bigint);
  v_take := least(v_due, greatest(coalesce(v_bal, 0) - coalesce(v_pend, 0), 0));
  v_short := v_due - v_take;
  v_ref := 'coin-deposit-reversal:' || v_r.provider || ':partial:' || p_review::text;
  insert into public.coin_deposit_reversals (provider, event_key, kind, reference, user_id, phase, paid_minor, paid_currency, refunded_minor,
                                             deposit_cents, due_cents, recovered_cents, shortfall_cents, state, ledger_reference, actor_id, note)
  values (v_r.provider, 'partial:' || p_review::text, 'refund', v_r.reference, v_r.user_id, 'released', v_r.paid_minor, v_r.paid_currency, v_r.refunded_minor,
          v_d.amount_cents, v_due, v_take, v_short, 'recovered', v_ref, p_admin, btrim(p_note))
  returning id into v_id;
  if v_take > 0 then
    perform set_config('frenz.coin_writer', 'on', true);
    update public.ai_product_balances set balance_cents = balance_cents - v_take, updated_at = now()
     where user_id = v_r.user_id and product = 'frenz_coin' returning balance_cents into v_after;
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
    values (v_r.user_id, 'frenz_coin', 'reversal', 'settled', -v_take, v_after, 'USD', v_ref, 'Taken back: part of a deposit was refunded', p_admin, 0,
            jsonb_build_object('reversal_id', v_id, 'review_id', p_review, 'deposit_reference', v_r.reference, 'phase', 'released', 'partial', true));
    perform set_config('frenz.coin_writer', 'off', true);
  end if;
  update public.coin_deposit_reversals set state = 'applied', resolved_at = now(), resolved_by = p_admin, resolution_note = btrim(p_note) where id = p_review;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'coin_deposit_partial_refund_applied', 'coin_deposit_reversal', v_id::text, v_r.reference,
          jsonb_build_object('review_id', p_review, 'due', v_due, 'recovered', v_take, 'shortfall', v_short, 'note', btrim(p_note)));
  return jsonb_build_object('ok', true, 'id', v_id, 'due', v_due, 'recovered', v_take, 'shortfall', v_short);
end;
$$;

-- ── restated word for word, with the lines marked 0283 ──────────────────────

-- 0282's PIN check: the key compared over every byte.
create or replace function public.coin_pin_check(p_user uuid, p_attempt uuid, p_derived bytea, p_purpose text, p_policy jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare
  v     public.coin_pins%rowtype;
  v_att uuid;
  v_max integer := public.coin_pin_setting(p_policy, 'maxAttempts', 5, 3, 10);
begin
  select * into v from public.coin_pins where user_id = p_user for update;
  if v.user_id is null then return 'no_pin'; end if;
  -- the attempt is used up here, whatever happens next: one PIN entry, one check
  update public.coin_pin_attempts set consumed_at = now()
   where id = p_attempt and user_id = p_user and purpose = p_purpose and consumed_at is null and expires_at > now()
  returning id into v_att;
  if v_att is null then return 'no_attempt'; end if;
  if v.locked_until is not null and v.locked_until > now() then
    update public.coin_pin_attempts set outcome = 'locked' where id = v_att;
    return 'locked';
  end if;
  if public.coin_pin_bytes_equal(p_derived, v.pin_hash) then -- 0283: every byte compared
    update public.coin_pins set failed_attempts = 0, lock_count = 0, locked_until = null, last_success_at = now(), updated_at = now() where user_id = p_user;
    update public.coin_pin_attempts set outcome = 'ok' where id = v_att;
    return 'ok';
  end if;
  -- a wrong PIN: the attempt was counted when it began
  update public.coin_pin_attempts set outcome = 'failed' where id = v_att;
  update public.coin_pins set last_failed_at = now(), updated_at = now() where user_id = p_user;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_failed', 'coin_pin', p_user::text, jsonb_build_object('purpose', p_purpose, 'failures', v.failed_attempts, 'limit', v_max));
  if v.failed_attempts >= v_max then perform public.coin_pin_lock(p_user, p_policy, 'too_many_failures'); end if;
  return 'failed';
end;
$$;

-- 0282's reset completion: the code hash compared over every byte.
create or replace function public.complete_coin_pin_reset(p_user uuid, p_code_hash bytea, p_hash bytea, p_salt bytea, p_params jsonb, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_max integer := public.coin_pin_setting(p_policy, 'resetCodeMaxAttempts', 5, 3, 10);
  v_r   public.coin_pin_resets%rowtype;
begin
  if p_user is null or p_code_hash is null or octet_length(p_code_hash) <> 32 or p_hash is null or p_salt is null
     or octet_length(p_hash) not between 32 and 64 or octet_length(p_salt) not between 16 and 64 or p_params ->> 'algorithm' is distinct from 'scrypt' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  perform 1 from public.coin_pins where user_id = p_user for update;
  select * into v_r from public.coin_pin_resets
   where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null
   for update;
  if v_r.id is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if v_r.expires_at <= now() then
    update public.coin_pin_resets set failed_at = now() where id = v_r.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if not public.coin_pin_bytes_equal(p_code_hash, v_r.code_hash) then -- 0283: every byte compared
    update public.coin_pin_resets set attempts = attempts + 1, failed_at = case when attempts + 1 >= v_max then now() end where id = v_r.id;
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
    values (p_user, 'coin_pin_reset_failed', 'coin_pin', p_user::text, jsonb_build_object('tries', v_r.attempts + 1, 'limit', v_max, 'code_dead', v_r.attempts + 1 >= v_max));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  update public.coin_pin_resets set consumed_at = now() where id = v_r.id;
  update public.coin_pins set pin_hash = p_hash, pin_salt = p_salt, params = p_params, failed_attempts = 0, lock_count = 0, locked_until = null, changed_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then
    insert into public.coin_pins (user_id, pin_hash, pin_salt, params, changed_at) values (p_user, p_hash, p_salt, p_params, now());
  end if;
  -- any PIN entry begun before the reset is void
  update public.coin_pin_attempts set consumed_at = now(), outcome = 'reset' where user_id = p_user and consumed_at is null;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, details)
  values (p_user, 'coin_pin_reset_completed', 'coin_pin', p_user::text, jsonb_build_object('via', 'email_code'));
  return jsonb_build_object('ok', true);
end;
$$;

-- 0282's attempt: 'withdrawal' is a purpose.
create or replace function public.begin_coin_pin_attempt(p_user uuid, p_purpose text, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v     public.coin_pins%rowtype;
  v_max integer := public.coin_pin_setting(p_policy, 'maxAttempts', 5, 3, 10);
  v_id  uuid;
begin
  -- 0283: 'withdrawal' is a purpose
  if p_user is null or p_purpose is null or p_purpose not in ('transfer', 'change', 'withdrawal') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v from public.coin_pins where user_id = p_user for update;
  if v.user_id is null then return jsonb_build_object('ok', false, 'reason', 'no_pin'); end if;
  if v.locked_until is not null and v.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', v.locked_until); end if;
  -- every slot is taken by attempts that began and never proved themselves: that IS the limit — lock (never forever)
  if v.failed_attempts >= v_max then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_after', public.coin_pin_lock(p_user, p_policy, 'attempts_exhausted'));
  end if;
  update public.coin_pins set failed_attempts = failed_attempts + 1, updated_at = now() where user_id = p_user;
  delete from public.coin_pin_attempts where user_id = p_user and created_at < now() - interval '1 day';
  insert into public.coin_pin_attempts (user_id, purpose, expires_at) values (p_user, p_purpose, now() + interval '2 minutes') returning id into v_id;
  return jsonb_build_object('ok', true, 'attempt_id', v_id, 'salt', encode(v.pin_salt, 'hex'), 'params', v.params);
end;
$$;

-- 0279's coin withdrawal resolution: the in-app notification is the coin type.
create or replace function public.resolve_coin_withdrawal(p_id uuid, p_status text, p_admin uuid, p_note text default null, p_payout_ref text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_w     public.withdrawal_requests%rowtype;
  v_row   uuid;
  v_after bigint;
begin
  select user_id into v_user from public.withdrawal_requests where id = p_id and source = 'coin';
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.status in ('completed', 'rejected', 'cancelled', 'reversed') then return jsonb_build_object('ok', false, 'reason', 'final', 'status', v_w.status); end if;
  if not (
       (v_w.status = 'pending' and p_status in ('reviewing', 'approved', 'processing', 'rejected', 'cancelled'))
    or (v_w.status = 'reviewing' and p_status in ('approved', 'rejected', 'cancelled'))
    or (v_w.status = 'approved' and p_status in ('processing', 'completed', 'rejected', 'cancelled'))
    or (v_w.status = 'processing' and p_status in ('completed', 'rejected'))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'from', v_w.status, 'to', p_status);
  end if;
  update public.withdrawal_requests
     set status = p_status, review_note = coalesce(p_note, review_note), reviewed_by = coalesce(p_admin, reviewed_by),
         payout_reference = coalesce(p_payout_ref, payout_reference), updated_at = now(),
         completed_at = case when p_status = 'completed' then now() else completed_at end
   where id = p_id;
  select id into v_row from public.ai_product_ledger where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal' and reference = 'coin-withdrawal:' || p_id::text;

  perform set_config('frenz.coin_writer', 'on', true);
  if p_status = 'completed' then
    update public.ai_product_ledger set status = 'settled', updated_at = now() where id = v_row and status = 'reserved';
    if found then
      update public.ai_product_balances set held_cents = held_cents - v_w.gross_cents, updated_at = now() where user_id = v_w.user_id and product = 'frenz_coin';
      if v_w.fee_cents > 0 then
        insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
        values ('coin_withdrawal_fee', v_row, 'coin-withdrawal:' || p_id::text, v_w.user_id, v_w.fee_cents, 'USD', 0)
        on conflict (source, source_ledger_id) do nothing;
      end if;
    end if;
  elsif p_status in ('rejected', 'cancelled') then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (v_w.user_id, 'frenz_coin', 'withdrawal_reversal', 'settled', v_w.gross_cents, 0, 'USD', 'coin-withdrawal:' || p_id::text, 'Withdrawal ' || p_status || ': returned', 0,
            jsonb_build_object('withdrawal_id', p_id))
    on conflict (user_id, product, kind, reference) where reference is not null do nothing;
    if found then
      update public.ai_product_balances set balance_cents = balance_cents + v_w.gross_cents, held_cents = held_cents - v_w.gross_cents, updated_at = now()
       where user_id = v_w.user_id and product = 'frenz_coin' returning balance_cents into v_after;
      update public.ai_product_ledger set balance_after_cents = v_after, updated_at = now()
       where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal_reversal' and reference = 'coin-withdrawal:' || p_id::text;
      update public.ai_product_ledger set status = 'reversed', updated_at = now() where id = v_row and status = 'reserved';
    end if;
  end if;
  perform set_config('frenz.coin_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'withdrawal_' || p_status, 'withdrawal', p_id::text, coalesce(p_payout_ref, 'coin-withdrawal:' || p_id::text), jsonb_build_object('source', 'coin', 'from', v_w.status, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'coin_withdrawal_update', -- 0283: the coin type
          jsonb_build_object('withdrawal_id', p_id, 'status', p_status, 'source', 'coin', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- 0279's bank-return reversal: the in-app notification is the coin type.
create or replace function public.reverse_coin_paid_withdrawal(p_id uuid, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid;
  v_w     public.withdrawal_requests%rowtype;
  v_row   uuid;
  v_after bigint;
begin
  select user_id into v_user from public.withdrawal_requests where id = p_id and source = 'coin';
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  perform 1 from public.ai_product_balances where user_id = v_user and product = 'frenz_coin' for update;
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.status = 'reversed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_w.status <> 'completed' then return jsonb_build_object('ok', false, 'reason', 'not_completed', 'status', v_w.status); end if;
  select id into v_row from public.ai_product_ledger where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal' and reference = 'coin-withdrawal:' || p_id::text;
  update public.withdrawal_requests set status = 'reversed', review_note = coalesce(p_note, review_note), updated_at = now() where id = p_id;
  perform set_config('frenz.coin_writer', 'on', true);
  -- the ledger row is the once-only claim: the balance moves only if it was written
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_w.user_id, 'frenz_coin', 'withdrawal_reversal', 'settled', v_w.gross_cents, 0, 'USD', 'coin-withdrawal:' || p_id::text, 'Payout returned by the bank', 0,
          jsonb_build_object('withdrawal_id', p_id, 'bank_return', true))
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if found then
    update public.ai_product_balances set balance_cents = balance_cents + v_w.gross_cents, updated_at = now()
     where user_id = v_w.user_id and product = 'frenz_coin' returning balance_cents into v_after;
    update public.ai_product_ledger set balance_after_cents = v_after, updated_at = now()
     where user_id = v_w.user_id and product = 'frenz_coin' and kind = 'withdrawal_reversal' and reference = 'coin-withdrawal:' || p_id::text;
  end if;
  perform set_config('frenz.coin_writer', 'off', true);
  if v_w.fee_cents > 0 and v_row is not null then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('coin_withdrawal_fee_reversal', v_row, 'coin-withdrawal:' || p_id::text, v_w.user_id, v_w.fee_cents, 'USD', 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'withdrawal_reversed', 'withdrawal', p_id::text, coalesce(v_w.payout_reference, 'coin-withdrawal:' || p_id::text), jsonb_build_object('source', 'coin', 'gross', v_w.gross_cents, 'fee', v_w.fee_cents, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'coin_withdrawal_update', -- 0283: the coin type
          jsonb_build_object('withdrawal_id', p_id, 'status', 'reversed', 'source', 'coin', 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'balance_after', v_after);
end;
$$;

-- 0280's reversal guard: a partial refund in review may become applied.
create or replace function public.coin_deposit_reversal_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'coin_deposit_reversals rows are permanent (0280)'; end if;
  if new.id is distinct from old.id or new.provider is distinct from old.provider or new.event_key is distinct from old.event_key or new.kind is distinct from old.kind
     or new.reference is distinct from old.reference or new.user_id is distinct from old.user_id or new.phase is distinct from old.phase
     or new.paid_minor is distinct from old.paid_minor or new.paid_currency is distinct from old.paid_currency or new.refunded_minor is distinct from old.refunded_minor
     or new.deposit_cents is distinct from old.deposit_cents or new.due_cents is distinct from old.due_cents or new.recovered_cents is distinct from old.recovered_cents
     or new.shortfall_cents is distinct from old.shortfall_cents or new.ledger_reference is distinct from old.ledger_reference or new.actor_id is distinct from old.actor_id
     or new.note is distinct from old.note or new.created_at is distinct from old.created_at then
    raise exception 'coin_deposit_reversals: a recorded reversal cannot be rewritten (0280)';
  end if;
  if new.state is distinct from old.state and not ((old.state = 'disputed' and new.state in ('restored', 'lost')) or (old.state = 'review' and new.state = 'applied')) then -- 0283: a partial refund applied
    raise exception 'coin_deposit_reversals: state % cannot become % (0280)', old.state, new.state;
  end if;
  if old.shortfall_cleared_at is not null and new.shortfall_cleared_at is distinct from old.shortfall_cleared_at then
    raise exception 'coin_deposit_reversals: a shortfall is cleared once (0280)';
  end if;
  return new;
end;
$$;

do $$
begin
  execute 'drop trigger if exists coin_transfer_corrections_append_only on public.coin_transfer_corrections';
  execute 'create trigger coin_transfer_corrections_append_only before update or delete on public.coin_transfer_corrections for each row execute function public.financial_append_only_guard()';
  execute 'revoke all on function public.coin_pin_bytes_equal(bytea, bytea) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.request_coin_withdrawal_with_pin(uuid, uuid, bytea, bigint, text, jsonb, text, jsonb, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.request_coin_withdrawal_with_pin(uuid, uuid, bytea, bigint, text, jsonb, text, jsonb, jsonb) to service_role';
  execute 'revoke all on function public.record_coin_payout_quote(uuid, bigint, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.record_coin_payout_quote(uuid, bigint, text, jsonb) to service_role';
  execute 'revoke all on function public.correct_coin_transfer(uuid, text, bigint, text, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.correct_coin_transfer(uuid, text, bigint, text, uuid, text) to service_role';
  execute 'revoke all on function public.apply_coin_deposit_partial_refund(uuid, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.apply_coin_deposit_partial_refund(uuid, uuid, text) to service_role';
  execute 'revoke all on function public.coin_pin_check(uuid, uuid, bytea, text, jsonb) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.complete_coin_pin_reset(uuid, bytea, bytea, bytea, jsonb, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.complete_coin_pin_reset(uuid, bytea, bytea, bytea, jsonb, jsonb) to service_role';
  execute 'revoke all on function public.begin_coin_pin_attempt(uuid, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.begin_coin_pin_attempt(uuid, text, jsonb) to service_role';
  execute 'revoke all on function public.resolve_coin_withdrawal(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.resolve_coin_withdrawal(uuid, text, uuid, text, text) to service_role';
  execute 'revoke all on function public.reverse_coin_paid_withdrawal(uuid, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_coin_paid_withdrawal(uuid, uuid, text) to service_role';
  execute 'revoke all on function public.coin_deposit_reversal_guard() from public, anon, authenticated, service_role';
  -- Found by the Supabase-privileges integration check: Supabase grants every new function to service_role by DEFAULT,
  -- and 0278 / 0279 / 0280 revoked these internal helpers from public / anon / authenticated only. No server code calls
  -- them; only the definer functions above do. Closed to the service role too.
  execute 'revoke all on function public.coin_take_back_held_deposit(text, text, text) from service_role';
  execute 'revoke all on function public.lift_coin_shortfall_restriction(uuid) from service_role';
  execute 'revoke all on function public.lift_topup_shortfall_restriction(uuid) from service_role';
  execute 'revoke all on function public.coin_wallet_guard() from service_role';
  execute 'revoke all on function public.coin_deposit_guard() from service_role';
  execute 'revoke all on function public.post_transfer_fee() from service_role';
  -- 🔴 the withdrawal request itself: no API role may call it any more. Only request_coin_withdrawal_with_pin reaches it.
  execute 'revoke all on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) from public, anon, authenticated, service_role';
end;
$$;
