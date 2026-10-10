-- 0218: admin funding alerts and weekly AI creator awards (owner, 2026-10-10).
--
--   admin_funding_alerts  one row per SUCCESSFUL payment, written by a trigger on
--                         ai_topup_attempts — the one table every rail settles
--                         into (AI credit funding, AI subscriptions, advertiser
--                         payments), whichever path settled it: a webhook, the
--                         return page, a reconcile job or a SQL function. The
--                         server sends each to the admins (push + email) and
--                         stamps sent_at — so every payment is announced once.
--   ai_weekly_awards      the weekly top AI spenders' prizes: one row per (week,
--                         rank). The primary key IS the idempotency — a week is
--                         paid once however often the job runs. The credits go
--                         through grant_reward, keyed the same way.
--
-- Both are server-only: RLS on, no policies (the service role reads/writes them).
-- Idempotent. Plain DDL first, functions last, the trigger in the final DO block.

create table if not exists public.admin_funding_alerts (
  reference    text primary key,
  user_id      uuid,
  purpose      text not null,
  amount_cents bigint not null,
  currency     text not null,
  provider     text,
  item_id      text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);
create index if not exists admin_funding_alerts_unsent_idx on public.admin_funding_alerts (created_at) where sent_at is null;
alter table public.admin_funding_alerts enable row level security;

create table if not exists public.ai_weekly_awards (
  week_start   date not null,
  rank         smallint not null,
  user_id      uuid not null references auth.users (id) on delete cascade,
  spent        integer not null,
  credits      integer not null,
  awarded_at   timestamptz not null default now(),
  primary key (week_start, rank),
  constraint ai_weekly_awards_rank_chk check (rank between 1 and 3),
  constraint ai_weekly_awards_credits_chk check (credits > 0)
);
create index if not exists ai_weekly_awards_user_idx on public.ai_weekly_awards (user_id);
alter table public.ai_weekly_awards enable row level security;

create or replace function public.queue_admin_funding_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'success' and (tg_op = 'INSERT' or old.status is distinct from 'success') then
    insert into public.admin_funding_alerts (reference, user_id, purpose, amount_cents, currency, provider, item_id)
    values (new.reference, new.user_id, coalesce(new.purpose, 'wallet_topup'), new.amount_cents, new.currency, new.provider, new.item_id)
    on conflict (reference) do nothing;
  end if;
  return new;
end $$;

do $$ begin
  revoke all on function public.queue_admin_funding_alert() from public, anon, authenticated;
  drop trigger if exists ai_topup_attempts_admin_alert_trg on public.ai_topup_attempts;
  create trigger ai_topup_attempts_admin_alert_trg after insert or update of status on public.ai_topup_attempts
    for each row execute function public.queue_admin_funding_alert();
end $$;
