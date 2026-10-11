-- 0227 — SUB: paid subscriptions, creator communities, private posts and SUB withdrawals
-- (Feature 19 · Part 13 + owner brief 2026-10-11, see docs/SUB_MONETIZATION.md and docs/BILLING.md).
--
-- SUB is MONEY, in integer USD cents, kept apart from the AI credit wallet: nothing
-- here reads or writes ai_product_balances or ai_product_ledger, and AI credits can
-- never pay for a subscription.
--
--   creator_membership_settings  a creator's monetization setup: the subscription
--                                price, free community joining, setup progress
--   creator_memberships          one row per creator and member: a free member or
--                                a paid subscriber, with the paid-through time
--   sub_purchases                every Paystack subscription payment: the creator's
--                                price, the purchase fee on top, what was charged in
--                                which currency at which rate, and its state
--   sub_balances / sub_ledger    the creator's SUB money: pending, available, held
--                                in a withdrawal, and debt from a refund after payout
--   withdrawal_requests          gains source (credits or sub) and gross / fee / net
--                                cents. ONE open withdrawal per member per source
--                                (a unique index) - a double tap or two tabs can
--                                never hold the same money twice
--   financial_audit_log          every money action with its actor and reference
--   sub_posts / sub_post_media   subscriber-only posts, a store of their own so no
--                                existing feed or search can read them. Media keys
--                                point into a PRIVATE bucket and leave the server
--                                only as short-lived signed URLs after an access check
--   creator_notes, creator_recognitions, creator_sponsors, creator_feedback
--                                the community side (Part 13)
--   reward_profiles              nobody may approve their own withdrawal qualification
--
-- Money moves only through the functions at the end: settle_sub_purchase,
-- reverse_sub_purchase, release_sub_earnings, request_sub_withdrawal and the
-- extended resolve_withdrawal. Each locks the rows it changes and is idempotent.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

-- ── settings and memberships ────────────────────────────────────────────────
create table if not exists public.creator_membership_settings (
  creator_id         uuid primary key references auth.users (id) on delete cascade,
  open               boolean not null default false,
  welcome            text,
  sub_price_cents    integer,
  sub_active         boolean not null default false,
  setup_step         smallint not null default 0,
  setup_completed_at timestamptz,
  updated_at         timestamptz not null default now()
);
alter table public.creator_membership_settings enable row level security;
drop policy if exists "creator membership settings owner" on public.creator_membership_settings;
create policy "creator membership settings owner" on public.creator_membership_settings
  for select using ((select auth.uid()) = creator_id);

create table if not exists public.creator_memberships (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references auth.users (id) on delete cascade,
  member_id    uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'member',
  status       text not null default 'active',
  billing      text not null default 'free',
  price_cents  integer not null default 0,
  period_index integer not null default 0,
  period_start timestamptz not null default now(),
  period_end   timestamptz,
  joined_at    timestamptz not null default now(),
  ended_at     timestamptz,
  constraint creator_memberships_not_self check (creator_id <> member_id)
);
create unique index if not exists creator_memberships_pair_uidx on public.creator_memberships (creator_id, member_id);
create index if not exists creator_memberships_member_idx on public.creator_memberships (member_id);
-- the access check: is this viewer an active, paid-up subscriber of this creator?
create index if not exists creator_memberships_access_idx on public.creator_memberships (creator_id, member_id, period_end) where status = 'active' and billing = 'sub';
alter table public.creator_memberships enable row level security;
drop policy if exists "creator memberships parties read" on public.creator_memberships;
create policy "creator memberships parties read" on public.creator_memberships
  for select using ((select auth.uid()) in (creator_id, member_id));

