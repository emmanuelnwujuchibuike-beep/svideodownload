-- 0261 — Age checks and Mature (18+) exclusive posts (owner, 2026-10-18).
--
-- The owner's choice: a date of birth plus an 18+ confirmation (self-declared), protecting
-- exclusive posts a creator marks Mature (18+). Sexually explicit content stays banned
-- everywhere (App Store / Play rules, and the payment provider's terms), so Mature means
-- suggestive, violent or strong-language content, never explicit.
--
--   age_checks           one row per member who answered the check. ONLY the outcome is kept:
--                        'adult' or 'minor', how it was checked and when. The date of birth is
--                        NOT stored. For a 'minor' the day they turn 18 is kept (eligible_on),
--                        so the check can be answered again from that day and not before — a
--                        minor cannot simply try another date. An adult row has no date at all.
--                        Written only by the server (app/api/age/route.ts, service role): there
--                        is no insert or update policy, so a browser can read its own row and
--                        nothing else, and can never write one.
--   sub_posts.mature     false (the default, and every existing post) or true. A Mature post's
--                        media, preview and public cover are never sent to a viewer whose
--                        age_checks row is not 'adult' (lib/sub/posts.ts, lib/sub/feed.ts). The
--                        creator always sees their own post.
--
-- Additive and idempotent. Existing posts stay exactly as they are (not mature).
-- No semicolon inside any quoted string. Every dollar-quoted block is at the end.

create table if not exists public.age_checks (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  result      text not null,
  method      text not null default 'self_declared_dob',
  eligible_on date,
  checked_at  timestamptz not null default now()
);
alter table public.age_checks add column if not exists result text;
alter table public.age_checks add column if not exists method text not null default 'self_declared_dob';
alter table public.age_checks add column if not exists eligible_on date;
alter table public.age_checks add column if not exists checked_at timestamptz not null default now();
comment on table public.age_checks is '0261: the outcome of a member age check (adult or minor) and when. Never the date of birth.';

alter table public.age_checks enable row level security;
drop policy if exists "age checks own row" on public.age_checks;
create policy "age checks own row" on public.age_checks
  for select using ((select auth.uid()) = user_id);

alter table public.sub_posts add column if not exists mature boolean not null default false;
comment on column public.sub_posts.mature is '0261: Mature (18+). Media, previews and covers reach only viewers whose age check says adult. Never explicit.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.age_checks add constraint age_checks_result_chk check (result in ('adult', 'minor'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.age_checks add constraint age_checks_method_chk check (method in ('self_declared_dob'));
  exception when duplicate_object then null;
  end;
  begin
    -- a minor carries the day they turn 18, an adult carries no date at all
    alter table public.age_checks add constraint age_checks_eligible_chk check ((result = 'minor') = (eligible_on is not null));
  exception when duplicate_object then null;
  end;
end;
$$;
