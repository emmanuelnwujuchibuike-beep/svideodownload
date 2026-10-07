-- ═══════════════════════════════════════════════════════════════════════════
--  0187 — ONE REWARD ENGINE, ONE REFERRAL ATTRIBUTION, TWO CREDIT CLASSES
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner brief "credit, referral and reward — part 1" (2026-10-07). Decisions
-- the same day: spend purchased + usable first and WITHDRAWABLE LAST; payouts
-- are manual (admin) in v1; one qualifying engagement = one rewarded referral
-- event; the +5 AI-video reward is for PAID generations (admin may widen).
--
-- ── What this extends, and what it adds ─────────────────────────────────────
--   ONE wallet stays ONE wallet (ai_product_balances / ai_product_ledger, the
--   CREDIT unit since 0184). It gains:
--     · `withdrawable_cents` on the balance — the part of the balance that is
--       cashable (always ≤ the balance); everything else is usable only;
--     · `credit_class` + `withdrawable_part` on each ledger row — how much of a
--       movement was withdrawable, written once and never recomputed;
--     · kinds `withdrawal` and `withdrawal_reversal`.
--   Spending takes the NON-withdrawable part first (reserve, operator debits);
--   a refund gives back exactly the withdrawable part it took.
--
--   Rewards (new): `reward_events` — one immutable row per reward, unique per
--   (beneficiary, role, event, dedupe key), with the class, the amount, the
--   qualification at the moment and the rule version; `reward_profiles` — a
--   member's qualification (set ONCE, never recomputed) and any restriction.
--   `process_reward_event` is THE engine: read the operator's rules, verify
--   the facts the event depends on, reward the actor and/or the referrer,
--   classify, credit the wallet and write the in-app notification — atomically.
--   Database triggers call it for what the database sees happen (an AI job
--   completing, a follow, a like/save, a comment, a download, a plan, a
--   top-up); the server calls it for the rest (publishing an AI reel, a
--   referred signup). The browser never calls it.
--
--   Attribution (new): `share_links` (secure token → owner, content) and
--   `referral_attributions` (one referrer per referred member, first touch,
--   never self, never a loop).
--
--   AI Reels: `posts.content_type` ('standard' | 'ai_video' | 'ai_audio') and
--   `posts.ai_job_id` (unique) — the existing feed, nothing separate.
--
--   Withdrawals (new): `withdrawal_requests`, paid out by an admin by hand.
--
-- Order: plain DDL, then functions, then triggers and grants in ONE do-block
-- (the 0130 lesson). Every trigger body swallows its own errors: a reward can
-- never block a like, a follow or an AI job from completing.

-- ── 1 · the wallet learns which part is cashable ─────────────────────────────
alter table public.ai_product_balances add column if not exists withdrawable_cents bigint not null default 0;
alter table public.ai_product_balances drop constraint if exists ai_product_balances_withdrawable_chk;
alter table public.ai_product_balances add constraint ai_product_balances_withdrawable_chk check (withdrawable_cents >= 0 and withdrawable_cents <= balance_cents);

alter table public.ai_product_ledger add column if not exists credit_class text;
alter table public.ai_product_ledger add column if not exists withdrawable_part bigint not null default 0;
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_credit_class_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_credit_class_chk check (credit_class is null or credit_class in ('purchased', 'usable', 'withdrawable'));

alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_kind_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_kind_chk
  check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal'));