-- ── SUB money ───────────────────────────────────────────────────────────────
create table if not exists public.sub_purchases (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references auth.users (id) on delete cascade,
  subscriber_id    uuid not null references auth.users (id) on delete cascade,
  price_cents      integer not null,
  fee_cents        integer not null,
  total_cents      integer not null,
  fee_bp           integer not null,
  charged_currency text not null,
  charged_minor    bigint not null,
  fx_minor_per_usd bigint,
  provider         text not null default 'paystack',
  reference        text not null,
  provider_ref     text,
  checkout_url     text,
  status           text not null default 'initiated',
  period_days      integer not null default 30,
  hold_days        integer not null default 0,
  period_start     timestamptz,
  period_end       timestamptz,
  available_at     timestamptz,
  released_at      timestamptz,
  paid_at          timestamptz,
  reversed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint sub_purchases_not_self check (creator_id <> subscriber_id)
);
create unique index if not exists sub_purchases_reference_uidx on public.sub_purchases (reference);
create index if not exists sub_purchases_creator_idx on public.sub_purchases (creator_id, created_at desc);
create index if not exists sub_purchases_subscriber_idx on public.sub_purchases (subscriber_id, created_at desc);
-- an open checkout for the same pair is reused, never doubled
create index if not exists sub_purchases_open_idx on public.sub_purchases (subscriber_id, creator_id, created_at desc) where status = 'initiated';
create index if not exists sub_purchases_unreleased_idx on public.sub_purchases (creator_id, available_at) where status = 'paid' and released_at is null;
alter table public.sub_purchases enable row level security;
drop policy if exists "sub purchases parties read" on public.sub_purchases;
create policy "sub purchases parties read" on public.sub_purchases
  for select using ((select auth.uid()) in (creator_id, subscriber_id));

create table if not exists public.sub_balances (
  creator_id      uuid primary key references auth.users (id) on delete cascade,
  pending_cents   bigint not null default 0,
  available_cents bigint not null default 0,
  held_cents      bigint not null default 0,
  debt_cents      bigint not null default 0,
  lifetime_cents  bigint not null default 0,
  withdrawn_cents bigint not null default 0,
  updated_at      timestamptz not null default now()
);
alter table public.sub_balances enable row level security;
drop policy if exists "sub balances owner read" on public.sub_balances;
create policy "sub balances owner read" on public.sub_balances
  for select using ((select auth.uid()) = creator_id);

-- The creator's saved payout beneficiary and the auto-withdrawal switch (owner, 2026-10-11:
-- "set up an account beneficiary and it saves for future records so every sub goes
-- straight to their balance"). The account holder name is Paystack's, never typed.
-- No policy: only the server reads it, and the app shows a masked number.
create table if not exists public.sub_payout_accounts (
  creator_id      uuid primary key references auth.users (id) on delete cascade,
  method          text not null default 'paystack',
  bank_code       text not null,
  bank_name       text not null,
  account_number  text not null,
  account_name    text not null,
  auto_withdraw   boolean not null default false,
  verified_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sub_payout_accounts_method_chk check (method = 'paystack'),
  constraint sub_payout_accounts_number_chk check (account_number ~ '^[0-9]{10}$'),
  constraint sub_payout_accounts_bank_chk check (char_length(bank_code) between 2 and 10 and char_length(bank_name) between 1 and 120),
  constraint sub_payout_accounts_name_chk check (char_length(account_name) between 2 and 120)
);
create index if not exists sub_payout_accounts_auto_idx on public.sub_payout_accounts (creator_id) where auto_withdraw;
alter table public.sub_payout_accounts enable row level security;

create table if not exists public.sub_ledger (
  id              bigint generated always as identity primary key,
  creator_id      uuid not null references auth.users (id) on delete cascade,
  kind            text not null,
  amount_cents    bigint not null,
  pending_after   bigint not null,
  available_after bigint not null,
  reference       text not null,
  purchase_id     uuid references public.sub_purchases (id) on delete set null,
  withdrawal_id   uuid,
  actor_id        uuid references auth.users (id) on delete set null,
  note            text,
  created_at      timestamptz not null default now()
);
create unique index if not exists sub_ledger_reference_uidx on public.sub_ledger (kind, reference);
create index if not exists sub_ledger_creator_idx on public.sub_ledger (creator_id, created_at desc);
alter table public.sub_ledger enable row level security;
drop policy if exists "sub ledger owner read" on public.sub_ledger;
create policy "sub ledger owner read" on public.sub_ledger
  for select using ((select auth.uid()) = creator_id);

