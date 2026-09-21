-- ═══════════════════════════════════════════════════════════════════════════
--  0164 — DROP THE OLD claim_ai_job_start OVERLOAD (Character Replace Part 11)
-- ═══════════════════════════════════════════════════════════════════════════
-- 0158's eight-argument claim is dropped so the RPC is never ambiguous
-- between two overloads (PostgREST answers PGRST203 for an ambiguous call;
-- lib/ai/job-store.ts falls back to the eight-argument call on 202/203 until
-- this lands). Inside a `do $$ … execute` block, alone in its file.

do $$
begin
  execute 'drop function if exists public.claim_ai_job_start(uuid, uuid, text, integer, integer, integer, bigint, jsonb)';
end $$;
