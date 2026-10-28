-- ═══════════════════════════════════════════════════════════════════════════
--  0293 — Frenz Gift Coin: sticker gifts in chat (Frenz Gift Coin Part 4, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A member sends a published sticker to another member of a chat they share, paying in Frenz Gift Coin (FGC). The
-- recipient earns a share of the price as PENDING FGC, released after a hold. Everything is decided here, in one
-- transaction: the sticker, its revision and price, the share, the commission and the hold come from the database and
-- the administrator's saved rules, never from the client.
--
-- ── The gifting rules (landing.frenzGift.gifting) ───────────────────────────
--   { version, recipientShareBp, commissionBp, holdHours, senderCooldownHours, dailyMaxFgc }
--     recipientShareBp + commissionBp = 10000 exactly (integer basis points), recipientShareBp >= 1
--     holdHours 1 to 2160 (earnings are never immediately spendable), senderCooldownHours 0 to 2160,
--     dailyMaxFgc the rolling 24-hour total a member may gift, in FGC minor units
--   gift_rules_check validates (lib/gift/gifting-rules.ts is the same check). save_frenz_gift_gifting is the ONLY
--   writer: version-checked, validated, audited, under the 0292 writer flag (settings_gift_guard). No rules = no
--   gifting (gifting_not_configured). Nothing is filled in: the first values are whatever an administrator saves.
--
-- ── The arithmetic (exact integers) ──────────────────────────────────────────
--   recipient share = floor(price x recipientShareBp / 10000), commission = price - share (the remainder of the
--   rounding is the platform's). A share under 1 unit is refused (below_minimum).
--
-- ── A gift (send_gift_with_pin), one transaction ─────────────────────────────
--   the PIN (coin_pin_check, purpose 'gift', the attempt consumed here) -> a replayed key answers the original (a
--   different body is idempotency_conflict) -> rules -> the conversation: not secret, the sender an active member (and
--   allowed to send in an admins-only group), the recipient an active member, explicit in a group, no block either way,
--   not suspended, not the sender -> the sticker: published, not archived, AND at the revision and price the member was
--   shown (else sticker_changed with the current ones) -> both FGC wallets locked in user-id order -> the sender's
--   standing (gift_send_block_reason) -> the sender's due earnings released -> the daily limit -> AVAILABLE FGC.
--   Ledger (all FGC, the sender pays the price, the recipient receives the share as pending):
--     sender     gift_sent      -share         settled
--     sender     gift_fee       -commission    settled  (when > 0) -> platform_fee_ledger gift_commission, once
--     recipient  gift_earning   +share         RESERVED (pending until hold_until)
--   gift_sends keeps the whole record: sticker id AND revision (a foreign key into gift_sticker_revisions, so it can
--   only name a revision that existed), price, share, commission, the rules and sticker snapshots, the hold, the ledger
--   ids, and the chat message's client id ('gift-' || id), which the app sends through the ordinary message path.
--
-- ── Earnings release (no cron) ───────────────────────────────────────────────
--   release_gift_earnings(user): under the recipient's wallet lock, every pending gift whose hold has passed becomes
--   spendable (gift_earning reserved -> settled, pending falls), ONCE (the lock plus a conditional status change).
--   Called lazily: by send_gift (the sender's own), gift_wallet_summary (wallet reads) and the server before a
--   conversion. Earnings of a sender who is currently under financial review (gift_sender_frozen) stay pending.
--
-- ── Chargebacks: no reliable provenance, so a conservative rule ─────────────
--   FC is fungible (deposits, transfers, rewards, corrections, conversions) and fgc_conversions records no source
--   deposit, so a gift can NOT be traced to the deposit that paid for it. Therefore:
--     · a member may not gift while their FC wallet is restricted, suspended or owes a recovery (0281), while one of
--       their deposits is held or disputed or has an open dispute, or within senderCooldownHours of a deposit settling
--     · a recipient's pending earnings from a sender under review are NOT released (frozen, not reversed)
--     · reverse_gift: an administrator's audited decision, for a PENDING gift only: the recipient's pending share is
--       taken back, the sender is refunded the full price in FGC (where the existing recovery can reach it), the
--       commission income is reversed, once. Released earnings are never clawed back automatically. An unrecoverable
--       loss stays visible as the existing coin deposit shortfall (0280) and in financial_audit_log.
--
-- ── Also ─────────────────────────────────────────────────────────────────────
--   messages_gift_guard: a chat message of kind 'gift' must name a real gift of that sender, in that conversation,
--   with the gift's own client id, and its metadata can never be edited (no forged or altered gift bubbles).
--   gift_sticker_gallery: the published, not archived catalogue for members. begin_coin_pin_attempt learns 'gift'.
--
-- Depends on 0011, 0041, 0043, 0050, 0062, 0227, 0278, 0279, 0280, 0281, 0282, 0283, 0290, 0291, 0292.
-- Run by hand AFTER 0292. Safe to run twice. No semicolon inside any quoted string or comment. Dollar-quoted blocks last.

-- ── the PIN attempt learns 'gift' ───────────────────────────────────────────
alter table public.coin_pin_attempts drop constraint if exists coin_pin_attempts_purpose_chk;
alter table public.coin_pin_attempts add constraint coin_pin_attempts_purpose_chk check (purpose in ('transfer', 'change', 'withdrawal', 'gift'));

-- ── the gift ledger kinds (0290's lists restated, plus five, all FGC only) ──
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal', 'transfer_out', 'transfer_in', 'transfer_fee', 'deposit',
                  'conversion_in', 'conversion_out', 'conversion_fee',
                  'gift_sent', 'gift_fee', 'gift_earning', 'gift_earning_reversal', 'gift_refund'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal', 'transfer_in', 'deposit', 'conversion_in', 'gift_earning', 'gift_refund') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal', 'withdrawal', 'transfer_out', 'transfer_fee', 'conversion_out', 'conversion_fee', 'gift_sent', 'gift_fee', 'gift_earning_reversal') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_gift_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_gift_kind_chk
  check (product <> 'frenz_gift' or kind in ('conversion_in', 'conversion_out', 'conversion_fee', 'adjustment', 'gift_sent', 'gift_fee', 'gift_earning', 'gift_earning_reversal', 'gift_refund'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_gift_only_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_gift_only_chk
  check (kind not in ('gift_sent', 'gift_fee', 'gift_earning', 'gift_earning_reversal', 'gift_refund') or product = 'frenz_gift');

-- ── fee income: the gift commission (0290's list restated, plus two) ────────
alter table public.platform_fee_ledger drop constraint if exists platform_fee_ledger_source_chk;
alter table public.platform_fee_ledger add constraint platform_fee_ledger_source_chk
  check (source in ('credit_transfer_fee', 'coin_transfer_fee', 'coin_withdrawal_fee', 'coin_withdrawal_fee_reversal', 'coin_transfer_fee_reversal',
                    'fc_to_fgc_conversion_fee', 'fgc_to_fc_conversion_fee', 'gift_commission', 'gift_commission_reversal'));
comment on column public.platform_fee_ledger.source is 'credit_transfer_fee (0278) | coin_transfer_fee | coin_withdrawal_fee | coin_withdrawal_fee_reversal (0279) | coin_transfer_fee_reversal (0283) | fc_to_fgc_conversion_fee (unit FGC) | fgc_to_fc_conversion_fee (unit USD) (0290) | gift_commission | gift_commission_reversal (unit FGC, 0293). A reversal row is fee income given back.';

-- ── the gift record ─────────────────────────────────────────────────────────
create table if not exists public.gift_sends (
  id                 uuid primary key,
  sender_id          uuid not null,
  recipient_id       uuid not null,
  conversation_id    uuid not null,
  message_client_id  text not null,
  sticker_id         uuid not null,
  sticker_revision   integer not null,
  price_fgc          bigint not null,
  recipient_share    bigint not null,
  commission         bigint not null,
  share_bp           integer not null,
  commission_bp      integer not null,
  hold_hours         integer not null,
  hold_until         timestamptz not null,
  rules_version      bigint not null,
  rules_snapshot     jsonb not null,
  sticker_snapshot   jsonb not null,
  idempotency_key    text not null,
  status             text not null default 'pending',
  sent_ledger_id     uuid not null,
  fee_ledger_id      uuid,
  earning_ledger_id  uuid not null,
  released_at        timestamptz,
  reversed_at        timestamptz,
  reversed_by        uuid,
  reversal_reason    text,
  created_at         timestamptz not null default now(),
  constraint gift_sends_people_chk check (sender_id <> recipient_id),
  constraint gift_sends_amounts_chk check (
    price_fgc > 0 and recipient_share > 0 and commission >= 0 and recipient_share + commission = price_fgc
    and share_bp between 1 and 10000 and commission_bp between 0 and 9999 and share_bp + commission_bp = 10000
    and recipient_share = div(price_fgc::numeric * share_bp, 10000)),
  constraint gift_sends_hold_chk check (hold_hours between 1 and 2160 and hold_until >= created_at + make_interval(hours => hold_hours)),
  constraint gift_sends_status_chk check (status in ('pending', 'released', 'reversed')),
  constraint gift_sends_state_chk check (
    (status = 'pending' and released_at is null and reversed_at is null)
    or (status = 'released' and released_at is not null and reversed_at is null)
    or (status = 'reversed' and reversed_at is not null and released_at is null and reversed_by is not null and char_length(btrim(coalesce(reversal_reason, ''))) between 1 and 300)),
  constraint gift_sends_fee_row_chk check ((commission = 0) = (fee_ledger_id is null)),
  constraint gift_sends_key_chk check (char_length(idempotency_key) between 8 and 80),
  constraint gift_sends_message_chk check (message_client_id = 'gift-' || id::text),
  constraint gift_sends_revision_fk foreign key (sticker_id, sticker_revision) references public.gift_sticker_revisions (sticker_id, revision)
);
create unique index if not exists gift_sends_idem_uidx on public.gift_sends (sender_id, idempotency_key);
create index if not exists gift_sends_sender_idx on public.gift_sends (sender_id, created_at desc);
create index if not exists gift_sends_recipient_idx on public.gift_sends (recipient_id, created_at desc);
create index if not exists gift_sends_due_idx on public.gift_sends (recipient_id, hold_until) where status = 'pending';
create index if not exists gift_sends_conversation_idx on public.gift_sends (conversation_id, created_at desc);
alter table public.gift_sends enable row level security;
revoke all on public.gift_sends from public, anon, authenticated;
grant select on public.gift_sends to authenticated;
grant all on public.gift_sends to service_role;
drop policy if exists "gift_sends sender or recipient read" on public.gift_sends;
create policy "gift_sends sender or recipient read" on public.gift_sends for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
comment on table public.gift_sends is 'Frenz Gift Coin sticker gifts (0293): one row per gift, with the sticker revision, price, recipient share, commission, hold, the rules and sticker snapshots and the ledger rows. Written only by send_gift, released by release_gift_earnings, reversed by reverse_gift (status only, every other column fixed). The sender and recipient may read their own.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- Why the gifting rules cannot be used (null = they can). gifting_missing | gifting_invalid:<field>.
create or replace function public.gift_rules_check(p_rules jsonb) returns text
language plpgsql immutable as $$
declare
  k   text;
  v   jsonb;
  pat text;
begin
  if p_rules is null or jsonb_typeof(p_rules) = 'null' then return 'gifting_missing'; end if;
  if jsonb_typeof(p_rules) <> 'object' then return 'gifting_invalid:shape'; end if;
  foreach k in array array['version', 'recipientShareBp', 'commissionBp', 'holdHours', 'senderCooldownHours', 'dailyMaxFgc'] loop
    v := p_rules -> k;
    pat := case k when 'version' then '^[1-9][0-9]{0,14}$' when 'dailyMaxFgc' then '^[1-9][0-9]{0,11}$' else '^[0-9]{1,5}$' end;
    if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ pat then return 'gifting_invalid:' || k; end if;
  end loop;
  if (p_rules ->> 'recipientShareBp')::int not between 1 and 10000 then return 'gifting_invalid:recipientShareBp'; end if;
  if (p_rules ->> 'commissionBp')::int not between 0 and 9999 then return 'gifting_invalid:commissionBp'; end if;
  if (p_rules ->> 'recipientShareBp')::int + (p_rules ->> 'commissionBp')::int <> 10000 then return 'gifting_invalid:split'; end if;
  if (p_rules ->> 'holdHours')::int not between 1 and 2160 then return 'gifting_invalid:holdHours'; end if;
  if (p_rules ->> 'senderCooldownHours')::int not between 0 and 2160 then return 'gifting_invalid:senderCooldownHours'; end if;
  return null;
end;
$$;

-- The gifting rules' only writer: the twin of save_frenz_gift_conversion (0291/0292), for frenzGift.gifting.
create or replace function public.save_frenz_gift_gifting(p_admin uuid, p_rules jsonb, p_expected_version bigint, p_validation jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_value jsonb;
  v_gift  jsonb;
  v_cur   jsonb;
  v_ver   bigint := 0;
  v_body  jsonb;
  v_new   jsonb;
  v_err   text;
  v_at    timestamptz := now();
begin
  if p_admin is null or p_rules is null or jsonb_typeof(p_rules) <> 'object' or p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.settings (key, value) values ('landing', '{}'::jsonb) on conflict (key) do nothing;
  select value into v_value from public.settings where key = 'landing' for update;
  v_gift := case when jsonb_typeof(v_value -> 'frenzGift') = 'object' then v_value -> 'frenzGift' else '{}'::jsonb end;
  v_cur := case when jsonb_typeof(v_gift -> 'gifting') = 'object' then v_gift -> 'gifting' end;
  if v_cur is not null and (v_cur ->> 'version') ~ '^[0-9]{1,15}$' then v_ver := (v_cur ->> 'version')::bigint; end if;
  if p_expected_version <> v_ver then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_gifting_config_rejected', 'settings', 'frenzGift', 'frenz-gift-gifting', jsonb_build_object('reason', 'stale', 'expected_version', p_expected_version, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', v_ver);
  end if;
  -- exactly the five fields: nothing else the caller sent is stored, and the caller never chooses the version
  v_body := jsonb_build_object('recipientShareBp', p_rules -> 'recipientShareBp', 'commissionBp', p_rules -> 'commissionBp', 'holdHours', p_rules -> 'holdHours',
                               'senderCooldownHours', p_rules -> 'senderCooldownHours', 'dailyMaxFgc', p_rules -> 'dailyMaxFgc');
  if v_cur is not null and (v_cur - 'version') = v_body then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_ver, 'gifting', v_cur);
  end if;
  v_new := jsonb_build_object('version', v_ver + 1) || v_body;
  v_err := public.gift_rules_check(v_new);
  if v_err is not null then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_gifting_config_rejected', 'settings', 'frenzGift', 'frenz-gift-gifting', jsonb_build_object('reason', v_err, 'attempted', v_new, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', v_err, 'version', v_ver);
  end if;
  perform set_config('frenz.gift_settings_writer', 'on', true);
  update public.settings
     set value = jsonb_set(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end, '{frenzGift}',
                           v_gift || jsonb_build_object('gifting', v_new, 'giftingUpdatedAt', v_at, 'giftingUpdatedBy', p_admin), true)
   where key = 'landing';
  perform set_config('frenz.gift_settings_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'gift_gifting_config_updated', 'settings', 'frenzGift', 'frenz-gift-gifting:v' || (v_ver + 1)::text,
          jsonb_build_object('before', v_cur, 'after', v_new, 'version', v_ver + 1, 'validation', coalesce(p_validation, '{}'::jsonb) || jsonb_build_object('database_check', 'valid')));
  insert into public.config_audit_log (actor_id, surface, target_id, action, before, after)
  values (p_admin, 'frenz_gift', 'settings', 'settings.update', jsonb_build_object('gifting', v_cur), jsonb_build_object('gifting', v_new, 'validation', coalesce(p_validation, '{}'::jsonb)));
  return jsonb_build_object('ok', true, 'version', v_ver + 1, 'gifting', v_new, 'updated_at', v_at);
end;
$$;

-- 0283's begin_coin_pin_attempt, restated word for word with 'gift' among the purposes (marked 0293).
create or replace function public.begin_coin_pin_attempt(p_user uuid, p_purpose text, p_policy jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v     public.coin_pins%rowtype;
  v_max integer := public.coin_pin_setting(p_policy, 'maxAttempts', 5, 3, 10);
  v_id  uuid;
begin
  -- 0283: 'withdrawal' is a purpose. 0293: 'gift' too
  if p_user is null or p_purpose is null or p_purpose not in ('transfer', 'change', 'withdrawal', 'gift') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
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

-- A gift row: inserted only by send_gift, and afterwards only its status may move (pending -> released | reversed).
create or replace function public.gift_sends_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'gift_sends rows are permanent (0293)'; end if;
  if coalesce(current_setting('frenz.gift_writer', true), '') <> 'on' then raise exception 'gift_sends is written only by the gift functions (0293)'; end if;
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['status', 'released_at', 'reversed_at', 'reversed_by', 'reversal_reason']) is distinct from (to_jsonb(old) - array['status', 'released_at', 'reversed_at', 'reversed_by', 'reversal_reason']) then
      raise exception 'a gift cannot be rewritten (0293)';
    end if;
    if not (old.status = 'pending' and new.status in ('released', 'reversed')) then
      raise exception 'gift status % cannot become % (0293)', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;

-- A chat message of kind 'gift' must be a real gift of its sender in its conversation, and is never edited.
create or replace function public.messages_gift_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_gift uuid;
begin
  if tg_op = 'UPDATE' and coalesce(old.metadata ->> 'kind', '') = 'gift' and new.metadata is distinct from old.metadata then
    raise exception 'a gift message cannot be edited (0293)';
  end if;
  if coalesce(new.metadata ->> 'kind', '') = 'gift' and (tg_op = 'INSERT' or coalesce(old.metadata ->> 'kind', '') <> 'gift') then
    if coalesce(new.metadata ->> 'giftId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'a gift message must name its gift (0293)'; end if;
    select id into v_gift from public.gift_sends
     where id = (new.metadata ->> 'giftId')::uuid and sender_id = new.sender_id and conversation_id = new.conversation_id and message_client_id = new.client_id;
    if v_gift is null then raise exception 'a gift message must match a gift of this sender in this conversation (0293)'; end if;
  end if;
  return new;
end;
$$;

-- Why this member may not send a gift right now (null = they may). Read it under the sender's wallet lock.
create or replace function public.gift_send_block_reason(p_user uuid, p_rules jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_block text := public.coin_wallet_block_reason(p_user);
begin
  if v_block is not null then return v_block; end if;
  if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and state = 'disputed') then return 'deposit_under_review'; end if;
  if exists (select 1 from public.coin_deposits where user_id = p_user
               and (status in ('held', 'disputed') or settled_at > now() - make_interval(hours => (p_rules ->> 'senderCooldownHours')::int))) then
    return 'deposit_cooldown';
  end if;
  return null;
end;
$$;

-- A sender under financial review: the earnings they gave are not released while it lasts.
create or replace function public.gift_sender_frozen(p_sender uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.coin_wallet_block_reason(p_sender) is not null
      or exists (select 1 from public.coin_deposit_reversals where user_id = p_sender and state = 'disputed')
$$;

-- Release a recipient's due gift earnings. The caller holds the recipient's FGC wallet lock (send_gift, the public
-- release_gift_earnings and gift_wallet_summary all take it first).
create or replace function public.release_gift_earnings_locked(p_user uuid, p_limit integer default 200) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  g       record;
  v_n     integer := 0;
  v_total bigint := 0;
begin
  perform set_config('frenz.gift_writer', 'on', true);
  for g in
    select s.id, s.recipient_share, s.earning_ledger_id, s.sender_id from public.gift_sends s
     where s.recipient_id = p_user and s.status = 'pending' and s.hold_until <= now()
     order by s.hold_until, s.id
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update
  loop
    if public.gift_sender_frozen(g.sender_id) then continue; end if;
    update public.ai_product_ledger set status = 'settled', updated_at = now() where id = g.earning_ledger_id and status = 'reserved';
    if not found then continue; end if;
    update public.ai_product_balances set pending_cents = pending_cents - g.recipient_share, updated_at = now() where user_id = p_user and product = 'frenz_gift';
    update public.gift_sends set status = 'released', released_at = now() where id = g.id and status = 'pending';
    v_n := v_n + 1;
    v_total := v_total + g.recipient_share;
  end loop;
  perform set_config('frenz.gift_writer', 'off', true);
  return jsonb_build_object('released', v_n, 'amount', v_total);
end;
$$;

create or replace function public.release_gift_earnings(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  perform 1 from public.ai_product_balances where user_id = p_user and product = 'frenz_gift' for update;
  if not found then return jsonb_build_object('ok', true, 'released', 0, 'amount', 0); end if;
  return jsonb_build_object('ok', true) || public.release_gift_earnings_locked(p_user);
end;
$$;

-- A member's FGC wallet, with any due earnings released first (the wallet read the gallery uses).
create or replace function public.gift_wallet_summary(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bal  bigint;
  v_pend bigint;
  v_next timestamptz;
  v_rel  jsonb := '{}'::jsonb;
begin
  if p_user is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = 'frenz_gift' for update;
  if v_bal is null then return jsonb_build_object('ok', true, 'balance', 0, 'pending', 0, 'available', 0, 'next_release_at', null); end if;
  v_rel := public.release_gift_earnings_locked(p_user);
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_user and product = 'frenz_gift';
  select min(hold_until) into v_next from public.gift_sends where recipient_id = p_user and status = 'pending';
  return jsonb_build_object('ok', true, 'balance', v_bal, 'pending', v_pend, 'available', v_bal - v_pend, 'next_release_at', v_next, 'released_now', coalesce((v_rel ->> 'amount')::bigint, 0));
end;
$$;

-- The catalogue members may see: published and not archived, in display order.
create or replace function public.gift_sticker_gallery() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'revision', revision, 'name', name, 'description', description, 'rarity', rarity, 'category', category,
                                               'featured', featured, 'price_fgc', price_fgc, 'image_url', image_url, 'animation_url', animation_url)
                            order by sort_order, created_at), '[]'::jsonb)
    from public.gift_stickers where published and archived_at is null
$$;

-- What a stored gift answers, first time or on a replay.
create or replace function public.gift_send_result(p_g public.gift_sends, p_duplicate boolean) returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', true, 'duplicate', p_duplicate, 'gift_id', p_g.id, 'recipient_id', p_g.recipient_id, 'conversation_id', p_g.conversation_id,
    'message_client_id', p_g.message_client_id, 'sticker_id', p_g.sticker_id, 'revision', p_g.sticker_revision, 'price', p_g.price_fgc,
    'recipient_share', p_g.recipient_share, 'commission', p_g.commission, 'hold_until', p_g.hold_until, 'status', p_g.status, 'sticker', p_g.sticker_snapshot,
    'created_at', p_g.created_at)
$$;

-- The gift. Reached only through send_gift_with_pin (no API role may call it).
create or replace function public.send_gift(p_sender uuid, p_conversation uuid, p_recipient uuid, p_sticker uuid, p_expected_revision integer, p_expected_price bigint, p_idempotency text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ex      public.gift_sends%rowtype;
  v_err     text;
  v_conv    record;
  v_role    text;
  v_to      uuid := p_recipient;
  v_st      public.gift_stickers%rowtype;
  v_share   bigint;
  v_fee     bigint;
  v_bp      int;
  v_block   text;
  v_sum     bigint;
  v_bal     bigint;
  v_pend    bigint;
  v_id      uuid;
  v_s_after bigint;
  v_r_after bigint;
  v_sent    uuid;
  v_fee_row uuid;
  v_earn    uuid;
  v_hold    int;
  v_snap    jsonb;
begin
  if p_sender is null or p_conversation is null or p_sticker is null or p_expected_revision is null or p_expected_price is null
     or coalesce(p_idempotency, '') !~ '^[A-Za-z0-9_-]{8,80}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- a replay answers what the first request did, and is never charged again. A different body is a conflict.
  select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.conversation_id <> p_conversation or v_ex.sticker_id <> p_sticker or (p_recipient is not null and v_ex.recipient_id <> p_recipient) then
      return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
    end if;
    return public.gift_send_result(v_ex, true);
  end if;
  v_err := public.gift_rules_check(p_rules);
  if v_err = 'gifting_missing' then return jsonb_build_object('ok', false, 'reason', 'gifting_not_configured'); end if;
  if v_err is not null then return jsonb_build_object('ok', false, 'reason', 'gifting_invalid', 'detail', v_err); end if;

  -- the conversation, by the chat's own rules
  select id, type, user_low, user_high, only_admins_can_send into v_conv from public.conversations where id = p_conversation;
  if v_conv.id is null then return jsonb_build_object('ok', false, 'reason', 'conversation_unavailable'); end if;
  if v_conv.type = 'secret' then return jsonb_build_object('ok', false, 'reason', 'secret_chat'); end if;
  select role into v_role from public.conversation_members where conversation_id = p_conversation and user_id = p_sender and left_at is null;
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'conversation_unavailable'); end if;
  if v_conv.type = 'group' then
    if coalesce(v_conv.only_admins_can_send, false) and v_role = 'member' then return jsonb_build_object('ok', false, 'reason', 'admins_only'); end if;
    if v_to is null then return jsonb_build_object('ok', false, 'reason', 'recipient_required'); end if;
  else
    v_to := case when v_conv.user_low = p_sender then v_conv.user_high else v_conv.user_low end;
    if p_recipient is not null and p_recipient <> v_to then return jsonb_build_object('ok', false, 'reason', 'recipient_invalid'); end if;
  end if;
  if v_to is null or v_to = p_sender then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  if not exists (select 1 from public.conversation_members where conversation_id = p_conversation and user_id = v_to and left_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'recipient_invalid');
  end if;
  if exists (select 1 from public.blocks where (blocker_id = p_sender and blocked_id = v_to) or (blocker_id = v_to and blocked_id = p_sender)) then
    return jsonb_build_object('ok', false, 'reason', 'blocked');
  end if;
  if exists (select 1 from public.profiles where id = v_to and is_suspended) then return jsonb_build_object('ok', false, 'reason', 'recipient_unavailable'); end if;

  -- the sticker, exactly as the member was shown it (an administrator's edit waits for this gift, or this gift sees it)
  select * into v_st from public.gift_stickers where id = p_sticker for share;
  if v_st.id is null or not v_st.published or v_st.archived_at is not null then return jsonb_build_object('ok', false, 'reason', 'sticker_unavailable'); end if;
  if v_st.revision <> p_expected_revision or v_st.price_fgc <> p_expected_price then
    return jsonb_build_object('ok', false, 'reason', 'sticker_changed', 'revision', v_st.revision, 'price', v_st.price_fgc);
  end if;
  v_bp := (p_rules ->> 'recipientShareBp')::int;
  v_share := div(v_st.price_fgc::numeric * v_bp, 10000)::bigint;
  v_fee := v_st.price_fgc - v_share;
  if v_share < 1 then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;

  perform public.ensure_gift_wallet(p_sender);
  perform public.ensure_gift_wallet(v_to);
  -- both FGC wallets, locked in a FIXED order (user id), so two opposite gifts never deadlock
  perform 1 from public.ai_product_balances where product = 'frenz_gift' and user_id in (p_sender, v_to) order by user_id for update;
  select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency;
  if v_ex.id is not null then
    if v_ex.conversation_id <> p_conversation or v_ex.sticker_id <> p_sticker or v_ex.recipient_id <> v_to then return jsonb_build_object('ok', false, 'reason', 'idempotency_conflict'); end if;
    return public.gift_send_result(v_ex, true);
  end if;
  v_block := public.gift_send_block_reason(p_sender, p_rules);
  if v_block is not null then return jsonb_build_object('ok', false, 'reason', v_block); end if;
  -- the sender's own due earnings become spendable before the balance is read
  perform public.release_gift_earnings_locked(p_sender);
  select coalesce(sum(price_fgc), 0) into v_sum from public.gift_sends where sender_id = p_sender and status <> 'reversed' and created_at >= now() - interval '24 hours';
  if v_sum + v_st.price_fgc > (p_rules ->> 'dailyMaxFgc')::bigint then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'used', v_sum, 'limit', (p_rules ->> 'dailyMaxFgc')::bigint);
  end if;
  select balance_cents, pending_cents into v_bal, v_pend from public.ai_product_balances where user_id = p_sender and product = 'frenz_gift';
  if v_bal - v_pend < v_st.price_fgc then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_bal - v_pend, 'needed', v_st.price_fgc);
  end if;

  v_id := gen_random_uuid();
  v_hold := (p_rules ->> 'holdHours')::int;
  v_snap := jsonb_build_object('name', v_st.name, 'description', v_st.description, 'rarity', v_st.rarity, 'category', v_st.category,
                               'image_url', v_st.image_url, 'animation_url', v_st.animation_url, 'slug', v_st.slug);
  perform set_config('frenz.gift_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - v_st.price_fgc, updated_at = now()
   where user_id = p_sender and product = 'frenz_gift' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (p_sender, 'frenz_gift', 'gift_sent', 'settled', -v_share, v_s_after + v_fee, 'FGC', 'gift:' || v_id::text, 'Sticker gift: ' || v_st.name, 0,
          jsonb_build_object('gift_id', v_id, 'recipient_id', v_to, 'sticker_id', v_st.id, 'revision', v_st.revision, 'price', v_st.price_fgc, 'rules_version', p_rules -> 'version'))
  returning id into v_sent;
  if v_fee > 0 then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
    values (p_sender, 'frenz_gift', 'gift_fee', 'settled', -v_fee, v_s_after, 'FGC', 'gift-fee:' || v_id::text, 'Gift commission', 0,
            jsonb_build_object('gift_id', v_id, 'commission_bp', (p_rules ->> 'commissionBp')::int, 'rules_version', p_rules -> 'version'))
    returning id into v_fee_row;
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('gift_commission', v_fee_row, 'gift:' || v_id::text, p_sender, v_fee, 'FGC', 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  update public.ai_product_balances set balance_cents = balance_cents + v_share, pending_cents = pending_cents + v_share, updated_at = now()
   where user_id = v_to and product = 'frenz_gift' returning balance_cents into v_r_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, withdrawable_part, metadata)
  values (v_to, 'frenz_gift', 'gift_earning', 'reserved', v_share, v_r_after, 'FGC', 'gift:' || v_id::text, 'Gift received: ' || v_st.name, 0,
          jsonb_build_object('gift_id', v_id, 'sender_id', p_sender, 'sticker_id', v_st.id, 'revision', v_st.revision, 'hold_until', now() + make_interval(hours => v_hold)))
  returning id into v_earn;
  insert into public.gift_sends (id, sender_id, recipient_id, conversation_id, message_client_id, sticker_id, sticker_revision, price_fgc, recipient_share, commission,
                                 share_bp, commission_bp, hold_hours, hold_until, rules_version, rules_snapshot, sticker_snapshot, idempotency_key, status,
                                 sent_ledger_id, fee_ledger_id, earning_ledger_id)
  values (v_id, p_sender, v_to, p_conversation, 'gift-' || v_id::text, v_st.id, v_st.revision, v_st.price_fgc, v_share, v_fee,
          v_bp, (p_rules ->> 'commissionBp')::int, v_hold, now() + make_interval(hours => v_hold), (p_rules ->> 'version')::bigint, p_rules, v_snap, p_idempotency, 'pending',
          v_sent, v_fee_row, v_earn)
  returning * into v_ex;
  perform set_config('frenz.gift_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_sender, 'gift_sent', 'gift', v_id::text, 'gift:' || v_id::text,
          jsonb_build_object('recipient_id', v_to, 'conversation_id', p_conversation, 'sticker_id', v_st.id, 'revision', v_st.revision, 'price', v_st.price_fgc,
                             'share', v_share, 'commission', v_fee, 'hold_until', v_ex.hold_until, 'rules_version', p_rules -> 'version'));
  return public.gift_send_result(v_ex, false) || jsonb_build_object('balance_after', v_s_after);
end;
$$;

-- The PIN check (purpose 'gift', the attempt consumed here) and the gift in ONE transaction, as transfer_coins_with_pin.
create or replace function public.send_gift_with_pin(
  p_sender uuid, p_attempt uuid, p_derived bytea, p_conversation uuid, p_recipient uuid, p_sticker uuid, p_expected_revision integer, p_expected_price bigint,
  p_idempotency text, p_rules jsonb, p_policy jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_check text;
  v_out   jsonb;
begin
  if p_sender is null or p_attempt is null then return jsonb_build_object('ok', false, 'reason', 'authorization_failed'); end if;
  v_check := public.coin_pin_check(p_sender, p_attempt, p_derived, 'gift', p_policy);
  if v_check <> 'ok' then
    -- one answer for every way a PIN can fail: nothing about whether a PIN, a lock or an attempt exists
    return jsonb_build_object('ok', false, 'reason', 'authorization_failed');
  end if;
  v_out := public.send_gift(p_sender, p_conversation, p_recipient, p_sticker, p_expected_revision, p_expected_price, p_idempotency, p_rules);
  if not coalesce((v_out ->> 'ok')::boolean, false) then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_sender, 'gift_refused', 'gift', null, null, jsonb_build_object('reason', v_out ->> 'reason', 'sticker_id', p_sticker, 'conversation_id', p_conversation));
  end if;
  return v_out;
end;
$$;

-- An administrator's decision on a PENDING gift: the recipient's pending share back, the sender refunded the price in
-- FGC, the commission income reversed. Once. A released gift is never reversed here.
create or replace function public.reverse_gift(p_gift uuid, p_admin uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_g       public.gift_sends%rowtype;
  v_r_after bigint;
  v_s_after bigint;
  v_rev     uuid;
begin
  if p_gift is null or p_admin is null or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 300 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_g from public.gift_sends where id = p_gift;
  if v_g.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- the wallet locks first (the order every gift function takes), then the gift row
  perform 1 from public.ai_product_balances where product = 'frenz_gift' and user_id in (v_g.sender_id, v_g.recipient_id) order by user_id for update;
  select * into v_g from public.gift_sends where id = p_gift for update;
  if v_g.status = 'reversed' then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_g.status = 'released' then return jsonb_build_object('ok', false, 'reason', 'already_released'); end if;
  perform set_config('frenz.gift_writer', 'on', true);
  update public.ai_product_balances set balance_cents = balance_cents - v_g.recipient_share, pending_cents = pending_cents - v_g.recipient_share, updated_at = now()
   where user_id = v_g.recipient_id and product = 'frenz_gift' returning balance_cents into v_r_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
  values (v_g.recipient_id, 'frenz_gift', 'gift_earning_reversal', 'settled', -v_g.recipient_share, v_r_after, 'FGC', 'gift:' || v_g.id::text, 'Gift reversed', p_admin, 0,
          jsonb_build_object('gift_id', v_g.id, 'reason', p_reason));
  update public.ai_product_ledger set status = 'reversed', updated_at = now() where id = v_g.earning_ledger_id and status = 'reserved';
  update public.ai_product_balances set balance_cents = balance_cents + v_g.price_fgc, updated_at = now()
   where user_id = v_g.sender_id and product = 'frenz_gift' returning balance_cents into v_s_after;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, metadata)
  values (v_g.sender_id, 'frenz_gift', 'gift_refund', 'settled', v_g.price_fgc, v_s_after, 'FGC', 'gift:' || v_g.id::text, 'Gift reversed: refunded', p_admin, 0,
          jsonb_build_object('gift_id', v_g.id, 'reason', p_reason))
  returning id into v_rev;
  update public.gift_sends set status = 'reversed', reversed_at = now(), reversed_by = p_admin, reversal_reason = btrim(p_reason) where id = v_g.id;
  perform set_config('frenz.gift_writer', 'off', true);
  if v_g.fee_ledger_id is not null then
    insert into public.platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit, withdrawable_part)
    values ('gift_commission_reversal', v_g.fee_ledger_id, 'gift:' || v_g.id::text, v_g.sender_id, v_g.commission, 'FGC', 0)
    on conflict (source, source_ledger_id) do nothing;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'gift_reversed', 'gift', v_g.id::text, 'gift:' || v_g.id::text,
          jsonb_build_object('reason', p_reason, 'price', v_g.price_fgc, 'share', v_g.recipient_share, 'commission', v_g.commission, 'sender_id', v_g.sender_id, 'recipient_id', v_g.recipient_id));
  return jsonb_build_object('ok', true, 'gift_id', v_g.id, 'refunded', v_g.price_fgc);
end;
$$;

do $$
begin
  execute 'drop trigger if exists gift_sends_guard on public.gift_sends';
  execute 'create trigger gift_sends_guard before insert or update or delete on public.gift_sends for each row execute function public.gift_sends_guard()';
  execute 'drop trigger if exists messages_gift_guard on public.messages';
  execute 'create trigger messages_gift_guard before insert or update on public.messages for each row execute function public.messages_gift_guard()';

  execute 'revoke all on function public.gift_rules_check(jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.gift_rules_check(jsonb) to service_role';
  execute 'revoke all on function public.save_frenz_gift_gifting(uuid, jsonb, bigint, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.save_frenz_gift_gifting(uuid, jsonb, bigint, jsonb) to service_role';
  execute 'revoke all on function public.begin_coin_pin_attempt(uuid, text, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.begin_coin_pin_attempt(uuid, text, jsonb) to service_role';
  execute 'revoke all on function public.gift_sends_guard() from public, anon, authenticated';
  execute 'revoke all on function public.messages_gift_guard() from public, anon, authenticated';
  execute 'revoke all on function public.gift_send_block_reason(uuid, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.gift_sender_frozen(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.release_gift_earnings_locked(uuid, integer) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.release_gift_earnings(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.release_gift_earnings(uuid) to service_role';
  execute 'revoke all on function public.gift_wallet_summary(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.gift_wallet_summary(uuid) to service_role';
  execute 'revoke all on function public.gift_sticker_gallery() from public, anon, authenticated';
  execute 'grant execute on function public.gift_sticker_gallery() to service_role';
  execute 'revoke all on function public.gift_send_result(public.gift_sends, boolean) from public, anon, authenticated';
  -- the gift itself: no API role may call it. Only send_gift_with_pin (definer) reaches it.
  execute 'revoke all on function public.send_gift(uuid, uuid, uuid, uuid, integer, bigint, text, jsonb) from public, anon, authenticated, service_role';
  execute 'revoke all on function public.send_gift_with_pin(uuid, uuid, bytea, uuid, uuid, uuid, integer, bigint, text, jsonb, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.send_gift_with_pin(uuid, uuid, bytea, uuid, uuid, uuid, integer, bigint, text, jsonb, jsonb) to service_role';
  execute 'revoke all on function public.reverse_gift(uuid, uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.reverse_gift(uuid, uuid, text) to service_role';
end;
$$;