alter table public.withdrawal_requests add column if not exists source          text not null default 'credits';
alter table public.withdrawal_requests add column if not exists gross_cents     integer;
alter table public.withdrawal_requests add column if not exists fee_cents       integer;
alter table public.withdrawal_requests add column if not exists net_cents       integer;
alter table public.withdrawal_requests add column if not exists fee_bp          integer;
alter table public.withdrawal_requests add column if not exists idempotency_key text;
alter table public.withdrawal_requests drop constraint if exists withdrawal_requests_credits_chk;
alter table public.withdrawal_requests add constraint withdrawal_requests_credits_chk check (
  amount_usd_cents >= 0 and (
    (source = 'credits' and credits > 0)
    or (source = 'sub' and credits = 0 and gross_cents > 0 and fee_cents >= 0 and net_cents > 0 and gross_cents = fee_cents + net_cents and amount_usd_cents = net_cents)
  ));
create unique index if not exists withdrawal_requests_one_open_uidx on public.withdrawal_requests (user_id, source) where status in ('pending', 'reviewing', 'approved', 'processing');
create unique index if not exists withdrawal_requests_idem_uidx on public.withdrawal_requests (user_id, idempotency_key) where idempotency_key is not null;

create table if not exists public.financial_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   text,
  reference   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists financial_audit_log_created_idx on public.financial_audit_log (created_at desc);
create index if not exists financial_audit_log_target_idx on public.financial_audit_log (target_type, target_id);
alter table public.financial_audit_log enable row level security;
drop policy if exists "financial audit admin read" on public.financial_audit_log;
create policy "financial audit admin read" on public.financial_audit_log
  for select using ((select public.is_admin()));

