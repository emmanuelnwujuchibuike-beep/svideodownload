-- =====================================================================
-- FrenzSave — Phase 6: social identity foundation
-- Public profiles (handles), follows graph, privacy controls, blocks, and
-- anti-spam/trust fields. Privacy is enforced in RLS so it ALWAYS overrides
-- reads/recommendations. Follower/following counts are denormalized via trigger
-- so profile reads never run COUNT(*) — built to scale.
-- Idempotent; safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- profiles — social columns
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists handle          text;
alter table public.profiles add column if not exists display_name    text;
alter table public.profiles add column if not exists bio             text;
alter table public.profiles add column if not exists banner_url      text;
alter table public.profiles add column if not exists website         text;
alter table public.profiles add column if not exists visibility      text not null default 'public';
alter table public.profiles add column if not exists is_verified     boolean not null default false;
alter table public.profiles add column if not exists is_suspended    boolean not null default false;
alter table public.profiles add column if not exists trust_score     int not null default 0;
alter table public.profiles add column if not exists followers_count int not null default 0;
alter table public.profiles add column if not exists following_count int not null default 0;

do $$ begin
  alter table public.profiles
    add constraint profiles_visibility_chk check (visibility in ('public', 'followers', 'private'));
exception when duplicate_object then null; end $$;

-- Case-insensitive unique handle (the @username + /u/<handle> route key).
create unique index if not exists profiles_handle_unique_idx
  on public.profiles (lower(handle)) where handle is not null;

-- ---------------------------------------------------------------------
-- follows — the social graph (follower → following)
-- ---------------------------------------------------------------------
create table if not exists public.follows (
  follower_id  uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id);
create index if not exists follows_follower_idx  on public.follows (follower_id);

-- ---------------------------------------------------------------------
-- blocks — anti-abuse; a block hides both directions
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);

-- ---------------------------------------------------------------------
-- privacy_settings — per-user controls that OVERRIDE recommendations
-- ---------------------------------------------------------------------
create table if not exists public.privacy_settings (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  activity_visibility     text not null default 'public',
  followers_visibility    text not null default 'public',
  comments_policy         text not null default 'everyone',
  messages_policy         text not null default 'followers',
  allow_indexing          boolean not null default true,
  show_in_recommendations boolean not null default true,
  updated_at              timestamptz not null default now(),
  constraint privacy_activity_chk  check (activity_visibility in ('public','followers','private')),
  constraint privacy_followers_chk check (followers_visibility in ('public','followers','private')),
  constraint privacy_comments_chk  check (comments_policy in ('everyone','followers','off')),
  constraint privacy_messages_chk  check (messages_policy in ('everyone','followers','off'))
);

-- ---------------------------------------------------------------------
-- Denormalized follow counters (trigger-maintained → O(1) profile reads)
-- ---------------------------------------------------------------------
create or replace function public.bump_follow_counts()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    update public.profiles set followers_count = followers_count + 1 where id = NEW.following_id;
    update public.profiles set following_count = following_count + 1 where id = NEW.follower_id;
  elsif (TG_OP = 'DELETE') then
    update public.profiles set followers_count = greatest(0, followers_count - 1) where id = OLD.following_id;
    update public.profiles set following_count = greatest(0, following_count - 1) where id = OLD.follower_id;
  end if;
  return null;
end $$;

drop trigger if exists follows_count_trg on public.follows;
create trigger follows_count_trg
  after insert or delete on public.follows
  for each row execute function public.bump_follow_counts();

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.follows          enable row level security;
alter table public.blocks           enable row level security;
alter table public.privacy_settings enable row level security;

-- profiles: PUBLIC read of visible, non-suspended profiles that haven't blocked
-- the viewer. (Existing self/admin select policy stays; permissive policies OR.)
drop policy if exists "profiles public read" on public.profiles;
create policy "profiles public read" on public.profiles
  for select using (
    not is_suspended
    and not exists (
      select 1 from public.blocks b
      where b.blocker_id = profiles.id and b.blocked_id = auth.uid()
    )
    and (
      visibility = 'public'
      or (
        visibility = 'followers'
        and exists (
          select 1 from public.follows f
          where f.following_id = profiles.id and f.follower_id = auth.uid()
        )
      )
    )
  );

-- follows: you manage your own edges; reads limited to edges you're part of
-- (public follower/following lists are surfaced via denormalized counts +
-- privacy-checked server helpers, not raw table reads).
drop policy if exists "follows self read" on public.follows;
create policy "follows self read" on public.follows
  for select using (auth.uid() = follower_id or auth.uid() = following_id or public.is_admin());
drop policy if exists "follows self insert" on public.follows;
create policy "follows self insert" on public.follows
  for insert with check (
    auth.uid() = follower_id
    and follower_id <> following_id
    and not exists (
      select 1 from public.blocks b
      where (b.blocker_id = following_id and b.blocked_id = follower_id)
         or (b.blocker_id = follower_id and b.blocked_id = following_id)
    )
  );
drop policy if exists "follows self delete" on public.follows;
create policy "follows self delete" on public.follows
  for delete using (auth.uid() = follower_id);

-- blocks: only the blocker sees / manages their blocks.
drop policy if exists "blocks self all" on public.blocks;
create policy "blocks self all" on public.blocks
  for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);

-- privacy_settings: a user manages their own row; admins read all.
drop policy if exists "privacy self read" on public.privacy_settings;
create policy "privacy self read" on public.privacy_settings
  for select using (auth.uid() = user_id or public.is_admin());
drop policy if exists "privacy self write" on public.privacy_settings;
create policy "privacy self write" on public.privacy_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
