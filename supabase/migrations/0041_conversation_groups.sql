-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 1: group conversations + message
-- lifecycle (reply/edit/delete/pin/react). Direct (1:1) messaging keeps its
-- exact current shape/behavior; conversations gain a `type` so a `group`
-- variant can coexist. Purely additive — every new column is nullable or
-- defaulted, every new table is unreferenced by the app until the service
-- layer lands, so this is safe to apply with the OLD application code still
-- running. Idempotent.
--
-- Explicitly OUT of scope here (see docs/PROJECT_NOTES.md for the full
-- writeup): end-to-end encryption (TLS + Supabase at-rest only), rich
-- attachments (image/voice/video messages — text + the existing shared-post
-- embed only), message search, partitioning/sharding, a separate Redis
-- pub/sub layer — Supabase Realtime remains the only transport.
-- =====================================================================

-- ---------------------------------------------------------------------
-- conversations: direct (existing 2-party) OR group. user_low/user_high
-- become nullable and mean nothing for group rows; the old unique pair
-- constraint becomes a partial index scoped to type='direct' so direct
-- threads keep their exact current dedup guarantee.
-- ---------------------------------------------------------------------
alter table public.conversations
  add column if not exists type       text not null default 'direct',
  add column if not exists title      text,
  add column if not exists avatar_url text,
  add column if not exists created_by uuid references auth.users (id) on delete set null;

alter table public.conversations alter column user_low  drop not null;
alter table public.conversations alter column user_high drop not null;

alter table public.conversations drop constraint if exists conversations_order_chk;
alter table public.conversations drop constraint if exists conversations_pair_uniq;
alter table public.conversations drop constraint if exists conversations_type_chk;
alter table public.conversations drop constraint if exists conversations_shape_chk;
alter table public.conversations drop constraint if exists conversations_title_len_chk;

alter table public.conversations add constraint conversations_type_chk
  check (type in ('direct', 'group'));
alter table public.conversations add constraint conversations_shape_chk check (
  (type = 'direct' and user_low is not null and user_high is not null and user_low < user_high)
  or
  (type = 'group' and user_low is null and user_high is null)
);
alter table public.conversations add constraint conversations_title_len_chk
  check (title is null or char_length(title) <= 80);

create unique index if not exists conversations_direct_pair_uidx
  on public.conversations (user_low, user_high) where type = 'direct';