-- ── subscriber-only posts ───────────────────────────────────────────────────
create table if not exists public.sub_posts (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  caption    text,
  cover_url  text,
  status     text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sub_posts_creator_idx on public.sub_posts (creator_id, created_at desc) where status = 'published';
alter table public.sub_posts enable row level security;
drop policy if exists "sub posts owner" on public.sub_posts;
create policy "sub posts owner" on public.sub_posts
  for select using ((select auth.uid()) = creator_id);

create table if not exists public.sub_post_media (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.sub_posts (id) on delete cascade,
  idx        integer not null default 0,
  media_kind text not null,
  object_key text not null,
  width      integer,
  height     integer,
  created_at timestamptz not null default now()
);
create unique index if not exists sub_post_media_idx_uidx on public.sub_post_media (post_id, idx);
alter table public.sub_post_media enable row level security;
-- no policy at all: only the server reads media keys, after the access check

-- ── community (Part 13) ─────────────────────────────────────────────────────
create table if not exists public.creator_notes (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  body       text not null,
  min_role   text not null default 'member',
  created_at timestamptz not null default now()
);
create index if not exists creator_notes_creator_idx on public.creator_notes (creator_id, created_at desc);
alter table public.creator_notes enable row level security;
drop policy if exists "creator notes owner" on public.creator_notes;
create policy "creator notes owner" on public.creator_notes
  for select using ((select auth.uid()) = creator_id);

create table if not exists public.creator_recognitions (
  creator_id uuid not null references auth.users (id) on delete cascade,
  member_id  uuid not null references auth.users (id) on delete cascade,
  kind       text not null,
  shown      boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (creator_id, member_id, kind)
);
alter table public.creator_recognitions enable row level security;
drop policy if exists "creator recognitions owner" on public.creator_recognitions;
create policy "creator recognitions owner" on public.creator_recognitions
  for select using ((select auth.uid()) = creator_id);

create table if not exists public.creator_sponsors (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  kind       text not null default 'brand',
  url        text,
  created_at timestamptz not null default now()
);
create index if not exists creator_sponsors_creator_idx on public.creator_sponsors (creator_id);
alter table public.creator_sponsors enable row level security;
drop policy if exists "creator sponsors public read" on public.creator_sponsors;
create policy "creator sponsors public read" on public.creator_sponsors for select using (true);

create table if not exists public.creator_feedback (
  creator_id      uuid not null references auth.users (id) on delete cascade,
  member_id       uuid not null references auth.users (id) on delete cascade,
  communication   smallint,
  professionalism smallint,
  quality         smallint,
  reliability     smallint,
  education       smallint,
  community       smallint,
  updated_at      timestamptz not null default now(),
  primary key (creator_id, member_id)
);
alter table public.creator_feedback enable row level security;
drop policy if exists "creator feedback own" on public.creator_feedback;
create policy "creator feedback own" on public.creator_feedback
  for select using ((select auth.uid()) = member_id);

comment on table public.sub_purchases is '0227: every SUB payment - the creator price, the purchase fee on top, the charged amount and currency. Settled only from a verified Paystack charge.';
comment on table public.sub_balances is '0227: a creator SUB money in USD cents - pending, available, held in a withdrawal, and debt. Never the AI wallet.';
comment on table public.financial_audit_log is '0227: every money action - who, what, when and the reference. Admin read only.';

-- two in-app notification types (0226 is the last to set the list, restated whole)
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
    'member_joined','membership_update','sub_capture'
  )
);

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.creator_membership_settings add constraint creator_membership_settings_chk check (
      (welcome is null or char_length(welcome) between 1 and 400)
      and (sub_price_cents is null or sub_price_cents between 1 and 100000000)
      and setup_step between 0 and 4);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_memberships add constraint creator_memberships_chk check (
      role in ('member', 'supporter', 'inner_circle', 'vip', 'moderator', 'partner', 'brand_partner', 'team')
      and status in ('active', 'lapsed', 'ended', 'removed')
      and billing in ('free', 'sub') and price_cents >= 0);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_purchases add constraint sub_purchases_money_chk check (
      price_cents > 0 and fee_cents >= 0 and total_cents = price_cents + fee_cents
      and fee_bp between 0 and 10000 and charged_minor > 0 and period_days between 1 and 366 and hold_days between 0 and 90
      and status in ('initiated', 'paid', 'failed', 'refunded', 'disputed', 'reversed'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_balances add constraint sub_balances_nonneg_chk check (pending_cents >= 0 and available_cents >= 0 and held_cents >= 0 and debt_cents >= 0 and lifetime_cents >= 0 and withdrawn_cents >= 0);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_ledger add constraint sub_ledger_kind_chk check (kind in ('earning', 'release', 'withdrawal_hold', 'withdrawal_paid', 'withdrawal_return', 'clawback', 'adjustment'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.withdrawal_requests add constraint withdrawal_requests_source_chk check (source in ('credits', 'sub'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_posts add constraint sub_posts_chk check (
      (caption is null or char_length(caption) <= 2200) and status in ('published', 'archived')
      and (cover_url is null or (cover_url like 'https://%' and char_length(cover_url) <= 600)));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.sub_post_media add constraint sub_post_media_chk check (media_kind in ('image', 'video') and char_length(object_key) between 8 and 300 and object_key not like '%..%');
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_notes add constraint creator_notes_chk check (char_length(body) between 1 and 2000 and min_role in ('member', 'supporter', 'inner_circle', 'vip', 'moderator', 'partner', 'brand_partner', 'team'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_recognitions add constraint creator_recognitions_kind_chk check (kind in ('helpful', 'trusted', 'volunteer_moderator', 'constructive', 'collaborator', 'super_supporter'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_sponsors add constraint creator_sponsors_chk check (
      char_length(name) between 1 and 60 and kind in ('brand', 'partner', 'investor', 'organization', 'education', 'community')
      and (url is null or (url like 'https://%' and char_length(url) <= 300)));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.creator_feedback add constraint creator_feedback_range_chk check (
      (communication is null or communication between 1 and 5) and (professionalism is null or professionalism between 1 and 5)
      and (quality is null or quality between 1 and 5) and (reliability is null or reliability between 1 and 5)
      and (education is null or education between 1 and 5) and (community is null or community between 1 and 5));
  exception when duplicate_object then null;
  end;
  -- nobody approves their own withdrawal qualification (NOT VALID: older rows can never fail this migration)
  begin
    alter table public.reward_profiles add constraint reward_profiles_no_self_review_chk check (qualification_reviewed_by is null or qualification_reviewed_by <> user_id) not valid;
  exception when duplicate_object then null;
  end;
end;
$$;

-- Moves every matured, unreleased earning of one creator from pending to available,
-- settling any debt first. Called before a balance is shown and before a withdrawal.
create or replace function public.release_sub_earnings(p_creator uuid) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_amt  bigint;
  v_debt bigint;
  v_pay  bigint;
  v_b    public.sub_balances%rowtype;
begin
  insert into public.sub_balances (creator_id) values (p_creator) on conflict (creator_id) do nothing;
  select * into v_b from public.sub_balances where creator_id = p_creator for update;
  with r as (
    update public.sub_purchases set released_at = now(), updated_at = now()
     where creator_id = p_creator and status = 'paid' and released_at is null and available_at <= now()
    returning price_cents
  ) select coalesce(sum(price_cents), 0) into v_amt from r;
  if v_amt = 0 then return v_b.available_cents; end if;
  v_debt := v_b.debt_cents;
  v_pay := least(v_debt, v_amt);
  update public.sub_balances
     set pending_cents = greatest(0, pending_cents - v_amt), available_cents = available_cents + v_amt - v_pay, debt_cents = debt_cents - v_pay, updated_at = now()
   where creator_id = p_creator returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, note)
  values (p_creator, 'release', v_amt, v_b.pending_cents, v_b.available_cents, 'release:' || gen_random_uuid()::text, case when v_pay > 0 then 'Released, after settling a refund' else 'Released' end);
  return v_b.available_cents;
end;
$$;

-- A verified Paystack charge: grants the paid period and credits the creator. Answers
-- a duplicate with what it did the first time. Refuses an amount or currency that does
-- not match what was quoted - it never grants access on a short or foreign payment.
create or replace function public.settle_sub_purchase(p_reference text, p_paid_minor bigint, p_paid_currency text, p_provider_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p     public.sub_purchases%rowtype;
  v_m     public.creator_memberships%rowtype;
  v_start timestamptz;
  v_end   timestamptz;
  v_b     public.sub_balances%rowtype;
begin
  select * into v_p from public.sub_purchases where reference = p_reference for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status = 'paid' then return jsonb_build_object('ok', true, 'duplicate', true, 'purchase_id', v_p.id); end if;
  if v_p.status <> 'initiated' then return jsonb_build_object('ok', false, 'reason', 'not_payable', 'status', v_p.status); end if;
  if p_paid_currency is distinct from v_p.charged_currency or coalesce(p_paid_minor, 0) < v_p.charged_minor then
    insert into public.financial_audit_log (action, target_type, target_id, reference, details)
    values ('sub_payment_mismatch', 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('paid', p_paid_minor, 'currency', p_paid_currency, 'expected', v_p.charged_minor, 'expected_currency', v_p.charged_currency));
    return jsonb_build_object('ok', false, 'reason', 'amount_mismatch');
  end if;

  insert into public.creator_memberships (creator_id, member_id, status, billing, price_cents, period_index, period_end)
  values (v_p.creator_id, v_p.subscriber_id, 'active', 'sub', v_p.price_cents, 0, now())
  on conflict (creator_id, member_id) do nothing;
  select * into v_m from public.creator_memberships where creator_id = v_p.creator_id and member_id = v_p.subscriber_id for update;
  -- a renewal before expiry extends from the current end, otherwise from now
  v_start := greatest(now(), coalesce(case when v_m.billing = 'sub' and v_m.status = 'active' then v_m.period_end end, now()));
  v_end := v_start + make_interval(days => v_p.period_days);
  update public.creator_memberships
     set status = 'active', billing = 'sub', price_cents = v_p.price_cents, period_index = period_index + 1, period_start = v_start, period_end = v_end, ended_at = null,
         joined_at = case when v_m.status in ('ended', 'lapsed') or v_m.period_index = 0 then now() else joined_at end
   where id = v_m.id;

  update public.sub_purchases
     set status = 'paid', paid_at = now(), provider_ref = p_provider_ref, period_start = v_start, period_end = v_end,
         available_at = now() + make_interval(days => v_p.hold_days), updated_at = now()
   where id = v_p.id;

  insert into public.sub_balances (creator_id) values (v_p.creator_id) on conflict (creator_id) do nothing;
  update public.sub_balances set pending_cents = pending_cents + v_p.price_cents, lifetime_cents = lifetime_cents + v_p.price_cents, updated_at = now()
   where creator_id = v_p.creator_id returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, purchase_id, note)
  values (v_p.creator_id, 'earning', v_p.price_cents, v_b.pending_cents, v_b.available_cents, 'purchase:' || v_p.id::text, v_p.id, 'Subscription');
  -- with no hold (the owner default), it is withdrawable at once
  if v_p.hold_days = 0 then perform public.release_sub_earnings(v_p.creator_id); end if;

  insert into public.notifications (user_id, actor_id, type, data)
  values (v_p.creator_id, v_p.subscriber_id, 'member_joined', jsonb_build_object('purchase_id', v_p.id, 'url', '/members'));
  return jsonb_build_object('ok', true, 'purchase_id', v_p.id, 'period_end', v_end);
end;
$$;

-- A refund, a chargeback or an admin reversal. Unreleased money leaves pending, released
-- money leaves available, and whatever was already withdrawn becomes debt that the next
-- earnings settle. The paid period is taken back.
create or replace function public.reverse_sub_purchase(p_reference text, p_status text, p_actor uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_p    public.sub_purchases%rowtype;
  v_b    public.sub_balances%rowtype;
  v_take bigint;
begin
  if p_status not in ('refunded', 'disputed', 'reversed') then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  select * into v_p from public.sub_purchases where reference = p_reference for update;
  if v_p.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_p.status in ('refunded', 'disputed', 'reversed') then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if v_p.status <> 'paid' then
    update public.sub_purchases set status = 'failed', updated_at = now() where id = v_p.id and status = 'initiated';
    return jsonb_build_object('ok', true, 'unpaid', true);
  end if;
  insert into public.sub_balances (creator_id) values (v_p.creator_id) on conflict (creator_id) do nothing;
  select * into v_b from public.sub_balances where creator_id = v_p.creator_id for update;
  if v_p.released_at is null then
    update public.sub_balances set pending_cents = greatest(0, pending_cents - v_p.price_cents), lifetime_cents = greatest(0, lifetime_cents - v_p.price_cents), updated_at = now()
     where creator_id = v_p.creator_id returning * into v_b;
  else
    v_take := least(v_b.available_cents, v_p.price_cents);
    update public.sub_balances
       set available_cents = available_cents - v_take, debt_cents = debt_cents + (v_p.price_cents - v_take), lifetime_cents = greatest(0, lifetime_cents - v_p.price_cents), updated_at = now()
     where creator_id = v_p.creator_id returning * into v_b;
  end if;
  update public.sub_purchases set status = p_status, reversed_at = now(), updated_at = now() where id = v_p.id;
  -- the access this payment bought is taken back
  update public.creator_memberships
     set period_end = greatest(period_start, period_end - make_interval(days => v_p.period_days)),
         status = case when period_end - make_interval(days => v_p.period_days) <= now() then 'ended' else status end,
         ended_at = case when period_end - make_interval(days => v_p.period_days) <= now() then now() else ended_at end
   where creator_id = v_p.creator_id and member_id = v_p.subscriber_id and billing = 'sub';
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, purchase_id, actor_id, note)
  values (v_p.creator_id, 'clawback', -v_p.price_cents, v_b.pending_cents, v_b.available_cents, 'purchase:' || v_p.id::text, v_p.id, p_actor, coalesce(p_note, p_status));
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_actor, 'sub_purchase_' || p_status, 'sub_purchase', v_p.id::text, p_reference, jsonb_build_object('price_cents', v_p.price_cents, 'note', p_note, 'debt_after', v_b.debt_cents));
  return jsonb_build_object('ok', true, 'debt_after', v_b.debt_cents);
end;
$$;

-- A SUB withdrawal. Every rule is checked HERE, under the balance lock: the member is not
-- restricted, the amount is at least the minimum and no more than what is available, and
-- there is no other open SUB withdrawal. Owner 2026-10-11: SUB money from a verified
-- payment is withdrawable at once, WITHOUT the reward qualification - unless the admin
-- turns p_require_qualification on. The fee is the server's percentage, never the browser's.
create or replace function public.request_sub_withdrawal(
  p_user uuid, p_gross_cents integer, p_fee_bp integer, p_min_cents integer, p_method text, p_details jsonb, p_snapshot jsonb, p_idempotency text,
  p_require_qualification boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_prof  public.reward_profiles%rowtype;
  v_b     public.sub_balances%rowtype;
  v_fee   bigint;
  v_net   bigint;
  v_id    uuid;
  v_ex    public.withdrawal_requests%rowtype;
begin
  if p_user is null or p_gross_cents is null or p_gross_cents <= 0 or p_fee_bp is null or p_fee_bp < 0 or p_fee_bp >= 10000
     or coalesce(p_idempotency, '') = '' or coalesce(p_method, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  select * into v_ex from public.withdrawal_requests where user_id = p_user and idempotency_key = p_idempotency;
  if v_ex.id is not null then return jsonb_build_object('ok', true, 'duplicate', true, 'id', v_ex.id, 'status', v_ex.status); end if;
  select * into v_prof from public.reward_profiles where user_id = p_user;
  if coalesce(p_require_qualification, false) and (v_prof.user_id is null or v_prof.qualification_status is distinct from 'approved' or v_prof.qualified_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'not_qualified');
  end if;
  if coalesce(v_prof.restricted, false) then return jsonb_build_object('ok', false, 'reason', 'restricted'); end if;
  if p_gross_cents < coalesce(p_min_cents, 0) then return jsonb_build_object('ok', false, 'reason', 'below_minimum'); end if;

  perform public.release_sub_earnings(p_user);
  select * into v_b from public.sub_balances where creator_id = p_user for update;
  if v_b.available_cents < p_gross_cents then
    return jsonb_build_object('ok', false, 'reason', 'insufficient', 'available', v_b.available_cents);
  end if;
  v_fee := (p_gross_cents::bigint * p_fee_bp) / 10000;
  v_net := p_gross_cents - v_fee;

  begin
    insert into public.withdrawal_requests (user_id, credits, amount_usd_cents, rate_snapshot, status, payout_method, payout_details, source, gross_cents, fee_cents, net_cents, fee_bp, idempotency_key)
    values (p_user, 0, v_net, coalesce(p_snapshot, '{}'::jsonb), 'pending', p_method, coalesce(p_details, '{}'::jsonb), 'sub', p_gross_cents, v_fee, v_net, p_fee_bp, p_idempotency)
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'open_exists');
  end;
  update public.sub_balances set available_cents = available_cents - p_gross_cents, held_cents = held_cents + p_gross_cents, updated_at = now()
   where creator_id = p_user returning * into v_b;
  insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, note)
  values (p_user, 'withdrawal_hold', -p_gross_cents, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || v_id::text, v_id, 'Withdrawal requested');
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_user, 'sub_withdrawal_requested', 'withdrawal', v_id::text, 'withdrawal:' || v_id::text, jsonb_build_object('gross', p_gross_cents, 'fee', v_fee, 'net', v_net, 'fee_bp', p_fee_bp, 'method', p_method));
  return jsonb_build_object('ok', true, 'id', v_id, 'gross', p_gross_cents, 'fee', v_fee, 'net', v_net);
end;
$$;

-- 0187's resolve_withdrawal, copied whole, now aware of the source: a SUB withdrawal is
-- released from (or returned to) the SUB balance and never touches the AI wallet.
create or replace function public.resolve_withdrawal(
  p_id uuid, p_status text, p_admin uuid, p_note text default null, p_payout_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w       public.withdrawal_requests%rowtype;
  v_balance bigint;
  v_b       public.sub_balances%rowtype;
begin
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status in ('completed', 'rejected', 'cancelled') then return jsonb_build_object('ok', false, 'reason', 'final', 'status', v_w.status); end if;
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

  if v_w.source = 'sub' then
    if p_status in ('completed', 'rejected', 'cancelled') then
      insert into public.sub_balances (creator_id) values (v_w.user_id) on conflict (creator_id) do nothing;
      if p_status = 'completed' then
        update public.sub_balances set held_cents = greatest(0, held_cents - v_w.gross_cents), withdrawn_cents = withdrawn_cents + v_w.gross_cents, updated_at = now()
         where creator_id = v_w.user_id returning * into v_b;
        insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
        values (v_w.user_id, 'withdrawal_paid', 0, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_admin, 'Paid ' || v_w.net_cents || ' cents, fee ' || v_w.fee_cents)
        on conflict (kind, reference) do nothing;
      else
        update public.sub_balances set held_cents = greatest(0, held_cents - v_w.gross_cents), available_cents = available_cents + v_w.gross_cents, updated_at = now()
         where creator_id = v_w.user_id returning * into v_b;
        insert into public.sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference, withdrawal_id, actor_id, note)
        values (v_w.user_id, 'withdrawal_return', v_w.gross_cents, v_b.pending_cents, v_b.available_cents, 'withdrawal:' || p_id::text, p_id, p_admin, 'Withdrawal ' || p_status)
        on conflict (kind, reference) do nothing;
      end if;
    end if;
  elsif p_status = 'completed' then
    update public.ai_product_ledger set status = 'settled', updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal';
  elsif p_status in ('rejected', 'cancelled') then
    insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
    values (v_w.user_id, 'character_replace', 'withdrawal_reversal', 'settled', v_w.credits, 0, 'CREDIT', 'withdrawal:' || p_id::text, 'Withdrawal ' || p_status, 'withdrawable', v_w.credits, jsonb_build_object('withdrawal_id', p_id))
    on conflict (user_id, product, kind, reference) where reference is not null do nothing;
    if found then
      update public.ai_product_balances set balance_cents = balance_cents + v_w.credits, withdrawable_cents = withdrawable_cents + v_w.credits, updated_at = now()
       where user_id = v_w.user_id and product = 'character_replace' returning balance_cents into v_balance;
      update public.ai_product_ledger set balance_after_cents = v_balance, updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal_reversal';
      update public.ai_product_ledger set status = 'reversed', updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal';
    end if;
  end if;
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'withdrawal_' || p_status, 'withdrawal', p_id::text, coalesce(p_payout_ref, 'withdrawal:' || p_id::text), jsonb_build_object('source', v_w.source, 'from', v_w.status, 'note', p_note));
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', p_status, 'credits', v_w.credits, 'source', v_w.source, 'net_cents', v_w.net_cents));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

do $$
begin
  execute 'revoke all on function public.release_sub_earnings(uuid) from public, anon, authenticated';
  execute 'revoke all on function public.settle_sub_purchase(text, bigint, text, text) from public, anon, authenticated';
  execute 'revoke all on function public.reverse_sub_purchase(text, text, uuid, text) from public, anon, authenticated';
  execute 'revoke all on function public.request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean) from public, anon, authenticated';
  execute 'revoke all on function public.resolve_withdrawal(uuid, text, uuid, text, text) from public, anon, authenticated';
  execute 'grant execute on function public.release_sub_earnings(uuid) to service_role';
  execute 'grant execute on function public.settle_sub_purchase(text, bigint, text, text) to service_role';
  execute 'grant execute on function public.reverse_sub_purchase(text, text, uuid, text) to service_role';
  execute 'grant execute on function public.request_sub_withdrawal(uuid, integer, integer, integer, text, jsonb, jsonb, text, boolean) to service_role';
  execute 'grant execute on function public.resolve_withdrawal(uuid, text, uuid, text, text) to service_role';
end;
$$;
