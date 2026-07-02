-- 0017_messages_realtime.sql
-- Live DMs: without this, the app's message channels connect but never receive
-- anything, because Postgres only streams tables that are in the realtime
-- publication. Adds `messages` (thread inserts) and `conversations` (inbox
-- badge/list updates) to supabase_realtime. Idempotent — safe to re-run.
--
-- `conversations` is filtered on user_low / user_high for UPDATE events, so it
-- needs REPLICA IDENTITY FULL for those columns to be present in the change
-- payload. `messages` is only subscribed on INSERT (the new row already carries
-- every column), so default replica identity is enough.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

alter table public.conversations replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
