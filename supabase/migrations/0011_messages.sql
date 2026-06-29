-- =====================================================================
-- FrenzSave — Phase 11: direct messages (1:1)
-- One conversation per user pair (canonical low/high ids). Messaging is gated
-- by the recipient's messages_policy + blocks (enforced in the API); RLS limits
-- reads/writes to the two participants. Idempotent.
-- =====================================================================

create table if not exists public.conversations (
  id              uuid primary key default uuid_generate_v4(),
  user_low        uuid not null references auth.users (id) on delete cascade,
  user_high       uuid not null references auth.users (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  last_body       text,             -- denormalized snippet for the inbox list
  last_sender_id  uuid,
  created_at      timestamptz not null default now(),
  constraint conversations_order_chk check (user_low < user_high),
  constraint conversations_pair_uniq unique (user_low, user_high)
);
create index if not exists conversations_low_idx  on public.conversations (user_low, last_message_at desc);
create index if not exists conversations_high_idx on public.conversations (user_high, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

-- Keep conversations sorted by recency.
create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations set
    last_message_at = NEW.created_at,
    last_body = left(NEW.body, 140),
    last_sender_id = NEW.sender_id
  where id = NEW.conversation_id;
  return null;
end $$;
drop trigger if exists messages_bump_conv_trg on public.messages;
create trigger messages_bump_conv_trg
  after insert on public.messages
  for each row execute function public.bump_conversation();

-- =====================================================================
-- Row Level Security — participants only
-- =====================================================================
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

drop policy if exists "conversations participants" on public.conversations;
create policy "conversations participants" on public.conversations
  for select using (auth.uid() = user_low or auth.uid() = user_high);

drop policy if exists "messages participants read" on public.messages;
create policy "messages participants read" on public.messages
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and (auth.uid() = c.user_low or auth.uid() = c.user_high)
    )
  );
drop policy if exists "messages sender insert" on public.messages;
create policy "messages sender insert" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (auth.uid() = c.user_low or auth.uid() = c.user_high)
    )
  );
