-- Widen reward_sessions.type for the VIDEO_PREVIEW reward context.
--
-- 0117_reward_sessions.sql created the table with `type text not null check
-- (type in ('hd', 'batch'))` for the HD/batch download-unlock reward flow.
-- The GPT rewarded-ad spec (owner, 2026-08-16) adds a second, independent
-- reward-gated feature — previewing an already-downloaded video from history
-- — using the exact same session/redemption mechanism (lib/monetization/
-- reward-sessions.ts). Everything about the table except this constraint is
-- already generic; only the allowed values need to grow.
alter table public.reward_sessions
  drop constraint if exists reward_sessions_type_check;

alter table public.reward_sessions
  add constraint reward_sessions_type_check check (type in ('hd', 'batch', 'preview'));