alter table public.ai_product_ledger drop constraint if exists ai_product_ledger_sign_chk;
alter table public.ai_product_ledger add constraint ai_product_ledger_sign_chk check (
  (kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal') and delta_cents > 0)
  or (kind in ('processing_charge', 'reversal', 'withdrawal') and delta_cents < 0)
  or (kind = 'adjustment' and delta_cents <> 0)
);

comment on column public.ai_product_balances.withdrawable_cents is 'The cashable part of balance_cents (0187): reward credits earned after withdrawal qualification, minus what was spent or withdrawn from them. Always ≤ balance_cents.';
comment on column public.ai_product_ledger.withdrawable_part is 'How much of this movement was withdrawable credit (0187) — a refund returns exactly this part.';

-- ── 2 · AI Reels on the existing posts ───────────────────────────────────────
alter table public.posts add column if not exists content_type text not null default 'standard';
alter table public.posts add column if not exists ai_job_id uuid references public.ai_jobs (id) on delete set null;
alter table public.posts drop constraint if exists posts_content_type_chk;
alter table public.posts add constraint posts_content_type_chk check (content_type in ('standard', 'ai_video', 'ai_audio'));
create unique index if not exists posts_ai_job_uidx on public.posts (ai_job_id) where ai_job_id is not null;
create index if not exists posts_ai_feed_idx on public.posts (content_type, created_at desc) where content_type <> 'standard';

-- ── 3 · attribution ──────────────────────────────────────────────────────────
create table if not exists public.share_links (
  token        text primary key,
  owner_id     uuid not null references auth.users (id) on delete cascade,
  content_type text not null,
  content_id   text not null,
  ai_job_id    uuid references public.ai_jobs (id) on delete set null,
  clicks       integer not null default 0,
  signups      integer not null default 0,
  created_at   timestamptz not null default now(),
  constraint share_links_content_type_chk check (content_type in ('profile', 'post', 'reel', 'ai_video', 'ai_audio', 'app'))
);
create unique index if not exists share_links_owner_content_uidx on public.share_links (owner_id, content_type, content_id);

create table if not exists public.referral_attributions (
  referred_user_id uuid primary key references auth.users (id) on delete cascade,
  referrer_id      uuid not null references auth.users (id) on delete cascade,
  share_token      text references public.share_links (token) on delete set null,
  content_type     text,
  content_id       text,
  status           text not null default 'active',
  block_reason     text,
  attributed_at    timestamptz not null default now(),
  constraint referral_attributions_not_self_chk check (referred_user_id <> referrer_id),
  constraint referral_attributions_status_chk check (status in ('active', 'blocked'))
);
create index if not exists referral_attributions_referrer_idx on public.referral_attributions (referrer_id, attributed_at desc);

-- ── 4 · rewards ──────────────────────────────────────────────────────────────
create table if not exists public.reward_profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  qualified_at            timestamptz,
  qualifying_engagements  integer not null default 0,
  restricted              boolean not null default false,
  restricted_reason       text,
  restricted_by           uuid references auth.users (id) on delete set null,
  updated_at              timestamptz not null default now()
);

create table if not exists public.reward_events (
  id                 uuid primary key default uuid_generate_v4(),
  beneficiary_id     uuid not null references auth.users (id) on delete cascade,
  role               text not null,
  event_type         text not null,
  source_type        text not null,
  source_id          text not null,
  actor_user_id      uuid references auth.users (id) on delete set null,
  referred_user_id   uuid references auth.users (id) on delete set null,
  amount             integer not null,
  credit_class       text not null,
  qualified_at_event boolean not null,
  rule_version       integer not null default 1,
  dedupe_key         text not null,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  constraint reward_events_role_chk check (role in ('actor', 'referrer')),
  constraint reward_events_class_chk check (credit_class in ('usable', 'withdrawable')),
  constraint reward_events_amount_chk check (amount > 0)
);
create unique index if not exists reward_events_once_uidx on public.reward_events (beneficiary_id, role, event_type, dedupe_key);
create index if not exists reward_events_beneficiary_idx on public.reward_events (beneficiary_id, created_at desc);
create index if not exists reward_events_created_idx on public.reward_events (created_at desc);
create index if not exists reward_events_source_idx on public.reward_events (source_type, source_id);

-- ── 5 · withdrawals ──────────────────────────────────────────────────────────
create table if not exists public.withdrawal_requests (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  credits          integer not null,
  amount_usd_cents integer not null,
  rate_snapshot    jsonb not null default '{}'::jsonb,
  status           text not null default 'pending',
  payout_method    text not null,
  payout_details   jsonb not null default '{}'::jsonb,
  payout_reference text,
  review_note      text,
  reviewed_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz,
  constraint withdrawal_requests_credits_chk check (credits > 0 and amount_usd_cents >= 0),
  constraint withdrawal_requests_status_chk check (status in ('pending', 'reviewing', 'approved', 'processing', 'completed', 'rejected', 'cancelled'))
);
create index if not exists withdrawal_requests_user_idx on public.withdrawal_requests (user_id, created_at desc);
create index if not exists withdrawal_requests_open_idx on public.withdrawal_requests (status, created_at) where status in ('pending', 'reviewing', 'approved', 'processing');

-- RLS: members read their own; nobody writes through the API
alter table public.share_links enable row level security;
alter table public.referral_attributions enable row level security;
alter table public.reward_profiles enable row level security;
alter table public.reward_events enable row level security;
alter table public.withdrawal_requests enable row level security;

