-- 0113_profile_discovery.sql
-- Feature 18 · Part 18 — Profile Discovery, bookmarks and discovery analytics.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ONE DECISION THAT SHAPES THIS MIGRATION
-- ═══════════════════════════════════════════════════════════════════════════
-- Being findable by NAME is what a profile is for. Being findable by WHERE YOU
-- ARE is a different thing, and the brief itself marks location "(Optional)".
--
-- So `search_fields` ships WITHOUT city and country. A member who filled in
-- their city so their business hours made sense never agreed to be enumerable
-- by proximity, and the absence of a settings row reads as the defaults — which
-- means every existing account is opted OUT of location search the day this
-- lands, not in. Opting in is one switch on /account/discovery.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY DISCOVERY ANALYTICS IS A DAILY COUNTER, NOT AN EVENT LOG
-- ═══════════════════════════════════════════════════════════════════════════
-- "Search appearances" and "QR scans" could each be a row per event. That would
-- be the highest-write pair of tables in the product AND would record who
-- looked for whom and when — a search log is one of the most revealing
-- datasets a social product can hold.
--
-- A daily counter answers the question an owner actually has ("is my profile
-- being found, and is that growing?") while storing nothing about any
-- individual searcher. It is also the version that costs nothing, which given
-- the Vercel bill is not a small consideration.
--
-- Search TERMS are aggregated per (profile, term, day) with no searcher
-- attached, and the reader applies a floor of 3 before showing one — a term
-- used once could be a single identifiable person looking for you.
--
-- Idempotent.

-- ---------------------------------------------------------------------
-- Per-member discovery settings.
-- ---------------------------------------------------------------------
create table if not exists public.profile_discovery (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  -- Master switch. False = findable only by someone who already knows the
  -- exact @handle. Deliberately NOT the same as `is_hidden` (a friends-only
  -- account) or `allow_indexing` (search engines) — those answer different
  -- questions and already exist.
  discoverable     boolean not null default true,
  -- Which OPTIONAL fields are searchable. Handle and display name are always
  -- in and are not listed here. Validated against lib/discovery/fields.ts.
  search_fields    jsonb not null default '["headline","category","skills","languages"]'::jsonb,
  -- Listed in the public directory for their category.
  directory_listed boolean not null default false,
  updated_at       timestamptz not null default now()
);

alter table public.profile_discovery enable row level security;

-- Readable by anyone: a searcher's query has to know whether this member
-- allows being matched on skills, and that read happens on behalf of the
-- SEARCHER, not the owner. The row contains no personal data — only which of
-- the member's own already-public fields may be matched. Writes stay owner-only.
drop policy if exists "profile discovery public read" on public.profile_discovery;
create policy "profile discovery public read" on public.profile_discovery
  for select using (true);

drop policy if exists "profile discovery owner write" on public.profile_discovery;
create policy "profile discovery owner write" on public.profile_discovery
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Profile bookmarks — private lists of people.
--
-- Separate from `collections` (which hold posts) and from `friend_favorites`
-- (which is a star on an existing friendship). A bookmark needs no
-- relationship at all: it is "I want to find this business again".
-- ---------------------------------------------------------------------
create table if not exists public.profile_bookmark_lists (
  id         uuid primary key default uuid_generate_v4(),
  owner_id   uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 32),
  color      text not null default 'blue'
             check (color in ('blue','violet','emerald','amber','rose','sky','pink','slate')),
  created_at timestamptz not null default now()
);

create unique index if not exists profile_bookmark_lists_name_uidx
  on public.profile_bookmark_lists (owner_id, lower(name));

alter table public.profile_bookmark_lists enable row level security;

drop policy if exists "bookmark lists owner all" on public.profile_bookmark_lists;
create policy "bookmark lists owner all" on public.profile_bookmark_lists
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists public.profile_bookmarks (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  subject_id uuid not null references auth.users (id) on delete cascade,
  -- Null = the default "Saved" list.
  list_id    uuid references public.profile_bookmark_lists (id) on delete set null,
  note       text check (note is null or char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (owner_id, subject_id),
  constraint profile_bookmarks_not_self check (owner_id <> subject_id)
);

create index if not exists profile_bookmarks_owner_idx on public.profile_bookmarks (owner_id, created_at desc);
create index if not exists profile_bookmarks_list_idx  on public.profile_bookmarks (list_id, created_at desc);

alter table public.profile_bookmarks enable row level security;

-- Owner-only, in both directions. The person bookmarked is never told — the
-- same rule as relationship labels (0112): a private note about someone is
-- not a notification to them.
drop policy if exists "profile bookmarks owner all" on public.profile_bookmarks;
create policy "profile bookmarks owner all" on public.profile_bookmarks
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- Discovery analytics — daily aggregates, owner-readable.
-- ---------------------------------------------------------------------
create table if not exists public.profile_discovery_stats (
  user_id            uuid not null references auth.users (id) on delete cascade,
  day                date not null default current_date,
  search_appearances integer not null default 0,
  card_views         integer not null default 0,
  qr_scans           integer not null default 0,
  directory_views    integer not null default 0,
  primary key (user_id, day)
);

create index if not exists profile_discovery_stats_day_idx
  on public.profile_discovery_stats (user_id, day desc);

alter table public.profile_discovery_stats enable row level security;

drop policy if exists "discovery stats owner read" on public.profile_discovery_stats;
create policy "discovery stats owner read" on public.profile_discovery_stats
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Search terms that surfaced a profile.
--
-- No searcher id, ever — not nullable, not optional, simply absent. There is
-- no column here that could hold one, which is the only durable way to
-- guarantee a future query cannot join a search back to a person.
-- ---------------------------------------------------------------------
create table if not exists public.profile_search_terms (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null default current_date,
  term    text not null check (char_length(term) between 2 and 40),
  count   integer not null default 1,
  primary key (user_id, day, term)
);

create index if not exists profile_search_terms_idx on public.profile_search_terms (user_id, day desc);

alter table public.profile_search_terms enable row level security;

drop policy if exists "search terms owner read" on public.profile_search_terms;
create policy "search terms owner read" on public.profile_search_terms
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Counter helpers. SECURITY DEFINER because the writer is a searcher acting on
-- SOMEONE ELSE's row — they may increment a counter, and may never read one.
-- ---------------------------------------------------------------------
create or replace function public.bump_discovery_stat(
  p_user_id uuid,
  p_metric  text,
  p_amount  integer default 1
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_metric not in ('search_appearances','card_views','qr_scans','directory_views') then
    raise exception 'unknown discovery metric %', p_metric;
  end if;
  insert into public.profile_discovery_stats (user_id, day) values (p_user_id, current_date)
  on conflict (user_id, day) do nothing;

  execute format(
    'update public.profile_discovery_stats set %I = %I + $1 where user_id = $2 and day = current_date',
    p_metric, p_metric
  ) using greatest(0, p_amount), p_user_id;
end $$;

create or replace function public.bump_search_term(p_user_id uuid, p_term text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_term is null or char_length(p_term) < 2 or char_length(p_term) > 40 then
    return;
  end if;
  insert into public.profile_search_terms (user_id, day, term, count)
  values (p_user_id, current_date, lower(p_term), 1)
  on conflict (user_id, day, term) do update set count = public.profile_search_terms.count + 1;
end $$;
