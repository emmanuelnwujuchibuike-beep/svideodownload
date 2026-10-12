-- 0234 — Universal Inbox: private labels and read history (Feature 20 · Parts 3-4, 2026-10-12).
--
--   notifications gains
--     labels   up to five private labels the member put on it (Urgent, Review later, Clients...)
--              — the brief's custom categories and labels are ONE concept here, filterable and searchable
--     read_at  when it was first read — with created_at, delivery (0233), pinned_at and archived_at
--              this is the notification's own history (created, delivered or held, read, pinned, archived)
--
--   read_at is stamped by a trigger the moment read flips to true, so every existing path that marks
--   read (the bell, the center, mark all, opening a chat) records it without being changed.
--
-- Additive. Idempotent. No semicolon inside any quoted string.
-- The ONE dollar-quoted block (the trigger function) is the LAST statement in this file - DDL after a
-- dollar block is silently skipped by the runner (0130). The trigger itself is 0235, on its own.

alter table public.notifications add column if not exists labels text[] not null default '{}';
alter table public.notifications add column if not exists read_at timestamptz;

alter table public.notifications drop constraint if exists notifications_labels_max_chk;
alter table public.notifications add constraint notifications_labels_max_chk check (cardinality(labels) <= 5);

-- label filters are per member: a GIN index answers labels @> array[...] within one member's rows
create index if not exists notifications_labels_gin on public.notifications using gin (labels) where cardinality(labels) > 0;

comment on column public.notifications.labels is '0234: private labels the member put on this notification (max 5). Never shown to anyone else.';
comment on column public.notifications.read_at is '0234: when it was first read. Stamped by notifications_stamp_read_at.';

create or replace function public.notifications_stamp_read_at() returns trigger
language plpgsql as $$
begin
  if new.read and not coalesce(old.read, false) and new.read_at is null then
    new.read_at := now();
  end if;
  if not new.read then
    new.read_at := null;
  end if;
  return new;
end;
$$;