-- ── 6 · notifications learn the reward types ─────────────────────────────────
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
    'reward_earned','referral_reward','withdrawal_update'
  )
);

-- ════════════════════════════════════════════════════════════════════════════
--  Functions
-- ════════════════════════════════════════════════════════════════════════════

-- The rule for an event when the operator has saved none — the SAME defaults as
-- lib/rewards/config.ts (a test keeps the two in step).
create or replace function public.reward_default_rule(p_event text) returns jsonb
language sql immutable as $$
  select case p_event
    when 'ai_video_completed' then '{"enabled":true,"actorCredits":5,"referrerCredits":5,"referrerRepeatable":false,"includeComplimentary":false,"features":["ai_text_to_video","ai_image_to_video"]}'::jsonb
    when 'ai_video_shared'    then '{"enabled":true,"actorCredits":3,"referrerCredits":0,"referrerRepeatable":false,"minDurationSeconds":30}'::jsonb
    else '{"enabled":false,"actorCredits":0,"referrerCredits":0,"referrerRepeatable":false}'::jsonb
  end
$$;

-- One reward to one member: classified, credited, notified — or nothing if this
-- (member, role, event, dedupe key) was already rewarded or the member is restricted.
create or replace function public.grant_reward(
  p_beneficiary uuid, p_role text, p_event text, p_source_type text, p_source_id text,
  p_actor uuid, p_referred uuid, p_amount integer, p_dedupe text, p_cfg jsonb, p_metadata jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile   public.reward_profiles%rowtype;
  v_created   timestamptz;
  v_min_days  integer := coalesce(nullif(p_cfg #>> '{qualification,minAccountAgeDays}', '')::integer, 30);
  v_min_eng   integer := coalesce(nullif(p_cfg #>> '{qualification,minEngagements}', '')::integer, 100);
  v_version   integer := coalesce(nullif(p_cfg ->> 'version', '')::integer, 1);
  v_class     text;
  v_id        uuid;
  v_wallet    text;
  v_balance   bigint;
  v_wpart     bigint;
begin
  if p_beneficiary is null or p_amount is null or p_amount <= 0 then return null; end if;
  perform pg_advisory_xact_lock(hashtext('rewards:' || p_beneficiary::text));

  insert into public.reward_profiles (user_id) values (p_beneficiary) on conflict (user_id) do nothing;
  select * into v_profile from public.reward_profiles where user_id = p_beneficiary for update;
  if v_profile.restricted then return null; end if;

  -- qualification, decided NOW and written once (never re-evaluated for past rewards)
  if v_profile.qualified_at is null then
    select created_at into v_created from auth.users where id = p_beneficiary;
    if v_created is not null and v_created <= now() - make_interval(days => greatest(0, v_min_days)) and v_profile.qualifying_engagements >= greatest(0, v_min_eng) then
      update public.reward_profiles set qualified_at = now(), updated_at = now() where user_id = p_beneficiary returning * into v_profile;
    end if;
  end if;
  v_class := case when v_profile.qualified_at is not null then 'withdrawable' else 'usable' end;

  -- the once-only row — its unique index IS the idempotency
  insert into public.reward_events (beneficiary_id, role, event_type, source_type, source_id, actor_user_id, referred_user_id, amount, credit_class, qualified_at_event, rule_version, dedupe_key, metadata)
  values (p_beneficiary, p_role, p_event, p_source_type, p_source_id, p_actor, p_referred, p_amount, v_class, v_profile.qualified_at is not null, v_version, p_dedupe, coalesce(p_metadata, '{}'::jsonb))
  on conflict (beneficiary_id, role, event_type, dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;

  -- the wallet: the one balance, the cashable part when withdrawable
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (p_beneficiary, 'character_replace', 0, 'CREDIT') on conflict (user_id, product) do nothing;
  select currency into v_wallet from public.ai_product_balances where user_id = p_beneficiary and product = 'character_replace' for update;
  if v_wallet <> 'CREDIT' then raise exception 'wallet unit mismatch: wallet is %, reward is CREDIT', v_wallet; end if;
  v_wpart := case when v_class = 'withdrawable' then p_amount else 0 end;
  update public.ai_product_balances
     set balance_cents = balance_cents + p_amount, withdrawable_cents = withdrawable_cents + v_wpart, updated_at = now()
   where user_id = p_beneficiary and product = 'character_replace'
  returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, credit_class, withdrawable_part)
  values (p_beneficiary, 'character_replace', 'grant', 'settled', p_amount, v_balance, 'CREDIT', 'reward:' || v_id::text, 'Reward · ' || replace(p_event, '_', ' '),
          jsonb_build_object('reward_id', v_id, 'event', p_event, 'role', p_role, 'source_type', p_source_type, 'source_id', p_source_id), v_class, v_wpart);

  if p_role = 'referrer' then
    update public.reward_profiles set qualifying_engagements = qualifying_engagements + 1, updated_at = now() where user_id = p_beneficiary;
  end if;

  -- in-app, in the same transaction (the push is sent by the server after commit)
  insert into public.notifications (user_id, actor_id, type, data)
  values (p_beneficiary, case when p_role = 'referrer' then p_actor else null end, case when p_role = 'referrer' then 'referral_reward' else 'reward_earned' end,
          jsonb_build_object('reward_id', v_id, 'event', p_event, 'credits', p_amount, 'credit_class', v_class, 'source_type', p_source_type, 'source_id', p_source_id,
            'title', 'You earned ' || p_amount || case when p_amount = 1 then ' credit' else ' credits' end,
            'body', case when p_role = 'referrer' then 'Someone you invited: ' else '' end || initcap(replace(p_event, '_', ' ')) || case when v_class = 'withdrawable' then ' · withdrawable' else '' end,
            'url', '/studio/ai/usage'));

  return jsonb_build_object('reward_id', v_id, 'beneficiary_id', p_beneficiary, 'role', p_role, 'event', p_event, 'amount', p_amount, 'credit_class', v_class, 'balance_after', v_balance);
end;
$$;

-- THE ENGINE. Verifies the facts an event depends on (never the caller's word),
-- then rewards the actor and the actor's referrer under the operator's rules.
create or replace function public.process_reward_event(
  p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cfg       jsonb;
  v_rule      jsonb;
  v_actor_amt integer;
  v_ref_amt   integer;
  v_referrer  uuid;
  v_out       jsonb := '[]'::jsonb;
  v_r         jsonb;
  v_job       record;
  v_min       numeric;
begin
  if p_event is null or p_actor is null or p_source_id is null then return v_out; end if;
  select value -> 'frenzRewards' into v_cfg from public.settings where key = 'landing';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) = false then return v_out; end if;
  v_rule := public.reward_default_rule(p_event) || coalesce(v_cfg -> 'events' -> p_event, '{}'::jsonb);
  if coalesce((v_rule ->> 'enabled')::boolean, false) = false then return v_out; end if;
  v_actor_amt := greatest(0, coalesce((v_rule ->> 'actorCredits')::integer, 0));
  v_ref_amt   := greatest(0, coalesce((v_rule ->> 'referrerCredits')::integer, 0));
  if v_actor_amt = 0 and v_ref_amt = 0 then return v_out; end if;

  -- 🔴 the facts, from the database
  if p_event = 'ai_video_completed' or p_event = 'ai_audio_completed' then
    select id, user_id, feature, status, funding_source, result_path into v_job from public.ai_jobs where id = p_source_id::uuid;
    if v_job.id is null or v_job.user_id is distinct from p_actor or v_job.status <> 'completed' or v_job.result_path is null then return v_out; end if;
    if p_event = 'ai_video_completed' and not (coalesce(v_rule -> 'features', '[]'::jsonb) ? v_job.feature) then return v_out; end if;
    if v_job.funding_source = 'free' and coalesce((v_rule ->> 'includeComplimentary')::boolean, false) = false then return v_out; end if;
  elsif p_event = 'ai_video_shared' then
    v_min := coalesce(nullif(v_rule ->> 'minDurationSeconds', '')::numeric, 30);
    perform 1 from public.ai_jobs j join public.posts p on p.ai_job_id = j.id
     where j.id = p_source_id::uuid and j.user_id = p_actor and p.publisher_id = p_actor and j.status = 'completed'
       and coalesce(j.result_duration, 0) >= v_min - 0.05 and p.content_type = 'ai_video' and p.status = 'published' and p.visibility = 'public';
    if not found then return v_out; end if;
  end if;

  -- the actor: once per source (a job, a post, a followee), or once ever for a once-per-member event
  if v_actor_amt > 0 then
    v_r := public.grant_reward(p_actor, 'actor', p_event, p_source_type, p_source_id, p_actor, null, v_actor_amt,
             case when coalesce((v_rule ->> 'actorOncePerUser')::boolean, false) then 'member' else p_source_type || ':' || p_source_id end, v_cfg, p_metadata);
    if v_r is not null then v_out := v_out || jsonb_build_array(v_r); end if;
  end if;

  -- the referrer: ONE referred member + ONE event type = ONE reward, unless the operator made it repeatable
  if v_ref_amt > 0 then
    select referrer_id into v_referrer from public.referral_attributions where referred_user_id = p_actor and status = 'active';
    if v_referrer is not null and v_referrer <> p_actor then
      v_r := public.grant_reward(v_referrer, 'referrer', p_event, p_source_type, p_source_id, p_actor, p_actor, v_ref_amt,
               case when coalesce((v_rule ->> 'referrerRepeatable')::boolean, false) then p_actor::text || ':' || p_source_type || ':' || p_source_id else p_actor::text end, v_cfg, p_metadata);
      if v_r is not null then v_out := v_out || jsonb_build_array(v_r); end if;
    end if;
  end if;
  return v_out;
end;
$$;

-- A click on a share link: counted, and the link's owner/content returned for the redirect.
create or replace function public.record_share_click(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_link public.share_links%rowtype;
begin
  update public.share_links set clicks = clicks + 1 where token = p_token returning * into v_link;
  if v_link.token is null then return null; end if;
  return jsonb_build_object('owner_id', v_link.owner_id, 'content_type', v_link.content_type, 'content_id', v_link.content_id);
end;
$$;

-- A NEW member who arrived through a share link: attributed once, never to themselves, never in a loop.
create or replace function public.attribute_referral(p_referred uuid, p_token text, p_window_days integer default 7) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_link    public.share_links%rowtype;
  v_created timestamptz;
  v_rewards jsonb;
begin
  select * into v_link from public.share_links where token = p_token;
  if v_link.token is null then return jsonb_build_object('ok', false, 'reason', 'unknown_link'); end if;
  if v_link.owner_id = p_referred then return jsonb_build_object('ok', false, 'reason', 'self'); end if;
  select created_at into v_created from auth.users where id = p_referred;
  if v_created is null or v_created < now() - make_interval(days => greatest(1, p_window_days)) then return jsonb_build_object('ok', false, 'reason', 'not_new'); end if;
  -- a loop: the referrer was themselves referred by this member
  if exists (select 1 from public.referral_attributions where referred_user_id = v_link.owner_id and referrer_id = p_referred) then
    return jsonb_build_object('ok', false, 'reason', 'loop');
  end if;
  insert into public.referral_attributions (referred_user_id, referrer_id, share_token, content_type, content_id)
  values (p_referred, v_link.owner_id, v_link.token, v_link.content_type, v_link.content_id)
  on conflict (referred_user_id) do nothing;
  if not found then return jsonb_build_object('ok', false, 'reason', 'already_attributed'); end if;
  update public.share_links set signups = signups + 1 where token = p_token;
  v_rewards := public.process_reward_event('account_created', p_referred, 'account', p_referred::text, jsonb_build_object('share_token', p_token));
  return jsonb_build_object('ok', true, 'referrer_id', v_link.owner_id, 'rewards', v_rewards);
end;
$$;

-- ── spending: the NON-withdrawable part first; the part taken is written on the row ──
create or replace function public.reserve_product_charge(
  p_user_id  uuid,
  p_product  text,
  p_job_id   uuid,
  p_amount   bigint,
  p_currency text default 'CREDIT',
  p_snapshot jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_wd      bigint;
  v_wallet  text;
  v_wpart   bigint;
begin
  if p_amount is null or p_amount < 0 then raise exception 'charge cannot be negative'; end if;
  if exists (select 1 from public.ai_product_ledger where user_id = p_user_id and product = p_product and kind = 'processing_charge' and reference = p_job_id::text) then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  select balance_cents, withdrawable_cents, currency into v_balance, v_wd, v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product for update;
  if p_amount = 0 then return coalesce(v_balance, 0); end if;
  if v_wallet is not null and v_wallet <> coalesce(p_currency, '') then raise exception 'wallet unit mismatch: wallet is %, charge is %', v_wallet, p_currency; end if;
  if v_balance is null or v_balance < p_amount then raise exception 'insufficient product balance'; end if;
  -- 🔴 0187: cashable credit is spent LAST (owner, 2026-10-07)
  v_wpart := greatest(0, p_amount - (v_balance - v_wd));
  update public.ai_product_balances
     set balance_cents = balance_cents - p_amount, withdrawable_cents = withdrawable_cents - v_wpart, updated_at = now()
   where user_id = p_user_id and product = p_product
  returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, job_id, reference, snapshot, withdrawable_part)
  values (p_user_id, p_product, 'processing_charge', 'reserved', -p_amount, v_balance, p_currency, p_job_id, p_job_id::text, p_snapshot, v_wpart);
  return v_balance;
end;
$$;

create or replace function public.refund_product_charge(
  p_user_id uuid,
  p_product text,
  p_job_id  uuid,
  p_note    text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_charged  bigint;
  v_currency text;
  v_wpart    bigint;
  v_wallet   text;
  v_balance  bigint;
begin
  select -delta_cents, currency, withdrawable_part into v_charged, v_currency, v_wpart
    from public.ai_product_ledger
   where user_id = p_user_id and product = p_product and kind = 'processing_charge'
     and reference = p_job_id::text and status in ('reserved', 'settled');
  if v_charged is null or v_charged <= 0 then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  select currency, balance_cents into v_wallet, v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product for update;
  if v_wallet is not null and coalesce(v_currency, v_wallet) <> v_wallet then
    raise warning 'refund_product_charge: job % charged in % but the wallet is % — nothing written; settle by adjustment', p_job_id, v_currency, v_wallet;
    return coalesce(v_balance, 0);
  end if;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, job_id, reference, note, withdrawable_part)
  values (p_user_id, p_product, 'refund', 'settled', v_charged, 0, coalesce(v_currency, v_wallet, 'CREDIT'), p_job_id, p_job_id::text, p_note, coalesce(v_wpart, 0))
  on conflict (user_id, product, kind, reference) where reference is not null do nothing;
  if not found then
    select balance_cents into v_balance from public.ai_product_balances where user_id = p_user_id and product = p_product;
    return coalesce(v_balance, 0);
  end if;
  -- the withdrawable part comes back as withdrawable, the rest as usable
  update public.ai_product_balances
     set balance_cents = balance_cents + v_charged, withdrawable_cents = withdrawable_cents + coalesce(v_wpart, 0), updated_at = now()
   where user_id = p_user_id and product = p_product
  returning balance_cents into v_balance;
  update public.ai_product_ledger set balance_after_cents = coalesce(v_balance, v_charged), updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'refund' and reference = p_job_id::text;
  update public.ai_product_ledger set status = 'refunded', updated_at = now()
   where user_id = p_user_id and product = p_product and kind = 'processing_charge' and reference = p_job_id::text;
  return coalesce(v_balance, 0);
end;
$$;

create or replace function public.adjust_product_balance(
  p_user_id   uuid,
  p_product   text,
  p_delta     bigint,
  p_reference text,
  p_note      text,
  p_admin_id  uuid,
  p_currency  text default 'CREDIT'
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_wd      bigint;
  v_wallet  text;
  v_wpart   bigint := 0;
begin
  if p_delta is null or p_delta = 0 then raise exception 'an adjustment must move something'; end if;
  if p_admin_id is null then raise exception 'an adjustment needs an actor'; end if;
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'an adjustment needs a reason'; end if;
  if p_reference is null or length(p_reference) = 0 then raise exception 'an adjustment needs a reference'; end if;
  insert into public.ai_product_balances (user_id, product, balance_cents, currency) values (p_user_id, p_product, 0, p_currency) on conflict (user_id, product) do nothing;
  select balance_cents, withdrawable_cents, currency into v_balance, v_wd, v_wallet from public.ai_product_balances where user_id = p_user_id and product = p_product for update;
  if v_wallet <> p_currency then raise exception 'wallet unit mismatch: wallet is %, adjustment is %', v_wallet, p_currency; end if;
  if exists (select 1 from public.ai_product_ledger where user_id = p_user_id and product = p_product and kind = 'adjustment' and reference = p_reference) then
    return v_balance;
  end if;
  if p_delta < 0 then
    if v_balance < -p_delta then raise exception 'insufficient product balance for debit'; end if;
    v_wpart := greatest(0, -p_delta - (v_balance - v_wd));
  end if;
  update public.ai_product_balances
     set balance_cents = balance_cents + p_delta, withdrawable_cents = withdrawable_cents - v_wpart, updated_at = now()
   where user_id = p_user_id and product = p_product
  returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, actor_admin_id, withdrawable_part, credit_class)
  values (p_user_id, p_product, 'adjustment', 'settled', p_delta, v_balance, p_currency, p_reference, p_note, p_admin_id, v_wpart, case when p_delta > 0 then 'usable' else null end);
  return v_balance;
end;
$$;

-- ── withdrawals: only the cashable part, held at request, returned on rejection ──
create or replace function public.request_withdrawal(
  p_user_id uuid, p_credits integer, p_usd_cents integer, p_method text, p_details jsonb, p_snapshot jsonb, p_status text default 'pending'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_balance bigint;
  v_wd      bigint;
  v_wallet  text;
  v_id      uuid;
begin
  if p_credits is null or p_credits <= 0 then raise exception 'a withdrawal must be positive'; end if;
  if p_status not in ('pending', 'reviewing') then raise exception 'a new withdrawal starts pending or reviewing'; end if;
  select balance_cents, withdrawable_cents, currency into v_balance, v_wd, v_wallet from public.ai_product_balances where user_id = p_user_id and product = 'character_replace' for update;
  if v_wallet is distinct from 'CREDIT' then return jsonb_build_object('ok', false, 'reason', 'no_wallet'); end if;
  if v_wd < p_credits then return jsonb_build_object('ok', false, 'reason', 'insufficient_withdrawable', 'withdrawable', v_wd); end if;
  if exists (select 1 from public.reward_profiles where user_id = p_user_id and restricted) then return jsonb_build_object('ok', false, 'reason', 'restricted'); end if;
  insert into public.withdrawal_requests (user_id, credits, amount_usd_cents, rate_snapshot, status, payout_method, payout_details)
  values (p_user_id, p_credits, p_usd_cents, coalesce(p_snapshot, '{}'::jsonb), p_status, p_method, coalesce(p_details, '{}'::jsonb))
  returning id into v_id;
  update public.ai_product_balances
     set balance_cents = balance_cents - p_credits, withdrawable_cents = withdrawable_cents - p_credits, updated_at = now()
   where user_id = p_user_id and product = 'character_replace'
  returning balance_cents into v_balance;
  insert into public.ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, credit_class, withdrawable_part, metadata)
  values (p_user_id, 'character_replace', 'withdrawal', 'reserved', -p_credits, v_balance, 'CREDIT', 'withdrawal:' || v_id::text, 'Withdrawal requested', 'withdrawable', p_credits, jsonb_build_object('withdrawal_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id, 'balance_after', v_balance, 'withdrawable_after', v_wd - p_credits);
end;
$$;

create or replace function public.resolve_withdrawal(
  p_id uuid, p_status text, p_admin uuid, p_note text default null, p_payout_ref text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_w       public.withdrawal_requests%rowtype;
  v_balance bigint;
begin
  select * into v_w from public.withdrawal_requests where id = p_id for update;
  if v_w.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if v_w.status in ('completed', 'rejected', 'cancelled') then return jsonb_build_object('ok', false, 'reason', 'final', 'status', v_w.status); end if;
  -- the allowed moves; anything else is refused
  if not (
       (v_w.status = 'pending' and p_status in ('reviewing', 'approved', 'rejected', 'cancelled'))
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
  if p_status = 'completed' then
    update public.ai_product_ledger set status = 'settled', updated_at = now() where reference = 'withdrawal:' || p_id::text and kind = 'withdrawal';
  elsif p_status in ('rejected', 'cancelled') then
    -- the credits come back, cashable as they left — once (the unique reference)
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
  insert into public.notifications (user_id, type, data) values (v_w.user_id, 'withdrawal_update', jsonb_build_object('withdrawal_id', p_id, 'status', p_status, 'credits', v_w.credits));
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

-- ── what the database sees happen → the engine (errors never escape) ─────────
create or replace function public.reward_on_ai_job() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.user_id is not null then
    begin
      if new.feature = 'ai_text_to_audio' then
        perform public.process_reward_event('ai_audio_completed', new.user_id, 'ai_job', new.id::text, '{}'::jsonb);
      else
        perform public.process_reward_event('ai_video_completed', new.user_id, 'ai_job', new.id::text, '{}'::jsonb);
      end if;
    exception when others then
      raise warning 'reward_on_ai_job: % (job %)', sqlerrm, new.id;
    end;
  end if;
  return new;
end;
$$;

create or replace function public.reward_on_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'follows' then
      perform public.process_reward_event('follow', new.follower_id, 'profile', new.following_id::text, '{}'::jsonb);
    elsif tg_table_name = 'post_reactions' then
      perform public.process_reward_event(case when new.type = 'save' then 'save' else 'post_engagement' end, new.user_id, 'post', new.post_id::text, jsonb_build_object('reaction', new.type));
    elsif tg_table_name = 'post_comments' then
      perform public.process_reward_event('post_engagement', new.author_id, 'post', new.post_id::text, jsonb_build_object('comment', new.id));
    elsif tg_table_name = 'downloads' then
      perform public.process_reward_event('download_completed', new.user_id, 'download', new.id::text, '{}'::jsonb);
    elsif tg_table_name = 'ai_subscriptions' then
      if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
        perform public.process_reward_event('subscription_started', new.user_id, 'ai_subscription', new.user_id::text || ':' || coalesce(new.last_reference, ''), jsonb_build_object('plan', new.plan));
      end if;
    elsif tg_table_name = 'ai_product_ledger' then
      if new.kind = 'recharge' then
        perform public.process_reward_event('wallet_topup', new.user_id, 'topup', new.reference, jsonb_build_object('credits', new.delta_cents));
      end if;
    end if;
  exception when others then
    raise warning 'reward_on_activity(%): %', tg_table_name, sqlerrm;
  end;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  Triggers, policies and grants — ONE block, last
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  fn text;
begin
  execute 'drop trigger if exists reward_on_ai_job_trg on public.ai_jobs';
  execute 'create trigger reward_on_ai_job_trg after update of status on public.ai_jobs for each row execute function public.reward_on_ai_job()';
  execute 'drop trigger if exists reward_on_follow_trg on public.follows';
  execute 'create trigger reward_on_follow_trg after insert on public.follows for each row execute function public.reward_on_activity()';
  execute 'drop trigger if exists reward_on_reaction_trg on public.post_reactions';
  execute 'create trigger reward_on_reaction_trg after insert on public.post_reactions for each row execute function public.reward_on_activity()';
  execute 'drop trigger if exists reward_on_comment_trg on public.post_comments';
  execute 'create trigger reward_on_comment_trg after insert on public.post_comments for each row execute function public.reward_on_activity()';
  execute 'drop trigger if exists reward_on_download_trg on public.downloads';
  execute 'create trigger reward_on_download_trg after insert on public.downloads for each row execute function public.reward_on_activity()';
  execute 'drop trigger if exists reward_on_ai_subscription_trg on public.ai_subscriptions';
  execute 'create trigger reward_on_ai_subscription_trg after insert or update of status on public.ai_subscriptions for each row execute function public.reward_on_activity()';
  execute 'drop trigger if exists reward_on_topup_trg on public.ai_product_ledger';
  execute 'create trigger reward_on_topup_trg after insert on public.ai_product_ledger for each row when (new.kind = ''recharge'') execute function public.reward_on_activity()';

  if not exists (select 1 from pg_policies where tablename = 'reward_events' and policyname = 'reward_events_select_own') then
    execute 'create policy reward_events_select_own on public.reward_events for select using (auth.uid() = beneficiary_id)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'reward_profiles' and policyname = 'reward_profiles_select_own') then
    execute 'create policy reward_profiles_select_own on public.reward_profiles for select using (auth.uid() = user_id)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'withdrawal_requests' and policyname = 'withdrawal_requests_select_own') then
    execute 'create policy withdrawal_requests_select_own on public.withdrawal_requests for select using (auth.uid() = user_id)';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'share_links' and policyname = 'share_links_select_own') then
    execute 'create policy share_links_select_own on public.share_links for select using (auth.uid() = owner_id)';
  end if;
  execute 'revoke insert, update, delete on table public.share_links, public.referral_attributions, public.reward_profiles, public.reward_events, public.withdrawal_requests from anon, authenticated';

  -- 🔴 REVOKE. POSTGRES GRANTS EXECUTE TO PUBLIC BY DEFAULT — a definer function with a user id argument is "anyone rewards anyone".
  foreach fn in array array[
    'public.grant_reward(uuid, text, text, text, text, uuid, uuid, integer, text, jsonb, jsonb)',
    'public.process_reward_event(text, uuid, text, text, jsonb)',
    'public.record_share_click(text)',
    'public.attribute_referral(uuid, text, integer)',
    'public.reserve_product_charge(uuid, text, uuid, bigint, text, jsonb)',
    'public.refund_product_charge(uuid, text, uuid, text)',
    'public.adjust_product_balance(uuid, text, bigint, text, text, uuid, text)',
    'public.request_withdrawal(uuid, integer, integer, text, jsonb, jsonb, text)',
    'public.resolve_withdrawal(uuid, text, uuid, text, text)',
    'public.reward_on_ai_job()',
    'public.reward_on_activity()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;
