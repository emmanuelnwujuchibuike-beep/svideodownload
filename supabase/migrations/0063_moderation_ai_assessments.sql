-- 0063_moderation_ai_assessments.sql
-- Frenzsave · Premium Messaging V2 Part 11c: moderation pipeline extension —
-- a real (Claude haiku) risk assessment of a reported target, stored once
-- per (target_type, target_id) and refreshed on re-scoring. Separate from
-- `reports` (many rows per target, one per reporter) since this is a
-- single machine judgement about the CONTENT, not a per-reporter record.

create table if not exists public.moderation_ai_assessments (
  target_type text not null,
  target_id uuid not null,
  category text not null,
  severity int not null,
  rationale text not null,
  model text not null,
  created_at timestamptz not null default now(),
  primary key (target_type, target_id),
  constraint moderation_ai_assessments_target_chk check (target_type in ('post','comment','user')),
  constraint moderation_ai_assessments_severity_chk check (severity between 0 and 100)
);

alter table public.moderation_ai_assessments enable row level security;

-- Admin-only surface (the moderation queue) — no end-user reads this
-- directly, so no "own row" policy; service_role (admin API routes) is the
-- only writer/reader, same access model as `reports` itself.
