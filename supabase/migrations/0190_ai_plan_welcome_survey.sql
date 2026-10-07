-- ═══════════════════════════════════════════════════════════════════════════
--  0190 — the AI plan welcome, once, and the optional plan survey (2026-10-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "when they subscribe for pro, they should receive a subscription
-- celebration and an optional survey around the plans features" - and the
-- same day: "the plan welcome survey show on all plans and not just AI plans".
-- So it covers the AI plans (ai_subscriptions) AND the Frenzsave plans
-- (subscriptions: pro, business).
--
--   1. ai_subscriptions.welcomed_plan / welcomed_at - the once-guard for the
--      welcome push. The webhook and the verify-on-return both activate the
--      same plan, sometimes within a second - a conditional update claims the
--      welcome for exactly one of them. A renewal is the same plan, so it is
--      not welcomed again. An upgrade (AI Pro to AI Max) is a new plan, so it is.
--   2. ai_plan_survey_responses - one optional answer per member per plan:
--      which plan features they came for, their main goal, a short comment.
--      Written only by the server (service role), read by the admin panel.
--
-- No semicolon inside any quoted string (the 0186 lesson).

alter table public.ai_subscriptions add column if not exists welcomed_plan text;
alter table public.ai_subscriptions add column if not exists welcomed_at timestamptz;
alter table public.subscriptions add column if not exists welcomed_plan text;
alter table public.subscriptions add column if not exists welcomed_at timestamptz;

create table if not exists public.ai_plan_survey_responses (
  user_id    uuid not null references auth.users (id) on delete cascade,
  plan       text not null,
  features   text[] not null default '{}',
  goal       text,
  comment    text,
  created_at timestamptz not null default now(),
  primary key (user_id, plan),
  constraint ai_plan_survey_plan_chk check (plan in ('ai_pro', 'ai_max', 'pro', 'business')),
  constraint ai_plan_survey_goal_len_chk check (goal is null or char_length(goal) <= 40),
  constraint ai_plan_survey_comment_len_chk check (comment is null or char_length(comment) <= 500),
  constraint ai_plan_survey_features_len_chk check (cardinality(features) <= 12)
);
create index if not exists ai_plan_survey_created_idx on public.ai_plan_survey_responses (created_at desc);
alter table public.ai_plan_survey_responses enable row level security;
revoke all on public.ai_plan_survey_responses from public, anon, authenticated;
grant all on public.ai_plan_survey_responses to service_role;
comment on table public.ai_plan_survey_responses is 'The optional plan survey (0190) - which plan features a new subscriber came for, for the AI plans and the Frenzsave plans. One row per member per plan. Service role only.';
