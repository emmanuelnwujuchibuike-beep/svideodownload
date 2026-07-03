-- =====================================================================
-- FrenzSave — Creator engagement upgrade: rich comments + post polls
--   • post_comments gains optional sticker + image attachments.
--   • comment_reactions — like a comment (maintains post_comments.likes_count).
--   • user_stickers — a member's saved sticker collection.
--   • post_polls / poll_options / poll_votes — creator polls with a public/
--     private choice per voter (a public vote reveals who picked what).
-- All additive + idempotent; existing reads keep working if this hasn't run yet
-- (the app degrades gracefully), so it's safe to apply any time.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Comment attachments — a comment may now be text, a sticker, an image, or
-- any mix. `body` may be empty when there's a sticker/image.
-- ---------------------------------------------------------------------
alter table public.post_comments
  add column if not exists sticker   text,
  add column if not exists image_url text;
alter table public.post_comments alter column body set default '';

-- ---------------------------------------------------------------------
-- comment_reactions — one "like" per (comment, user)
-- ---------------------------------------------------------------------
create table if not exists public.comment_reactions (
  comment_id uuid not null references public.post_comments (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_reactions_comment_idx on public.comment_reactions (comment_id);

create or replace function public.bump_comment_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    update public.post_comments set likes_count = likes_count + 1 where id = NEW.comment_id;
  elsif (TG_OP = 'DELETE') then
    update public.post_comments set likes_count = greatest(0, likes_count - 1) where id = OLD.comment_id;
  end if;
  return null;
end $$;
drop trigger if exists comment_reactions_count_trg on public.comment_reactions;
create trigger comment_reactions_count_trg
  after insert or delete on public.comment_reactions
  for each row execute function public.bump_comment_reactions();

alter table public.comment_reactions enable row level security;
drop policy if exists "comment_reactions self all" on public.comment_reactions;
create policy "comment_reactions self all" on public.comment_reactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- user_stickers — saved sticker collection (sticker id is a short string)
-- ---------------------------------------------------------------------
create table if not exists public.user_stickers (
  user_id    uuid not null references auth.users (id) on delete cascade,
  sticker    text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sticker)
);
create index if not exists user_stickers_user_idx on public.user_stickers (user_id, created_at desc);

alter table public.user_stickers enable row level security;
drop policy if exists "user_stickers self all" on public.user_stickers;
create policy "user_stickers self all" on public.user_stickers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Polls — a post can carry at most one poll (created by the post's owner)
-- ---------------------------------------------------------------------
create table if not exists public.post_polls (
  id             uuid primary key default uuid_generate_v4(),
  post_id        uuid not null unique references public.posts (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  question       text not null default '',
  allow_multiple boolean not null default false,
  closes_at      timestamptz,
  created_at     timestamptz not null default now()
);

create table if not exists public.poll_options (
  id          uuid primary key default uuid_generate_v4(),
  poll_id     uuid not null references public.post_polls (id) on delete cascade,
  position    int not null default 0,
  label       text not null,
  votes_count int not null default 0
);
create index if not exists poll_options_poll_idx on public.poll_options (poll_id, position);

create table if not exists public.poll_votes (
  poll_id    uuid not null references public.post_polls (id) on delete cascade,
  option_id  uuid not null references public.poll_options (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  is_public  boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);
create index if not exists poll_votes_option_idx on public.poll_votes (option_id);

create or replace function public.bump_poll_votes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (TG_OP = 'INSERT') then
    update public.poll_options set votes_count = votes_count + 1 where id = NEW.option_id;
  elsif (TG_OP = 'DELETE') then
    update public.poll_options set votes_count = greatest(0, votes_count - 1) where id = OLD.option_id;
  elsif (TG_OP = 'UPDATE' and NEW.option_id <> OLD.option_id) then
    update public.poll_options set votes_count = greatest(0, votes_count - 1) where id = OLD.option_id;
    update public.poll_options set votes_count = votes_count + 1 where id = NEW.option_id;
  end if;
  return null;
end $$;
drop trigger if exists poll_votes_count_trg on public.poll_votes;
create trigger poll_votes_count_trg
  after insert or delete or update on public.poll_votes
  for each row execute function public.bump_poll_votes();

-- RLS: polls + options are world-readable (public reads via service role too);
-- only the post owner writes them. Votes: read all (results are public), a voter
-- manages only their own row.
alter table public.post_polls   enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes   enable row level security;

drop policy if exists "post_polls read" on public.post_polls;
create policy "post_polls read" on public.post_polls for select using (true);
drop policy if exists "post_polls owner write" on public.post_polls;
create policy "post_polls owner write" on public.post_polls
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "poll_options read" on public.poll_options;
create policy "poll_options read" on public.poll_options for select using (true);
drop policy if exists "poll_options owner write" on public.poll_options;
create policy "poll_options owner write" on public.poll_options
  for all using (
    exists (select 1 from public.post_polls p where p.id = poll_options.poll_id and p.owner_id = auth.uid())
  ) with check (
    exists (select 1 from public.post_polls p where p.id = poll_options.poll_id and p.owner_id = auth.uid())
  );

drop policy if exists "poll_votes read" on public.poll_votes;
create policy "poll_votes read" on public.poll_votes for select using (true);
drop policy if exists "poll_votes self write" on public.poll_votes;
create policy "poll_votes self write" on public.poll_votes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
