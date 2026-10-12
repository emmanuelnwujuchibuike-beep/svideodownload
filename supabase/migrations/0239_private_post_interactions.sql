-- Private posts (formerly SUB): likes and comments, like a public post - but only for a member
-- who can open the post (an active subscriber, or the creator). There is no save for a private post.
-- Every read and write goes through the server, which checks access first (lib/sub/interactions.ts),
-- so RLS is on with no client policies.
create table if not exists public.sub_post_likes (
  post_id uuid not null references public.sub_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists public.sub_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.sub_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists sub_post_comments_post_idx on public.sub_post_comments (post_id, created_at);

alter table public.sub_post_likes enable row level security;
alter table public.sub_post_comments enable row level security;
