-- 0252 — Frenz Exclusive Part 7: creator earnings / analytics and the admin subscription overview,
-- computed IN THE DATABASE from the existing financial records (docs/SUB_MONETIZATION.md
-- "Frenz Exclusive Part 7"). No new ledger, no new balance, no rollup table: three read-only
-- aggregate functions over sub_ledger, sub_purchases, creator_memberships, withdrawal_requests,
-- sub_posts and their likes/comments, plus the indexes their period filters use.
--
--   sub_creator_summary(creator, since)   one creator, one period: earnings and clawbacks (sub_ledger,
--                                         USD cents), settled purchases split into new and renewal, what
--                                         subscribers paid PER CHARGED CURRENCY, refunds, access ended,
--                                         standing cancellations, withdrawals, posts, likes, comments.
--   sub_creator_daily(creator, since)     the same earnings and new/renewal counts per UTC day, zero-filled.
--   sub_admin_summary(since)              platform-wide: memberships, settled purchases (gross per
--                                         currency, creator share, platform fee), refunds, refund_due,
--                                         open withdrawals, exclusive moderation counts.
--
-- Definitions (the app shows them in words):
--   settled purchase  paid_at is set and status is not 'refund_due' (a payment after removal granted no
--                     access and earned nothing). A later refund does not un-settle it; refunds are
--                     reported separately, by reversed_at.
--   new / renewal     a settled purchase is NEW when no earlier settled purchase exists for the same
--                     creator and subscriber; otherwise it is a RENEWAL.
--   access ended      a paid membership (not removed) whose period_end fell inside the period.
--   cancellation      a cancellation still standing for the current period (0250), made in the period.
--
-- SECURITY INVOKER and EXECUTE only for service_role: the server calls them after its own admin or
-- ownership check; no client role can. Read-only, so they change no financial record.
-- Additive and idempotent. No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create index if not exists sub_purchases_pair_paid_idx on public.sub_purchases (creator_id, subscriber_id, paid_at) where paid_at is not null;
create index if not exists sub_purchases_paid_idx on public.sub_purchases (paid_at) where paid_at is not null;
create index if not exists sub_purchases_reversed_idx on public.sub_purchases (reversed_at) where reversed_at is not null;
create index if not exists sub_ledger_creator_kind_idx on public.sub_ledger (creator_id, kind, created_at);

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.sub_creator_summary(p_creator uuid, p_since timestamptz) returns jsonb
language sql stable security invoker set search_path = public as $$
  with settled as (
    select p.*, not exists (
      select 1 from public.sub_purchases q
       where q.creator_id = p.creator_id and q.subscriber_id = p.subscriber_id and q.paid_at is not null and q.status <> 'refund_due'
         and (q.paid_at < p.paid_at or (q.paid_at = p.paid_at and q.id < p.id))
    ) as is_new
      from public.sub_purchases p
     where p.creator_id = p_creator and p.paid_at >= p_since and p.status <> 'refund_due'
  )
  select jsonb_build_object(
    'earned_cents', coalesce((select sum(amount_cents) from public.sub_ledger where creator_id = p_creator and kind = 'earning' and created_at >= p_since), 0),
    'clawed_cents', coalesce((select -sum(amount_cents) from public.sub_ledger where creator_id = p_creator and kind = 'clawback' and created_at >= p_since), 0),
    'new_subs', (select count(*) from settled where is_new),
    'renewals', (select count(*) from settled where not is_new),
    'gross_by_currency', coalesce((select jsonb_object_agg(charged_currency, minor) from (select charged_currency, sum(charged_minor) as minor from settled group by charged_currency) g), '{}'::jsonb),
    'refunds', (select count(*) from public.sub_purchases where creator_id = p_creator and reversed_at >= p_since and status in ('refunded', 'disputed', 'reversed')),
    'access_ended', (select count(*) from public.creator_memberships where creator_id = p_creator and billing = 'sub' and status <> 'removed' and period_end >= p_since and period_end <= now()),
    'cancellations', (select count(*) from public.creator_memberships where creator_id = p_creator and billing = 'sub' and status = 'active' and cancelled_at >= p_since and cancel_period = period_index),
    'ending_now', (select count(*) from public.creator_memberships where creator_id = p_creator and billing = 'sub' and status = 'active' and period_end > now() and cancel_period = period_index),
    'withdrawals_requested', (select count(*) from public.withdrawal_requests where user_id = p_creator and source = 'sub' and created_at >= p_since),
    'withdrawals_requested_cents', coalesce((select sum(gross_cents) from public.withdrawal_requests where user_id = p_creator and source = 'sub' and created_at >= p_since), 0),
    'withdrawals_completed', (select count(*) from public.withdrawal_requests where user_id = p_creator and source = 'sub' and status = 'completed' and completed_at >= p_since),
    'withdrawals_completed_net_cents', coalesce((select sum(net_cents) from public.withdrawal_requests where user_id = p_creator and source = 'sub' and status = 'completed' and completed_at >= p_since), 0),
    'posts_published', (select count(*) from public.sub_posts where creator_id = p_creator and status = 'published' and created_at >= p_since),
    'likes', (select count(*) from public.sub_post_likes l join public.sub_posts s on s.id = l.post_id where s.creator_id = p_creator and l.created_at >= p_since),
    'comments', (select count(*) from public.sub_post_comments c join public.sub_posts s on s.id = c.post_id where s.creator_id = p_creator and c.created_at >= p_since and c.hidden_at is null)
  )
