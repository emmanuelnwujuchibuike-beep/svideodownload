-- 0103 — Enterprise Analytics: event-pipeline foundation (Phase 1, owner 2026-08-02).
--
-- An append-only event log with EXACTLY-ONCE dedup (event_id is the primary key, so
-- an idempotent `insert … on conflict do nothing` makes a retried/duplicated event a
-- no-op), plus a canonical per-download record keyed by download_id so a page refresh
-- or a retry never double-counts a download.
--
-- Security: RLS is enabled with NO public policies, so anon/authenticated clients can
-- neither read nor write. All writes go through the collect endpoint using the SERVICE
-- ROLE (which bypasses RLS); the admin dashboard reads server-side with the same role.
-- Raw IPs are never stored — only coarse geo (country/region/city) derived at the edge.

create table if not exists public.analytics_events (
  event_id     uuid primary key,
  event_type   text not null,
  visitor_id   text not null,
  session_id   text not null,
  user_id      uuid null,
  download_id  uuid null,
  occurred_at  timestamptz not null,
  received_at  timestamptz not null default now(),
  path         text null,
  referrer     text null,
  country      text null,
  region       text null,
  city         text null,
  device       text null,
  browser      text null,
  os           text null,
  properties   jsonb not null default '{}'::jsonb
);
create index if not exists analytics_events_type_time_idx on public.analytics_events (event_type, received_at desc);
create index if not exists analytics_events_visitor_idx    on public.analytics_events (visitor_id);
create index if not exists analytics_events_session_idx    on public.analytics_events (session_id);
create index if not exists analytics_events_time_idx       on public.analytics_events (received_at desc);
create index if not exists analytics_events_user_idx       on public.analytics_events (user_id) where user_id is not null;
create index if not exists analytics_events_download_idx   on public.analytics_events (download_id) where download_id is not null;

create table if not exists public.analytics_downloads (
  download_id  uuid primary key,
  visitor_id   text not null,
  session_id   text null,
  user_id      uuid null,
  platform     text null,
  media_kind   text null,
  quality      text null,
  -- requested → started → preparing → completed | failed | cancelled | timed_out | expired
  status       text not null default 'requested',
  error_reason text null,
  file_size    bigint null,
  duration_ms  integer null,
  -- Links a retry to the original download so retries don't inflate the totals.
  retry_of     uuid null,
  country      text null,
  device       text null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists analytics_downloads_status_idx   on public.analytics_downloads (status, created_at desc);
create index if not exists analytics_downloads_platform_idx on public.analytics_downloads (platform);
create index if not exists analytics_downloads_visitor_idx  on public.analytics_downloads (visitor_id);
create index if not exists analytics_downloads_time_idx     on public.analytics_downloads (created_at desc);

alter table public.analytics_events enable row level security;
alter table public.analytics_downloads enable row level security;
