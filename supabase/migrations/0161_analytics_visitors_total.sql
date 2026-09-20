-- 0161 · The all-time unique-visitor count for the growth milestone email
-- (owner, 2026-09-20: "an email on every 1,000 or 10,000 visitors and users
-- milestone, like the download milestone"). One index-only DISTINCT over the
-- human events, in Postgres, the same definition the dashboard's "unique
-- visitors" uses — bots excluded, a visitor is a device, no IP anywhere.
-- SECURITY DEFINER like the other analytics readers (0115), revoked from the
-- browser roles the same way, inside one block with `execute` at the end.

create or replace function public.analytics_visitors_total()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(distinct visitor_id) from public.analytics_events where is_bot = false;
$$;

do $$
begin
  execute 'revoke all on function public.analytics_visitors_total() from public, anon, authenticated';
  execute 'grant execute on function public.analytics_visitors_total() to service_role';
end $$;
