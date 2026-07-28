-- =====================================================================
-- 0099_time_capsules.sql
-- Frenzsave · Time Capsule™ (Feature 18 · Life Memories) — a personal
-- message the owner seals until a future date they choose.
--
-- ── The privacy/security model, stated plainly ─────────────────────────
-- A Time Capsule is a DELAYED-REVEAL feature for its own owner, not a
-- security boundary against an adversary — nobody else can ever read a
-- row (RLS below), so the only real question is whether the OWNER can
-- peek at their own future surprise early. True end-to-end encryption (a
-- key the app itself cannot derive before unlock_at) is a much larger
-- undertaking than this feature warrants. The honest, sufficient
-- protection here is layered: RLS keeps every row private to its owner
-- at the database level, and the API (app/api/time-capsules) refuses to
-- ever RETURN `message` for a row whose unlock_at is still in the future
-- — a locked capsule's content never reaches the client at all, through
-- any normal use of the app. A determined owner could still read their
-- own row directly in the Supabase dashboard; that is an accepted,
-- documented limit, not an oversight.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.time_capsules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  message     text not null,
  unlock_at   timestamptz not null,
  created_at  timestamptz not null default now()
);

-- The owner's own list, soonest-unlocking first.
create index if not exists time_capsules_user_idx
  on public.time_capsules (user_id, unlock_at);

-- ── RLS: self-owned, read and write ──────────────────────────────────
-- Same idiom as personal_learning_items (0088) and every other private,
-- self-owned plane in this project — nobody but the owner can ever see a
-- row, at the database level, independent of anything the API does.
alter table public.time_capsules enable row level security;

drop policy if exists "time_capsules self all" on public.time_capsules;
create policy "time_capsules self all" on public.time_capsules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
