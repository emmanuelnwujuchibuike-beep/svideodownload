-- =====================================================================
-- 0104_verification.sql
-- Frenzsave · Account Verification — the blue tick, issued through a real
-- identity check rather than a toggle.
--
-- ── Model ──────────────────────────────────────────────────────────────
-- A member submits ONE request at a time. It carries the legal name exactly
-- as printed on their government ID, the document images, and a liveness
-- ("security") selfie. An admin reviews it in the dashboard and approves or
-- rejects it with a reason. An admin can also ISSUE verification directly,
-- skipping the whole process — that path writes an approved row with
-- `issued_directly = true` so the audit trail still records who granted it
-- and why, and the tick is never a change nobody can account for.
--
-- ── Why the documents are paths, not URLs ──────────────────────────────
-- The images live in the PRIVATE `verification-docs` storage bucket. Nothing
-- here is publicly readable: reviewers fetch short-lived signed URLs from a
-- server action, so a leaked row leaks a path, not someone's passport.
-- Only the last 4 characters of the document number are stored — enough for
-- a reviewer to match it against the image, useless to a thief.
--
-- ── Security ───────────────────────────────────────────────────────────
-- RLS: a member reads and writes only their OWN request, and only while it
-- is still 'draft' or 'pending' (an approved or rejected decision is not
-- theirs to edit). The decision fields are deliberately NOT writable by the
-- applicant — approvals happen server-side through the service role behind
-- getAdminUser, so no policy grants a member the ability to set
-- status = 'approved'. The events table is append-only history, readable by
-- the applicant for their own request and written only by the server.
--
-- Idempotent; safe to re-run.
-- =====================================================================

create table if not exists public.verification_requests (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,

  -- 'draft' | 'pending' | 'in_review' | 'approved' | 'rejected' | 'withdrawn'
  status                 text not null default 'draft',
  -- 'creator' | 'business' | 'public_figure' | 'journalist' | 'government' | 'other'
  category               text not null default 'creator',

  -- Identity, exactly as printed on the document. The applicant confirms the
  -- match; the reviewer checks it against the image.
  legal_name             text,
  known_as               text,          -- the name they are verified UNDER (display name)
  country                text,

  -- 'passport' | 'national_id' | 'drivers_license' | 'residence_permit'
  id_document_type       text,
  id_number_last4        text,          -- NEVER the full number
  id_front_path          text,          -- private storage paths
  id_back_path           text,
  selfie_path            text,          -- the security selfie

  links                  jsonb not null default '[]'::jsonb,  -- supporting references
  statement              text,          -- why they qualify, in their words

  -- Decision
  reviewer_id            uuid references auth.users (id) on delete set null,
  reviewed_at            timestamptz,
  decision_reason        text,
  rejection_code         text,          -- 'name_mismatch' | 'unreadable' | 'not_eligible' | ...
  issued_directly        boolean not null default false,

  submitted_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- Append-only audit trail: every state change, who made it and why.
create table if not exists public.verification_events (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.verification_requests (id) on delete cascade,
  actor_id     uuid references auth.users (id) on delete set null,
  actor_role   text not null,            -- 'user' | 'admin' | 'system'
  action       text not null,            -- 'created' | 'submitted' | 'approved' | ...
  detail       text,
  created_at   timestamptz not null default now()
);

-- One OPEN request per member — a partial unique index, so their closed
-- history is kept while a second live application is impossible.
create unique index if not exists verification_requests_one_open_idx
  on public.verification_requests (user_id)
  where status in ('draft', 'pending', 'in_review');

-- The admin queue: oldest waiting first, so nobody is left behind.
create index if not exists verification_requests_queue_idx
  on public.verification_requests (status, submitted_at);

create index if not exists verification_requests_user_idx
  on public.verification_requests (user_id, created_at desc);

create index if not exists verification_events_request_idx
  on public.verification_events (request_id, created_at);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.verification_requests enable row level security;
alter table public.verification_events   enable row level security;

drop policy if exists "verification own read" on public.verification_requests;
create policy "verification own read" on public.verification_requests
  for select using (auth.uid() = user_id);

drop policy if exists "verification own insert" on public.verification_requests;
create policy "verification own insert" on public.verification_requests
  for insert with check (
    auth.uid() = user_id
    and status in ('draft', 'pending')
    -- A member cannot self-issue: these are the reviewer's fields.
    and reviewer_id is null
    and reviewed_at is null
    and issued_directly = false
  );

-- Editable only while still open, and never into a decided state. The
-- decision itself is made server-side by the service role.
drop policy if exists "verification own update" on public.verification_requests;
create policy "verification own update" on public.verification_requests
  for update
  using (auth.uid() = user_id and status in ('draft', 'pending'))
  with check (
    auth.uid() = user_id
    and status in ('draft', 'pending', 'withdrawn')
    and reviewer_id is null
    and issued_directly = false
  );

drop policy if exists "verification events own read" on public.verification_events;
create policy "verification events own read" on public.verification_events
  for select using (
    exists (
      select 1 from public.verification_requests r
      where r.id = verification_events.request_id and r.user_id = auth.uid()
    )
  );

-- ── Private document storage ─────────────────────────────────────────
-- `public = false`: these bytes are never served without a signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-docs',
  'verification-docs',
  false,
  10485760,                                     -- 10 MB per image
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A member may upload into their OWN folder (<uid>/...) and read back what
-- they uploaded, so the form can show a thumbnail of what they attached.
-- There is deliberately no policy letting one member read another's folder;
-- reviewers read through the service role.
drop policy if exists "verification docs own write" on storage.objects;
create policy "verification docs own write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "verification docs own read" on storage.objects;
create policy "verification docs own read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "verification docs own delete" on storage.objects;
create policy "verification docs own delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'verification-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
