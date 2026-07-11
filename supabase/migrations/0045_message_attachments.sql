-- =====================================================================
-- FrenzSave — Premium Messaging V2 Part 5: media messaging (images, video,
-- voice notes, documents). Purely additive. Idempotent.
--
-- Mirrors `post_media`'s shape (migration 0032) — same idx/media_kind/
-- media_url/thumbnail_url/dimensions columns — plus the extra fields voice
-- notes and generic files need (duration_ms, waveform, filename, size,
-- mime) that posts never did. Denormalizes `conversation_id` the same way
-- `message_reactions` already does (0041), for the same reason: cheap
-- Realtime channel filtering + a direct RLS membership check without a
-- nested join through `messages` on every row.
--
-- No client INSERT/UPDATE/DELETE policy — same D1 rule as messages
-- themselves (0041's own header): every write goes through
-- lib/social/messages.ts's service-role client, never client-direct.
--
-- Live-traffic note (see 0043/0044's own headers): same defensive
-- lock_timeout.
-- =====================================================================
set lock_timeout = '5s';

create table if not exists public.message_attachments (
  id              uuid primary key default uuid_generate_v4(),
  message_id      uuid not null references public.messages (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  idx             integer not null default 0,
  media_kind      text not null check (media_kind in ('image', 'video', 'audio', 'document')),
  media_url       text not null,
  thumbnail_url   text,
  media_width     integer,
  media_height    integer,
  duration_ms     integer,
  -- Voice-note waveform peaks (0-100 amplitudes) — same shape VoiceRecorder
  -- already produces client-side for comments; stored so a receiving bubble
  -- never has to re-decode audio just to draw the scrubber.
  waveform        jsonb,
  filename        text,
  mime_type       text,
  size_bytes       bigint,
  created_at      timestamptz not null default now(),
  unique (message_id, idx)
);
create index if not exists message_attachments_message_idx      on public.message_attachments (message_id);
create index if not exists message_attachments_conversation_idx on public.message_attachments (conversation_id);

alter table public.message_attachments enable row level security;
drop policy if exists "message attachments members read" on public.message_attachments;
create policy "message attachments members read" on public.message_attachments
  for select using (
    exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = message_attachments.conversation_id
        and cm.user_id = auth.uid() and cm.left_at is null
    )
  );

-- Realtime — without this, a channel subscribes fine but never receives
-- attachment rows landing after the parent message's own INSERT event (same
-- reasoning as every prior migration that's touched this publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_attachments'
  ) then
    alter publication supabase_realtime add table public.message_attachments;
  end if;
end $$;
