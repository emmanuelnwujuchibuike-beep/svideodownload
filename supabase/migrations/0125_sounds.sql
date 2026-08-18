-- =====================================================================
-- FrenzSave — Feature 15 Part 7: Sounds
-- A sound is decoupled from any one post — the first entity in this schema
-- more than one post can point at. `source_type` distinguishes a sound
-- published from a creator's own reel ('original') from one built out of a
-- Downloader-fetched clip ('downloaded', owner-approved, attribution
-- required) — room for a real licensing partner ('licensed') later without a
-- schema change, but nothing here pretends one exists today. Idempotent.
-- =====================================================================

-- ---------------------------------------------------------------------
-- sounds
-- ---------------------------------------------------------------------
create table if not exists public.sounds (
  id              uuid primary key default uuid_generate_v4(),
  created_by      uuid not null references auth.users (id) on delete cascade,
  source_type     text not null default 'original',
  -- Only meaningful (and required) for a downloaded sound — the platform and
  -- post it was pulled from, so every surface can credit it honestly.
  source_platform text,
  source_url      text,
  title           text not null,
  artist_label    text not null,
  cover_art_url   text,
  audio_url       text not null,
  -- Decoded amplitude peaks (same shape voice notes already use in
  -- comment_media) — real data for the waveform, never a decorative fake.
  waveform_peaks  real[] not null default '{}',
  duration_sec    int not null default 0,
  -- Creator-set from a small fixed vocabulary (see lib/social/sounds.ts) —
  -- never AI-inferred, so this is never presented as more certain than it is.
  mood_tag        text,
  genre_tag       text,
  is_public       boolean not null default true,
  -- Denormalized, trigger-maintained counters — real counts only.
  usage_count     int not null default 0,
  plays_count     bigint not null default 0,
  trend_score     double precision not null default 0,
  created_at      timestamptz not null default now(),
  constraint sounds_source_type_chk check (source_type in ('original', 'downloaded')),
  constraint sounds_downloaded_attribution_chk check (
    source_type <> 'downloaded' or (source_platform is not null and source_url is not null)
  )
);

create index if not exists sounds_created_by_idx on public.sounds (created_by, created_at desc);
create index if not exists sounds_public_trend_idx on public.sounds (trend_score desc) where is_public;
create index if not exists sounds_public_recent_idx on public.sounds (created_at desc) where is_public;
create index if not exists sounds_mood_idx on public.sounds (mood_tag) where is_public and mood_tag is not null;
create index if not exists sounds_genre_idx on public.sounds (genre_tag) where is_public and genre_tag is not null;

-- ---------------------------------------------------------------------
-- posts.sound_id — a post MAY carry one attached sound. Nullable: attaching
-- a sound is opt-in, and every existing post/reel has none (its own audio
-- remains "the sound", exactly as the reel-viewer's fallback row describes).
-- ---------------------------------------------------------------------
alter table public.posts add column if not exists sound_id uuid references public.sounds (id) on delete set null;
create index if not exists posts_sound_idx on public.posts (sound_id) where sound_id is not null;

-- ---------------------------------------------------------------------
-- sound_plays — deduped per (viewer|ip, sound, day), identical shape to
-- post_views, so plays_count is a real count and can't be inflated by a
-- refresh loop or a bot.
-- ---------------------------------------------------------------------
create table if not exists public.sound_plays (
  id         uuid primary key default uuid_generate_v4(),
  sound_id   uuid not null references public.sounds (id) on delete cascade,
  viewer_id  uuid references auth.users (id) on delete set null,
  ip_hash    text not null default '',
  day        date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);
create unique index if not exists sound_plays_unique_idx
  on public.sound_plays (sound_id, (coalesce(viewer_id::text, ip_hash)), day);

-- ---------------------------------------------------------------------
-- Counters
-- ---------------------------------------------------------------------
create or replace function public.bump_sound_plays()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.sounds set plays_count = plays_count + 1 where id = NEW.sound_id;
  return null;
end $$;
drop trigger if exists sound_plays_count_trg on public.sound_plays;
create trigger sound_plays_count_trg
  after insert on public.sound_plays
  for each row execute function public.bump_sound_plays();

-- usage_count tracks how many posts currently carry this sound — kept in
-- sync as posts.sound_id is set, changed, or cleared (a removed/edited post
-- must not leave a stale count behind).
create or replace function public.sync_sound_usage_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.sound_id is not null then
      update public.sounds set usage_count = usage_count + 1 where id = NEW.sound_id;
    end if;
  elsif TG_OP = 'UPDATE' then
    if NEW.sound_id is distinct from OLD.sound_id then
      if OLD.sound_id is not null then
        update public.sounds set usage_count = greatest(0, usage_count - 1) where id = OLD.sound_id;
      end if;
      if NEW.sound_id is not null then
        update public.sounds set usage_count = usage_count + 1 where id = NEW.sound_id;
      end if;
    end if;
  elsif TG_OP = 'DELETE' then
    if OLD.sound_id is not null then
      update public.sounds set usage_count = greatest(0, usage_count - 1) where id = OLD.sound_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists posts_sound_usage_trg on public.posts;
create trigger posts_sound_usage_trg
  after insert or update of sound_id or delete on public.posts
  for each row execute function public.sync_sound_usage_count();

-- ---------------------------------------------------------------------
-- recompute_sound_trend_scores — same shape as recompute_hot_scores
-- (migration 0009): log(engagement) over an age-gravity decay. Uses/plays
-- are the only engagement a sound has (no likes/comments of its own).
-- ---------------------------------------------------------------------
create or replace function public.recompute_sound_trend_scores(
  w_usage  double precision,
  w_play   double precision,
  gravity  double precision,
  max_age_hours int
) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.sounds set trend_score =
    ln(greatest(1.0, w_usage * usage_count + w_play * plays_count))
    / power(extract(epoch from (now() - created_at)) / 3600.0 + 2.0, gravity)
  where is_public
    and created_at > now() - make_interval(hours => max_age_hours);
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.sounds      enable row level security;
alter table public.sound_plays enable row level security;

drop policy if exists "sounds public read" on public.sounds;
create policy "sounds public read" on public.sounds
  for select using (is_public or auth.uid() = created_by or public.is_admin());

drop policy if exists "sounds owner write" on public.sounds;
create policy "sounds owner write" on public.sounds
  for all using (auth.uid() = created_by or public.is_admin())
  with check (auth.uid() = created_by or public.is_admin());

-- sound_plays: writes/reads via the service role only (no client policies),
-- same as post_views — dedup and counting happen server-side.
