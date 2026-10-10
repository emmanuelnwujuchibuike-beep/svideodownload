-- 0220 — Contact Discovery (Feature 19 · Part 5): privacy-first contact matching.
--
-- What the brief asks, and how this answers it:
--   · "Never upload raw contacts. Hash, compare securely, discard unmatched
--     hashes." The browser normalises each e-mail address (trim, lower case)
--     and sends ONLY its SHA-256. Here each hash is keyed again with a server
--     secret nobody can read (contact_private_settings) and looked up in
--     contact_match_keys, the members' own keyed e-mail hashes. A hash that
--     matches nobody is never written anywhere.
--   · "Users decide who may discover them." profile_discovery.findable_by_email:
--     everyone (the default, as in every contact-sync app), friends of friends,
--     or nobody. Checked on EVERY match and every read of a saved match, so
--     changing it takes effect at once, including for matches saved earlier.
--   · Only a CONFIRMED address is matchable. An unconfirmed sign-up with someone
--     else's address must never make that person "found".
--   · Enumeration: at most 500 hashes per call and 2,000 per member per UTC day,
--     counted in the database (contact_match_usage), so a client cannot probe
--     the member list at scale. The server secret means a leaked key table
--     cannot be reversed offline with a dictionary of addresses either.
--   · "Delete synced contacts." Nothing about a contact is stored unless the
--     member asks to remember their matches, and then only the pair
--     (owner, matched member) in contact_matches, deletable by the owner.
--
-- Phone numbers are NOT matched: Frenz has no verified phone numbers, and an
-- unverified number would let anyone claim someone else's. Phones from a
-- contact are used on the device only, to address an SMS or WhatsApp invite.
--
-- Idempotent. Every dollar-quoted block is at the end (the runner splits on
-- semicolons outside dollar quotes, so no comment below may contain one).

create table if not exists public.contact_private_settings (
  id         boolean primary key default true,
  key_secret text not null,
  constraint contact_private_settings_singleton_chk check (id)
);
alter table public.contact_private_settings enable row level security;
revoke all on public.contact_private_settings from public, anon, authenticated;
insert into public.contact_private_settings (id, key_secret)
values (true, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (id) do nothing;

-- one keyed e-mail hash per member with a CONFIRMED address
create table if not exists public.contact_match_keys (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email_key  text not null,
  updated_at timestamptz not null default now()
);
create index if not exists contact_match_keys_email_idx on public.contact_match_keys (email_key);
alter table public.contact_match_keys enable row level security;
revoke all on public.contact_match_keys from public, anon, authenticated;

-- matches a member chose to remember: the PAIR only, never the address or its hash
create table if not exists public.contact_matches (
  owner_id   uuid not null references auth.users (id) on delete cascade,
  matched_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, matched_id),
  constraint contact_matches_not_self check (owner_id <> matched_id)
);
alter table public.contact_matches enable row level security;
drop policy if exists "contact matches owner read" on public.contact_matches;
create policy "contact matches owner read" on public.contact_matches for select using (owner_id = auth.uid());
drop policy if exists "contact matches owner delete" on public.contact_matches;
create policy "contact matches owner delete" on public.contact_matches for delete using (owner_id = auth.uid());
revoke insert, update on public.contact_matches from anon, authenticated;

-- the daily enumeration cap, counted where a client cannot skip it
create table if not exists public.contact_match_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  hashes  integer not null default 0,
  primary key (user_id, day)
);
alter table public.contact_match_usage enable row level security;
revoke all on public.contact_match_usage from public, anon, authenticated;

alter table public.profile_discovery add column if not exists findable_by_email text not null default 'everyone';
alter table public.profile_discovery drop constraint if exists profile_discovery_findable_by_email_chk;
alter table public.profile_discovery add constraint profile_discovery_findable_by_email_chk check (findable_by_email in ('everyone', 'friends_of_friends', 'nobody'));

comment on table public.contact_match_keys is '0220: each member''s CONFIRMED e-mail as a keyed hash (server secret over the SHA-256 the browser also computes). Never the address.';
comment on table public.contact_matches is '0220: contact matches a member chose to remember - the pair only. Privacy is re-checked on every read.';
comment on table public.contact_match_usage is '0220: hashes checked per member per UTC day - the enumeration cap. Pruned after 7 days.';
comment on column public.profile_discovery.findable_by_email is '0220: who may find this member from an address in their contacts - everyone, friends_of_friends or nobody.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- The keyed form of a browser hash. p_hash = sha256(lower(trim(address))) as lower-case hex.
create or replace function public.contact_key(p_hash text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(s.key_secret || ':' || lower(p_hash), 'UTF8')), 'hex')
  from public.contact_private_settings s where s.id
$$;

-- Keep a member's key in step with their address: written when it is confirmed, removed otherwise.
create or replace function public.contact_key_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email_confirmed_at is not null then
    insert into public.contact_match_keys (user_id, email_key, updated_at)
    values (new.id, public.contact_key(encode(sha256(convert_to(lower(trim(new.email)), 'UTF8')), 'hex')), now())
    on conflict (user_id) do update set email_key = excluded.email_key, updated_at = now();
  else
    delete from public.contact_match_keys where user_id = new.id;
  end if;
  return new;
end;
$$;

