-- 0228 — an account with followers could not be deleted (found 2026-10-11).
--
-- Deleting a user cascades its `follows` rows. The AFTER DELETE trigger from 0217
-- (`track_follower_daily`) then recorded a "lost follower" for the FOLLOWED
-- account — which, when the followed account is the one being deleted, no longer
-- exists, so the insert into `follower_daily` broke its foreign key and the whole
-- account deletion was refused ("Database error deleting user"). Every member who
-- had a follower was affected.
--
-- Now a loss is only counted for an account that still exists. When someone ELSE
-- deletes their account, the people they followed still see the lost follower.
-- Idempotent; replaces the function only, the trigger is unchanged.

create or replace function public.track_follower_daily() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.follower_daily (user_id, day, gained) values (new.following_id, (now() at time zone 'utc')::date, 1)
    on conflict (user_id, day) do update set gained = public.follower_daily.gained + 1;
    return new;
  end if;
  -- the followed account itself is being deleted: nobody is left to count a loss for
  if not exists (select 1 from auth.users u where u.id = old.following_id) then
    return old;
  end if;
  insert into public.follower_daily (user_id, day, lost) values (old.following_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set lost = public.follower_daily.lost + 1;
  return old;
end $$;

do $$ begin
  revoke all on function public.track_follower_daily() from public, anon, authenticated;
end $$;
