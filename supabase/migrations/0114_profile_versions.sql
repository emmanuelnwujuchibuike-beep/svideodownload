-- 0114_profile_versions.sql
-- Feature 18 · Part 20 — profile version history.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHOLE SNAPSHOTS, NOT A DIFF CHAIN
-- ═══════════════════════════════════════════════════════════════════════════
-- A diff chain has to replay from the beginning to produce any version, so one
-- corrupt row poisons everything after it and a schema change means rewriting
-- history. A whole snapshot is a few hundred bytes of JSON, restores in a
-- single write, and is independently valid. Diffs are computed in TypeScript
-- for display only, where being wrong is cosmetic rather than destructive.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT A VERSION DOES *NOT* CONTAIN
-- ═══════════════════════════════════════════════════════════════════════════
-- Only the member's LAYOUT choices: profile type, module on/off/order/audience,
-- and appearance. Never their content.
--
-- That boundary is the whole safety of the feature. Posts, photos and
-- credentials are the member's work, not furniture, and a "restore" that
-- silently removed a post published after the snapshot would be a catastrophe
-- dressed as an undo button. Restore moves furniture and nothing else, and it
-- cannot do otherwise because the content is not in the row.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BOUNDED BY CONSTRUCTION
-- ═══════════════════════════════════════════════════════════════════════════
-- A trigger prunes to the newest 20 per member. Unbounded history for a
-- settings screen is storage with no matching benefit — nobody restores a
-- layout from four hundred edits ago — and pruning in the database means it
-- holds however the rows were written, including by a future admin tool.
--
-- Idempotent.

create table if not exists public.profile_versions (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- The generated summary ("Theme set to midnight · +2 more"). Never typed by
  -- the member: a version list is only useful if every row is described the
  -- same way, and asking someone to name a save is asking them not to save.
  label      text not null check (char_length(label) between 1 and 120),
  -- { type, landing, modules[], theme, surface, radius, fontScale }
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists profile_versions_user_idx
  on public.profile_versions (user_id, created_at desc);

alter table public.profile_versions enable row level security;

-- A member's layout history is their own. Nobody else has a reason to read it,
-- including a moderator: it describes choices, not published content.
drop policy if exists "profile versions owner all" on public.profile_versions;
create policy "profile versions owner all" on public.profile_versions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Keep the newest 20 per member.
--
-- Deletes by id from a windowed subquery rather than by timestamp: two saves
-- inside the same millisecond would otherwise be indistinguishable and the
-- prune could take both or neither.
-- ---------------------------------------------------------------------
create or replace function public.prune_profile_versions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.profile_versions
  where id in (
    select id from (
      select id, row_number() over (order by created_at desc, id desc) as rn
      from public.profile_versions
      where user_id = NEW.user_id
    ) ranked
    where rn > 20
  );
  return null;
end $$;

drop trigger if exists profile_versions_prune_trg on public.profile_versions;
create trigger profile_versions_prune_trg
  after insert on public.profile_versions
  for each row execute function public.prune_profile_versions();
