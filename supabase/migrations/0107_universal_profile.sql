-- =====================================================================
-- 0107_universal_profile.sql
-- Frenzsave · Universal Profile Engine™ (Feature 18 · Part 14)
--
-- ── The idea ───────────────────────────────────────────────────────────
-- One identity, many experiences. A member never opens a second account to
-- become a creator, a business or a professional: they declare what THIS
-- profile is for, and the profile grows the sections that purpose needs.
--
-- So there is no `business_profiles` table shadowing `profiles`, no second
-- id space, no migration when someone changes their mind. There is a TYPE
-- on the existing profile row, a per-member list of MODULES, and three
-- content tables the modules read from. Switching type changes which
-- modules are offered — it never moves, copies or deletes a single row.
--
-- ── Why the content tables are shaped this way ──────────────────────────
-- `profile_details`      one row per member: the fields that are singular
--                        by nature (a headline, a mission, one address,
--                        one set of opening hours).
-- `profile_credentials`  many rows, one `kind` column: experience,
--                        education, certification, award, publication and
--                        project are the SAME shape — a title, an issuer,
--                        a date range, a link. Six tables would have been
--                        six identical schemas and six sets of policies.
-- `profile_offerings`    many rows, `kind` = product | service. Same
--                        argument: a product and a service differ in
--                        wording, not in structure.
--
-- Prices are integer minor units (kobo/cents) — never floats, which cannot
-- represent money exactly. Currency is stored per row.
--
-- ── Privacy & security ─────────────────────────────────────────────────
-- RLS: every table is owner-only for writes. Reads are also owner-only at
-- the DB level; PUBLIC reads go through the service role in
-- `lib/social/profile-platform.ts`, which applies the module's audience
-- rule in code (`lib/profile/engine.ts`). That is the same pattern the rest
-- of the profile already uses, and it is what lets a module be narrowed to
-- "Friends" without encoding the friendship graph into a policy.
--
-- NOTE: nothing here is required for the app to work. Every reader degrades
-- to empty/defaults if this migration has not been applied yet — the
-- Universal Profile Engine simply stays dormant (every profile reads as
-- 'personal' with its default modules) rather than breaking.
--
-- Idempotent; safe to re-run.
-- =====================================================================

-- ── The type lives on the profile itself ──────────────────────────────
-- 'personal' | 'creator' | 'business' | 'professional' | 'student' |
-- 'developer' | 'community' | 'organization'   (+ future: government,
-- education — declared in the registry, not yet selectable)
alter table public.profiles
  add column if not exists profile_type text not null default 'personal';

-- Which module a visitor lands on. Null = the type's own default.
alter table public.profiles
  add column if not exists landing_module text;

-- ── Smart Profile Modules™ ────────────────────────────────────────────
-- One row per module a member has an OPINION about. A member who has never
-- opened the settings has no rows at all and gets their type's defaults —
-- so this table stays small and a new profile is useful before it is
-- configured.
create table if not exists public.profile_modules (
  user_id     uuid not null references auth.users (id) on delete cascade,
  module_key  text not null,
  enabled     boolean not null default true,
  position    integer not null default 0,
  -- 'public' | 'member' | 'follower' | 'friend' | 'private'
  audience    text not null default 'public',
  updated_at  timestamptz not null default now(),
  primary key (user_id, module_key)
);

create index if not exists profile_modules_user_idx
  on public.profile_modules (user_id, position);

-- ── The singular details ──────────────────────────────────────────────
create table if not exists public.profile_details (
  user_id        uuid primary key references auth.users (id) on delete cascade,

  -- Universal
  headline       text,           -- one line under the name ("Product designer")
  category       text,           -- "Coffee roaster", "Civil engineering"
  mission        text,           -- the longer statement: business overview / org mission
  languages      jsonb not null default '[]'::jsonb,   -- string[]

  -- Professional
  availability   text,           -- 'open' | 'selective' | 'unavailable'
  skills         jsonb not null default '[]'::jsonb,   -- string[]
  resume_url     text,

  -- Business / organization
  founded        text,           -- free text: "2019", "March 2019"
  team_size      text,
  contact_email  text,
  contact_phone  text,
  booking_url    text,           -- "Book appointment" goes here
  quote_url      text,           -- "Request a quote"
  address        text,
  city           text,
  country        text,
  -- [{ "day": 0-6 (0 = Monday), "open": "09:00", "close": "17:00", "closed": false }]
  hours          jsonb not null default '[]'::jsonb,

  updated_at     timestamptz not null default now()
);

-- ── The professional showcase ─────────────────────────────────────────
create table if not exists public.profile_credentials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- 'experience' | 'education' | 'certification' | 'award' | 'publication' | 'project'
  kind          text not null,
  title         text not null,
  organization  text,            -- employer, school, issuer, publisher
  description   text,
  url           text,
  image_url     text,
  -- Free text, not dates: "2019", "Mar 2019", "Summer 2019". A member should
  -- never be forced to invent a day they don't remember to list a job.
  started_on    text,
  ended_on      text,
  is_current    boolean not null default false,
  position      integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists profile_credentials_user_idx
  on public.profile_credentials (user_id, kind, position);

-- ── Products & services ───────────────────────────────────────────────
create table if not exists public.profile_offerings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null default 'product',   -- 'product' | 'service'
  name         text not null,
  description  text,
  -- Minor units (kobo / cents). Null = "contact for pricing", which is a real
  -- answer for a service and must not be rendered as 0.
  price_minor  bigint,
  currency     text not null default 'NGN',
  url          text,
  image_url    text,
  available    boolean not null default true,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists profile_offerings_user_idx
  on public.profile_offerings (user_id, kind, position);

-- ── RLS ───────────────────────────────────────────────────────────────
-- Owner-only, everywhere. Public reading is the service role's job (see the
-- header) so that a module's audience can be a real relationship check
-- rather than a policy expression.
alter table public.profile_modules      enable row level security;
alter table public.profile_details      enable row level security;
alter table public.profile_credentials  enable row level security;
alter table public.profile_offerings    enable row level security;

drop policy if exists "profile modules own" on public.profile_modules;
create policy "profile modules own" on public.profile_modules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile details own" on public.profile_details;
create policy "profile details own" on public.profile_details
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile credentials own" on public.profile_credentials;
create policy "profile credentials own" on public.profile_credentials
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "profile offerings own" on public.profile_offerings;
create policy "profile offerings own" on public.profile_offerings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