-- ---------------------------------------------------------------------
-- conversation_members — one row per (conversation, user). Backs both
-- direct AND group membership (backfilled below for every existing direct
-- conversation). Also colocates per-viewer conversation prefs (mute/
-- archive/pin) and the group unread-count read cursor, rather than a
-- separate preferences table — mirrors how post_comments.pinned/is_best
-- and user_home_preferences colocate per-user flags on the row that
-- already scopes user<->entity.
-- ---------------------------------------------------------------------
create table if not exists public.conversation_members (
  conversation_id   uuid not null references public.conversations (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  role              text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,             -- soft-leave: row stays for history/read-cursor
  muted             boolean not null default false,
  archived          boolean not null default false,
  pinned            boolean not null default false,
  last_read_at      timestamptz,             -- group unread-count cursor
  last_delivered_at timestamptz,
  updated_at        timestamptz not null default now(), -- touched on any new/edited/deleted
                                                          -- message + roster/rename changes —
                                                          -- the realtime fan-out signal (see
                                                          -- sync_conversation_preview below)
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx
  on public.conversation_members (user_id, updated_at desc) where left_at is null;
create index if not exists conversation_members_conv_idx
  on public.conversation_members (conversation_id) where left_at is null;
-- Exactly one active owner per conversation, enforced at the DB level.
create unique index if not exists conversation_members_one_owner_uidx
  on public.conversation_members (conversation_id) where role = 'owner' and left_at is null;

alter table public.conversation_members enable row level security;
drop policy if exists "conversation_members roster read" on public.conversation_members;
create policy "conversation_members roster read" on public.conversation_members
  for select using (
    conversation_id in (
      select cm.conversation_id from public.conversation_members cm
      where cm.user_id = auth.uid() and cm.left_at is null
    )
  );
-- No insert/update/delete policy: membership/role/mute/archive/pin writes all
-- go through lib/social/messages.ts via the service-role client, same as
-- every existing write to conversations/messages.

-- Backfill: every pre-existing row is type='direct' by the time this runs
-- (the column default applied above before this insert executes).
insert into public.conversation_members (conversation_id, user_id, role)
select id, user_low, 'member' from public.conversations where type = 'direct' and user_low is not null
on conflict (conversation_id, user_id) do nothing;
insert into public.conversation_members (conversation_id, user_id, role)
select id, user_high, 'member' from public.conversations where type = 'direct' and user_high is not null
on conflict (conversation_id, user_id) do nothing;

-- ---------------------------------------------------------------------
-- messages: reply-to, edit, soft-delete, pin. No E2E crypto (out of
-- scope), no attachment columns (deferred to a later part).
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages (id) on delete set null,
  add column if not exists edited_at   timestamptz,
  add column if not exists deleted_at  timestamptz,
  add column if not exists pinned      boolean not null default false,
  add column if not exists pinned_at   timestamptz,
  add column if not exists pinned_by   uuid references auth.users (id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;
create index if not exists messages_pinned_idx   on public.messages (conversation_id) where pinned;
-- No new messages RLS policies: edit/delete/pin stay admin-mediated, exactly
-- like the existing send path (there is still no client UPDATE/DELETE policy).

-- ---------------------------------------------------------------------
-- message_reactions — one row per (message, user), same shape as
-- comment_reactions (0022/0023): switching emoji is an UPDATE, not a new
-- row. conversation_id is denormalized ONLY so the per-thread realtime
-- channel can filter on it directly; RLS still authorizes via the messages
-- join (not this column), and `with check` re-derives it server-side so a
-- client can't misroute the realtime event even if it lied about it.
-- ---------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  emoji           text not null default '❤️',
  created_at      timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_message_idx      on public.message_reactions (message_id);
create index if not exists message_reactions_conversation_idx on public.message_reactions (conversation_id);

alter table public.message_reactions enable row level security;
drop policy if exists "message_reactions participant all" on public.message_reactions;

-- SELECT is member-wide (any active member of the conversation can see WHO
-- reacted, not just their own reaction) — a single combined "for all" policy
-- here would have restricted SELECT to `auth.uid() = user_id` too, which was
-- a real bug: postgres_changes enforces RLS on realtime delivery, so with a
-- single self-only policy no participant would ever receive a LIVE reaction
-- event from anyone but themselves. Split so reads are member-wide and only
-- writes are self-scoped.
drop policy if exists "message_reactions member read" on public.message_reactions;
create policy "message_reactions member read" on public.message_reactions
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_reactions.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "message_reactions self insert" on public.message_reactions;
create policy "message_reactions self insert" on public.message_reactions
  for insert with check (
    auth.uid() = user_id
    and conversation_id = (select m.conversation_id from public.messages m where m.id = message_reactions.message_id)
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_reactions.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "message_reactions self update" on public.message_reactions;
create policy "message_reactions self update" on public.message_reactions
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and conversation_id = (select m.conversation_id from public.messages m where m.id = message_reactions.message_id)
  );

drop policy if exists "message_reactions self delete" on public.message_reactions;
create policy "message_reactions self delete" on public.message_reactions
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Replace the INSERT-only bump_conversation() with a preview-sync that also
-- fires on edit/delete (so the inbox preview never shows stale pre-edit or
-- deleted text) and touches every active member's conversation_members row
-- — the single-column realtime fan-out signal that replaces the old
-- 2-channel user_low/user_high OR-hack (features/social/inbox.ts).
-- ---------------------------------------------------------------------
create or replace function public.sync_conversation_preview()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  target_conv uuid := coalesce(NEW.conversation_id, OLD.conversation_id);
  latest record;
begin
  select id, body, sender_id, created_at into latest
  from public.messages
  where conversation_id = target_conv and deleted_at is null
  order by created_at desc
  limit 1;

  update public.conversations set
    last_message_at = coalesce(latest.created_at, last_message_at),
    last_body        = case when latest.id is null then null else left(latest.body, 140) end,
    last_sender_id   = latest.sender_id
  where id = target_conv;

  update public.conversation_members
    set updated_at = now()
    where conversation_id = target_conv and left_at is null;

  return null;
end $$;

drop trigger if exists messages_bump_conv_trg on public.messages;
drop function if exists public.bump_conversation();
drop trigger if exists messages_sync_preview_trg on public.messages;
create trigger messages_sync_preview_trg
  after insert or update of body, deleted_at on public.messages
  for each row execute function public.sync_conversation_preview();

-- A group rename/avatar-change should also nudge the inbox/live-toast fan-out
-- for every active member (there's no `messages` row to hang that off for
-- this event). Scoped to the `conversations` table only — NEW.id is only
-- valid there; NOT reused for conversation_members (roster changes are
-- already delivered directly to conversation-room.tsx's per-thread
-- `conversation_members` subscription, and don't affect anyone's unread
-- count, so no cross-row touch is needed for those).
create or replace function public.touch_members_on_conversation_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversation_members
    set updated_at = now()
    where conversation_id = NEW.id and left_at is null;
  return null;
end $$;

drop trigger if exists conversations_touch_members_trg on public.conversations;
create trigger conversations_touch_members_trg
  after update of title, avatar_url on public.conversations
  for each row execute function public.touch_members_on_conversation_change();

-- ---------------------------------------------------------------------
-- CRITICAL FIX: conversations/messages' original RLS policies (0011) are
-- keyed on conversations.user_low/user_high — which are now NULL for every
-- group conversation (see conversations_shape_chk above). Since Postgres
-- Realtime enforces RLS on `postgres_changes` delivery, this silently
-- blocked ALL realtime message delivery for group threads (they'd only
-- catch up on resync/reconnect, never live), and — more severely — it
-- blocked message_reactions INSERTs from EVER succeeding in a group at all:
-- that policy's `with check` reads `messages.conversation_id` via a
-- subquery, which is itself subject to `messages`' own SELECT RLS, so a
-- broken `messages` SELECT policy silently rejected every group reaction.
-- Rewritten to check `conversation_members` instead, which uniformly covers
-- both direct and group conversations (direct behavior is unchanged: the
-- backfilled membership rows are exactly the same 2 users `user_low`/
-- `user_high` already named).
-- ---------------------------------------------------------------------
drop policy if exists "conversations participants" on public.conversations;
create policy "conversations participants" on public.conversations
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = conversations.id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "messages participants read" on public.messages;
create policy "messages participants read" on public.messages
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

drop policy if exists "messages sender insert" on public.messages;
create policy "messages sender insert" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = messages.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

-- ---------------------------------------------------------------------
-- Atomic ownership transfer. The service layer previously did this as two
-- separate JS-orchestrated UPDATEs (demote old owner, then promote new
-- owner) with a best-effort rollback on failure — if the SECOND update
-- failed AND the rollback itself failed (e.g. a connection drop mid-
-- sequence), the group could be left with zero owners and no recovery
-- path (transferOwnership itself requires an existing owner to call it).
-- A single SECURITY DEFINER function makes both updates one transaction:
-- either both land or neither does.
-- ---------------------------------------------------------------------
create or replace function public.transfer_group_ownership(
  p_conversation_id uuid,
  p_actor_id uuid,
  p_new_owner_id uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  actor_role text;
  target_role text;
begin
  if p_actor_id = p_new_owner_id then
    return false;
  end if;

  select role into actor_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = p_actor_id and left_at is null;
  if actor_role is distinct from 'owner' then
    return false;
  end if;

  select role into target_role from public.conversation_members
    where conversation_id = p_conversation_id and user_id = p_new_owner_id and left_at is null;
  if target_role is null then
    return false;
  end if;

  update public.conversation_members set role = 'admin'
    where conversation_id = p_conversation_id and user_id = p_actor_id;
  update public.conversation_members set role = 'owner'
    where conversation_id = p_conversation_id and user_id = p_new_owner_id;

  return true;
end $$;

-- ---------------------------------------------------------------------
-- Realtime: without this, channels connect but never receive anything
-- (same reasoning as 0017's own header).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_members'
  ) then
    alter publication supabase_realtime add table public.conversation_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
