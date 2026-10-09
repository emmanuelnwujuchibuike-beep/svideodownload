-- ═══════════════════════════════════════════════════════════════════════════
--  0200 — chat streaks: two people who keep talking (2026-10-09)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "hide the streak icon and fire from the landing and Download page and
-- take it to the chat page, it should be in the chat page and by the side of any
-- user that they both have a conversation for more than up to 2 days."
--
-- A DAY COUNTS when BOTH people in a direct chat sent at least one message that
-- day (UTC). Consecutive counted days make the streak. It is shown from 2 days
-- and is alive while its last counted day is today or yesterday.
--
--   conversation_streaks        one small row per direct chat, kept by a trigger,
--                               so the inbox reads it with ONE indexed query and
--                               nothing ever scans message history to show it
--   bump_conversation_streak()  AFTER INSERT on messages. Its own exception
--                               handler means a streak fault can never block or
--                               fail a message.
--   backfill                    the last 90 days, so a streak already running
--                               shows at once instead of restarting at zero
--
-- Service role only (the inbox reads it on the server). No semicolon inside any
-- quoted string (the 0186 lesson). Functions and the DO block last.

create table if not exists public.conversation_streaks (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  current_days    integer not null default 0,
  longest_days    integer not null default 0,
  last_day        date,
  low_day         date,
  high_day        date,
  updated_at      timestamptz not null default now(),
  constraint conversation_streaks_days_chk check (current_days >= 0 and longest_days >= current_days)
);
alter table public.conversation_streaks enable row level security;
revoke all on public.conversation_streaks from public, anon, authenticated;
grant all on public.conversation_streaks to service_role;
comment on table public.conversation_streaks is 'Chat streaks (0200): consecutive UTC days on which BOTH people in a direct chat sent a message. Kept by bump_conversation_streak(). Service role only.';

-- backfill 1: who last sent in each direct chat with recent messages (today or yesterday matter)
insert into public.conversation_streaks (conversation_id, low_day, high_day)
select c.id,
       max(case when m.sender_id = c.user_low then (m.created_at at time zone 'utc')::date end),
       max(case when m.sender_id = c.user_high then (m.created_at at time zone 'utc')::date end)
  from public.conversations c
  join public.messages m on m.conversation_id = c.id
 where c.type = 'direct' and m.created_at > now() - interval '3 days'
 group by c.id
on conflict (conversation_id) do nothing;

-- backfill 2: the latest run of days on which both sent, within 90 days
insert into public.conversation_streaks (conversation_id, current_days, longest_days, last_day)
select r.conversation_id, r.len, r.longest, r.e
  from (
    select g.conversation_id, max(g.day) as e, count(*)::integer as len,
           max(count(*)::integer) over (partition by g.conversation_id) as longest,
           row_number() over (partition by g.conversation_id order by max(g.day) desc) as rn
      from (
        select d.conversation_id, d.day, d.day - (row_number() over (partition by d.conversation_id order by d.day))::integer as grp
          from (
            select m.conversation_id, (m.created_at at time zone 'utc')::date as day
              from public.messages m
              join public.conversations c on c.id = m.conversation_id and c.type = 'direct'
             where m.created_at > now() - interval '90 days'
             group by m.conversation_id, (m.created_at at time zone 'utc')::date
            having count(distinct m.sender_id) >= 2
          ) d
      ) g
     group by g.conversation_id, g.grp
  ) r
 where r.rn = 1
on conflict (conversation_id) do update
   set current_days = excluded.current_days, longest_days = excluded.longest_days, last_day = excluded.last_day, updated_at = now();

create or replace function public.bump_conversation_streak() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_conv record;
  v_day  date;
  v_row  record;
  v_low  date;
  v_high date;
  v_cur  integer;
  v_last date;
begin
  begin
    select type, user_low, user_high into v_conv from public.conversations where id = new.conversation_id;
    if v_conv.type is distinct from 'direct' then return null; end if;
    if new.sender_id is distinct from v_conv.user_low and new.sender_id is distinct from v_conv.user_high then return null; end if;
    v_day := (new.created_at at time zone 'utc')::date;

    insert into public.conversation_streaks (conversation_id) values (new.conversation_id) on conflict (conversation_id) do nothing;
    select * into v_row from public.conversation_streaks where conversation_id = new.conversation_id for update;

    v_low  := case when new.sender_id = v_conv.user_low then greatest(coalesce(v_row.low_day, v_day), v_day) else v_row.low_day end;
    v_high := case when new.sender_id = v_conv.user_high then greatest(coalesce(v_row.high_day, v_day), v_day) else v_row.high_day end;
    v_cur  := v_row.current_days;
    v_last := v_row.last_day;

    -- both have spoken today, and today is not counted yet
    if v_low = v_day and v_high = v_day and v_last is distinct from v_day then
      v_cur  := case when v_last = v_day - 1 then v_cur + 1 else 1 end;
      v_last := v_day;
    end if;

    update public.conversation_streaks
       set low_day = v_low, high_day = v_high, current_days = v_cur, last_day = v_last,
           longest_days = greatest(longest_days, v_cur), updated_at = now()
     where conversation_id = new.conversation_id;
  exception when others then
    -- a streak is decoration: it must never cost a message
    return null;
  end;
  return null;
end;
$$;

do $$
begin
  execute 'drop trigger if exists bump_conversation_streak_trg on public.messages';
  execute 'create trigger bump_conversation_streak_trg after insert on public.messages for each row execute function public.bump_conversation_streak()';
  execute 'revoke all on function public.bump_conversation_streak() from public, anon, authenticated';
end $$;
