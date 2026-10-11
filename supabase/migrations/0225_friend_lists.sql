-- 0225 — Friend Lists™, Relationship Manager™ & Smart Lists™ (Feature 19 · Part 10).
--
-- A list IS a circle. social_circles + circle_members (0112, 0217) are already
-- private lists with owner-only RLS, multi-membership, colours, icons, special
-- kinds and a real permission (profile sections). A second "lists" table would
-- be a second source of truth for the same idea. This migration adds only what
-- circles could not hold:
--
--   social_circles.parent_id     nested lists (Business > Clients > Premium).
--                                A trigger refuses a cycle, a parent owned by
--                                someone else, and more than four levels.
--   social_circles.archived_at   archive a list without losing it
--   social_circles.description   one line about the list
--   relationship_tags            private, many-per-person tags (Investor,
--                                Designer...). The existing relationship_labels
--                                stays the ONE relationship word per person.
--   circle_rules                 list automation: "creators go to Creators".
--                                Applied when the member asks, never silently.
--
-- Smart lists (Verified, New friends, Creators, Businesses...) are NOT stored:
-- they are filters over the graph, so they can never go stale.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block
-- is at the end.

alter table public.social_circles add column if not exists parent_id   uuid references public.social_circles (id) on delete set null;
alter table public.social_circles add column if not exists archived_at timestamptz;
alter table public.social_circles add column if not exists description text;
create index if not exists social_circles_parent_idx on public.social_circles (parent_id) where parent_id is not null;

create table if not exists public.relationship_tags (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  tag        text not null,
  created_at timestamptz not null default now(),
  constraint relationship_tags_not_self check (owner_id <> subject_id)
);
create unique index if not exists relationship_tags_uidx on public.relationship_tags (owner_id, subject_id, lower(tag));
create index if not exists relationship_tags_owner_idx on public.relationship_tags (owner_id, lower(tag));
alter table public.relationship_tags enable row level security;
drop policy if exists "relationship tags owner" on public.relationship_tags;
create policy "relationship tags owner" on public.relationship_tags
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.circle_rules (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  circle_id  uuid not null references public.social_circles (id) on delete cascade,
  rule       text not null,
  value      text,
  created_at timestamptz not null default now()
);
create unique index if not exists circle_rules_uidx on public.circle_rules (circle_id, rule, coalesce(lower(value), ''));
create index if not exists circle_rules_owner_idx on public.circle_rules (owner_id);
alter table public.circle_rules enable row level security;
drop policy if exists "circle rules owner" on public.circle_rules;
create policy "circle rules owner" on public.circle_rules
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

comment on table public.relationship_tags is '0225: private tags a member puts on people they are connected to. Many per person, owner-only, never shown to the person tagged.';
comment on table public.circle_rules is '0225: list automation - people who match a rule are offered for a list. Owner-only. Applied when the member asks.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.social_circles add constraint social_circles_description_len_chk check (description is null or char_length(description) between 1 and 140);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.relationship_tags add constraint relationship_tags_tag_chk check (char_length(tag) between 1 and 24);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.circle_rules add constraint circle_rules_rule_chk check (rule in ('creator', 'business', 'verified', 'favorite', 'new_friend', 'tag', 'mutual_follow'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.circle_rules add constraint circle_rules_value_chk check ((rule = 'tag') = (value is not null and char_length(value) between 1 and 24));
  exception when duplicate_object then null;
  end;
end;
$$;

create or replace function public.check_circle_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_owner uuid;
  cur uuid;
  depth int := 1;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'a list cannot sit inside itself';
  end if;
  select owner_id into parent_owner from public.social_circles where id = new.parent_id;
  if parent_owner is distinct from new.owner_id then
    raise exception 'a list can only sit inside another of your own lists';
  end if;
  cur := new.parent_id;
  loop
    select parent_id into cur from public.social_circles where id = cur;
    exit when cur is null;
    if cur = new.id then
      raise exception 'that would put a list inside itself';
    end if;
    depth := depth + 1;
    if depth >= 4 then
      raise exception 'lists nest up to four levels';
    end if;
  end loop;
  return new;
end;
$$;

create or replace function public.stamp_circle_rule_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select owner_id into new.owner_id from public.social_circles where id = new.circle_id;
  if new.owner_id is null then
    raise exception 'unknown list';
  end if;
  return new;
end;
$$;

do $$
begin
  revoke all on function public.check_circle_parent() from public, anon, authenticated;
  revoke all on function public.stamp_circle_rule_owner() from public, anon, authenticated;
  drop trigger if exists social_circles_parent_trg on public.social_circles;
  create trigger social_circles_parent_trg before insert or update of parent_id on public.social_circles
    for each row execute function public.check_circle_parent();
  drop trigger if exists circle_rules_owner_trg on public.circle_rules;
  create trigger circle_rules_owner_trg before insert or update on public.circle_rules
    for each row execute function public.stamp_circle_rule_owner();
end;
$$;