-- May p_viewer find p_target from an address? Blocks either way and the target's own setting decide.
create or replace function public.contact_findable(p_viewer uuid, p_target uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_viewer is not null and p_target is not null and p_viewer <> p_target
    and not exists (select 1 from public.blocks b where (b.blocker_id = p_viewer and b.blocked_id = p_target) or (b.blocker_id = p_target and b.blocked_id = p_viewer))
    and case coalesce((select d.findable_by_email from public.profile_discovery d where d.user_id = p_target), 'everyone')
      when 'everyone' then true
      when 'nobody' then false
      else exists (
        -- already friends, or one friend in common
        select 1 from public.friendships f
        where (f.user_low = least(p_viewer, p_target) and f.user_high = greatest(p_viewer, p_target))
      ) or exists (
        select 1
        from public.friendships a
        join public.friendships b
          on (case when b.user_low = p_target then b.user_high else b.user_low end) = (case when a.user_low = p_viewer then a.user_high else a.user_low end)
        where (a.user_low = p_viewer or a.user_high = p_viewer)
          and (b.user_low = p_target or b.user_high = p_target)
      )
    end
$$;

-- Match a batch of browser hashes for the signed-in member. Returns which of THEIR hashes matched whom.
create or replace function public.match_contact_hashes(p_hashes text[], p_remember boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_n     integer;
  v_used  integer;
  v_out   jsonb;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  v_n := coalesce(array_length(p_hashes, 1), 0);
  if v_n = 0 then return jsonb_build_object('ok', true, 'matches', '[]'::jsonb, 'remaining', null); end if;
  if v_n > 500 then return jsonb_build_object('ok', false, 'reason', 'too_many'); end if;
  if exists (select 1 from unnest(p_hashes) h where h is null or h !~ '^[0-9a-f]{64}$') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  insert into public.contact_match_usage as u (user_id, day, hashes) values (v_uid, (now() at time zone 'utc')::date, v_n)
  on conflict (user_id, day) do update set hashes = u.hashes + excluded.hashes
  returning hashes into v_used;
  if v_used > 2000 then
    -- refused calls do not burn the allowance
    update public.contact_match_usage set hashes = hashes - v_n where user_id = v_uid and day = (now() at time zone 'utc')::date;
    return jsonb_build_object('ok', false, 'reason', 'daily_limit');
  end if;

  with q as (select distinct h from unnest(p_hashes) h),
  m as (
    select q.h, k.user_id
    from q join public.contact_match_keys k on k.email_key = public.contact_key(q.h)
    where public.contact_findable(v_uid, k.user_id)
  ),
  saved as (
    insert into public.contact_matches (owner_id, matched_id)
    select v_uid, m.user_id from m where p_remember
    on conflict do nothing
    returning 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('h', m.h, 'id', m.user_id)), '[]'::jsonb) into v_out from m;

  delete from public.contact_match_usage where day < (now() at time zone 'utc')::date - 7;
  return jsonb_build_object('ok', true, 'matches', v_out, 'remaining', greatest(0, 2000 - v_used));
end;
$$;

-- The member's remembered matches that are STILL findable (a setting changed since is honoured).
create or replace function public.my_contact_matches() returns setof uuid
language sql stable security definer set search_path = public as $$
  select c.matched_id from public.contact_matches c
  where c.owner_id = auth.uid() and public.contact_findable(auth.uid(), c.matched_id)
  order by c.created_at desc
  limit 500
$$;

do $$
begin
  drop trigger if exists on_auth_user_contact_key on auth.users;
  create trigger on_auth_user_contact_key after insert or update of email, email_confirmed_at on auth.users
    for each row execute function public.contact_key_sync();

  -- backfill every confirmed address that exists today
  insert into public.contact_match_keys (user_id, email_key, updated_at)
  select u.id, public.contact_key(encode(sha256(convert_to(lower(trim(u.email)), 'UTF8')), 'hex')), now()
  from auth.users u where u.email is not null and u.email_confirmed_at is not null
  on conflict (user_id) do update set email_key = excluded.email_key, updated_at = now();

  -- a follow made from the Contacts page says so (follower insights, 0217). Same list as lib/social/follow-policy.ts FOLLOW_SOURCES.
  alter table public.follows drop constraint if exists follows_source_chk;
  alter table public.follows add constraint follows_source_chk
    check (source is null or source in ('profile', 'search', 'suggestion', 'feed', 'reels', 'qr', 'request', 'contacts', 'other'));
  alter table public.follow_requests drop constraint if exists follow_requests_source_chk;
  alter table public.follow_requests add constraint follow_requests_source_chk
    check (source is null or source in ('profile', 'search', 'suggestion', 'feed', 'reels', 'qr', 'request', 'contacts', 'other'));

  revoke all on function public.contact_key(text) from public, anon, authenticated;
  revoke all on function public.contact_key_sync() from public, anon, authenticated;
  revoke all on function public.contact_findable(uuid, uuid) from public, anon, authenticated;
  revoke all on function public.match_contact_hashes(text[], boolean) from public, anon;
  grant execute on function public.match_contact_hashes(text[], boolean) to authenticated;
  revoke all on function public.my_contact_matches() from public, anon;
  grant execute on function public.my_contact_matches() to authenticated;
end;
$$;