$$;

create or replace function public.sub_creator_daily(p_creator uuid, p_since timestamptz) returns table (day date, earned_cents bigint, clawed_cents bigint, new_subs bigint, renewals bigint)
language sql stable security invoker set search_path = public as $$
  with days as (
    select generate_series((p_since at time zone 'utc')::date, (now() at time zone 'utc')::date, interval '1 day')::date as day
  ), led as (
    select (created_at at time zone 'utc')::date as day,
           sum(amount_cents) filter (where kind = 'earning') as earned,
           -sum(amount_cents) filter (where kind = 'clawback') as clawed
      from public.sub_ledger
     where creator_id = p_creator and kind in ('earning', 'clawback') and created_at >= p_since
     group by 1
  ), pur as (
    select (p.paid_at at time zone 'utc')::date as day,
           count(*) filter (where not exists (
             select 1 from public.sub_purchases q
              where q.creator_id = p.creator_id and q.subscriber_id = p.subscriber_id and q.paid_at is not null and q.status <> 'refund_due'
                and (q.paid_at < p.paid_at or (q.paid_at = p.paid_at and q.id < p.id)))) as n_new,
           count(*) as n_all
      from public.sub_purchases p
     where p.creator_id = p_creator and p.paid_at >= p_since and p.status <> 'refund_due'
     group by 1
  )
  select d.day, coalesce(l.earned, 0)::bigint, coalesce(l.clawed, 0)::bigint, coalesce(u.n_new, 0)::bigint, coalesce(u.n_all - u.n_new, 0)::bigint
    from days d left join led l on l.day = d.day left join pur u on u.day = d.day
   order by d.day
$$;

create or replace function public.sub_admin_summary(p_since timestamptz) returns jsonb
language sql stable security invoker set search_path = public as $$
  with settled as (
    select p.*, not exists (
      select 1 from public.sub_purchases q
       where q.creator_id = p.creator_id and q.subscriber_id = p.subscriber_id and q.paid_at is not null and q.status <> 'refund_due'
         and (q.paid_at < p.paid_at or (q.paid_at = p.paid_at and q.id < p.id))
    ) as is_new
      from public.sub_purchases p
     where p.paid_at >= p_since and p.status <> 'refund_due'
  )
  select jsonb_build_object(
    'memberships', (select count(*) from public.creator_memberships where billing = 'sub'),
    'active', (select count(*) from public.creator_memberships where billing = 'sub' and status = 'active' and period_end > now()),
    'ending', (select count(*) from public.creator_memberships where billing = 'sub' and status = 'active' and period_end > now() and cancel_period = period_index),
    'access_ended', (select count(*) from public.creator_memberships where billing = 'sub' and status <> 'removed' and period_end >= p_since and period_end <= now()),
    'new_subs', (select count(*) from settled where is_new),
    'renewals', (select count(*) from settled where not is_new),
    'gross_by_currency', coalesce((select jsonb_object_agg(charged_currency, minor) from (select charged_currency, sum(charged_minor) as minor from settled group by charged_currency) g), '{}'::jsonb),
    'creator_share_cents', coalesce((select sum(price_cents) from settled), 0),
    'platform_fee_cents', coalesce((select sum(fee_cents) from settled), 0),
    'refunds', (select count(*) from public.sub_purchases where reversed_at >= p_since and status in ('refunded', 'disputed', 'reversed')),
    'refunded_creator_cents', coalesce((select sum(price_cents) from public.sub_purchases where reversed_at >= p_since and status in ('refunded', 'disputed', 'reversed')), 0),
    'refund_due_open', (select count(*) from public.sub_purchases where status = 'refund_due'),
    'withdrawals_open', (select count(*) from public.withdrawal_requests where source = 'sub' and status in ('pending', 'reviewing', 'approved', 'processing')),
    'withdrawals_open_cents', coalesce((select sum(gross_cents) from public.withdrawal_requests where source = 'sub' and status in ('pending', 'reviewing', 'approved', 'processing')), 0),
    'reports_open', (select count(*) from public.reports where target_type in ('sub_post', 'sub_comment') and status = 'open'),
    'posts_removed', (select count(*) from public.sub_posts where status = 'archived'),
    'comments_hidden', (select count(*) from public.sub_post_comments where hidden_at is not null)
  )
$$;

do $$
begin
  execute 'revoke all on function public.sub_creator_summary(uuid, timestamptz) from public, anon, authenticated';
  execute 'revoke all on function public.sub_creator_daily(uuid, timestamptz) from public, anon, authenticated';
  execute 'revoke all on function public.sub_admin_summary(timestamptz) from public, anon, authenticated';
  execute 'grant execute on function public.sub_creator_summary(uuid, timestamptz) to service_role';
  execute 'grant execute on function public.sub_creator_daily(uuid, timestamptz) to service_role';
  execute 'grant execute on function public.sub_admin_summary(timestamptz) to service_role';
end;
$$;
