-- 0226 — Professional Network™ (Feature 19 · Part 12).
--
-- Reused, not rebuilt: profile_details (headline, skills, languages, country,
-- availability, résumé) and profile_credentials (experience, education,
-- certifications, awards, publications, projects) from 0107, the digital
-- business card at /u/<handle>/card, and private relationship_labels (0112).
--
-- New:
--   profile_details.open_to / industry   what a member is open to
--                                        professionally, and their industry.
--                                        Public profile facts, like skills.
--   pro_connections        a professional relationship BOTH people confirm,
--                          each side naming its role ("manager" / "direct
--                          report"). One open request or connection per pair.
--   pro_recommendations    words about a member, shown only once that member
--                          approves them. One per author, subject and kind.
--   skill_endorsements     one person vouching for one skill of another.
--   pro_opportunities      open positions, internships, freelance, volunteer,
--                          partnership, research and creator roles.
--
-- Every write goes through the server (lib/social/professional/server.ts),
-- which checks blocks, connection and approval rules. RLS lets the two people
-- involved read their own rows, and nobody write directly.
--
-- Idempotent. No semicolon inside any quoted string. Every dollar-quoted block
-- is at the end.

alter table public.profile_details add column if not exists open_to  text[] not null default '{}';
alter table public.profile_details add column if not exists industry text;

create table if not exists public.pro_connections (
  id             uuid primary key default gen_random_uuid(),
  requester_id   uuid not null references auth.users (id) on delete cascade,
  addressee_id   uuid not null references auth.users (id) on delete cascade,
  addressee_role text not null,
  requester_role text not null,
  custom_label   text,
  context        text,
  note           text,
  status         text not null default 'pending',
  created_at     timestamptz not null default now(),
  responded_at   timestamptz,
  constraint pro_connections_not_self check (requester_id <> addressee_id)
);
create unique index if not exists pro_connections_open_pair_uidx on public.pro_connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id)) where status in ('pending', 'accepted');
create index if not exists pro_connections_addressee_idx on public.pro_connections (addressee_id, status);
create index if not exists pro_connections_requester_idx on public.pro_connections (requester_id, status);
alter table public.pro_connections enable row level security;
drop policy if exists "pro connections parties read" on public.pro_connections;
create policy "pro connections parties read" on public.pro_connections
  for select using ((select auth.uid()) in (requester_id, addressee_id));

create table if not exists public.pro_recommendations (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references auth.users (id) on delete cascade,
  kind        text not null default 'recommendation',
  body        text not null,
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  constraint pro_recommendations_not_self check (author_id <> subject_id)
);
create unique index if not exists pro_recommendations_uidx on public.pro_recommendations (author_id, subject_id, kind);
create index if not exists pro_recommendations_subject_idx on public.pro_recommendations (subject_id, status);
alter table public.pro_recommendations enable row level security;
drop policy if exists "pro recommendations parties read" on public.pro_recommendations;
create policy "pro recommendations parties read" on public.pro_recommendations
  for select using ((select auth.uid()) in (author_id, subject_id));

create table if not exists public.skill_endorsements (
  endorser_id uuid not null references auth.users (id) on delete cascade,
  subject_id  uuid not null references auth.users (id) on delete cascade,
  skill       text not null,
  created_at  timestamptz not null default now(),
  constraint skill_endorsements_not_self check (endorser_id <> subject_id)
);
create unique index if not exists skill_endorsements_uidx on public.skill_endorsements (endorser_id, subject_id, lower(skill));
create index if not exists skill_endorsements_subject_idx on public.skill_endorsements (subject_id);
alter table public.skill_endorsements enable row level security;
drop policy if exists "skill endorsements parties read" on public.skill_endorsements;
create policy "skill endorsements parties read" on public.skill_endorsements
  for select using ((select auth.uid()) in (endorser_id, subject_id));

create table if not exists public.pro_opportunities (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  title       text not null,
  description text,
  location    text,
  remote      boolean not null default false,
  link        text,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists pro_opportunities_open_idx on public.pro_opportunities (status, created_at desc);
create index if not exists pro_opportunities_owner_idx on public.pro_opportunities (owner_id);
alter table public.pro_opportunities enable row level security;
drop policy if exists "pro opportunities owner read" on public.pro_opportunities;
create policy "pro opportunities owner read" on public.pro_opportunities
  for select using ((select auth.uid()) = owner_id);

comment on table public.pro_connections is '0226: a professional relationship both people confirm, each naming its role. Written by the server only.';
comment on table public.pro_recommendations is '0226: recommendations, testimonials, client reviews, references and mentor reviews. Shown only after the subject approves.';
comment on table public.skill_endorsements is '0226: one person vouching for one listed skill of another. Only confirmed connections and friends.';
comment on table public.pro_opportunities is '0226: open positions, internships, freelance, volunteer, partnership, research and creator roles.';

-- Three in-app notification types for the network. The full list is restated
-- (0187 is the last one to set it), plus the three new ones at the end.
alter table public.notifications drop constraint if exists notifications_type_chk;
alter table public.notifications add constraint notifications_type_chk check (
  type in (
    'follow','like','love','comment','reply','mention','tag','quote','repost',
    'share','save','profile_view','invite','milestone','repost_engagement',
    'comment_reaction','repost_discovery','reshare',
    'wallpaper_like','wallpaper_save','wallpaper_download',
    'message','message_reaction','message_mention',
    'friend_request','friend_accepted','friend_reminder',
    'download_complete','download_failed','download_ready','processing_finished',
    'community_invite','community_accepted','community_announcement','community_event',
    'news_breaking','news_trending','news_following','news_recommended',
    'subscription_activated','payment_successful','renewal_reminder','premium_expiring',
    'ai_deposit_successful','ai_deposit_failed',
    'security_login','security_new_device','security_password','security_2fa',
    'security_suspicious','security_recovery',
    'security_2fa_disabled','security_recovery_used',
    'security_passkey_enrolled','security_passkey_removed',
    'streak_reminder','streak_milestone','streak_lost',
    'system','admin_broadcast',
    'post_under_review','moderation_appeal_resolved',
    -- 0187: rewards and withdrawals
    'reward_earned','referral_reward','withdrawal_update',
    -- 0226: the Professional Network (in-app only)
    'pro_request','pro_accepted','pro_recommendation'
  )
);

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  begin
    alter table public.profile_details add constraint profile_details_open_to_chk check (open_to <@ array['work', 'hiring', 'freelance', 'partnerships', 'investors', 'mentoring', 'mentee', 'speaking']::text[]);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.profile_details add constraint profile_details_industry_len_chk check (industry is null or char_length(industry) between 1 and 60);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_connections add constraint pro_connections_roles_chk check (
      addressee_role in ('colleague', 'manager', 'report', 'employer', 'employee', 'recruiter', 'candidate', 'mentor', 'mentee', 'client', 'customer', 'freelancer', 'consultant', 'contractor', 'agency', 'vendor', 'supplier', 'investor', 'advisor', 'founder', 'partner', 'custom')
      and requester_role in ('colleague', 'manager', 'report', 'employer', 'employee', 'recruiter', 'candidate', 'mentor', 'mentee', 'client', 'customer', 'freelancer', 'consultant', 'contractor', 'agency', 'vendor', 'supplier', 'investor', 'advisor', 'founder', 'partner', 'custom'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_connections add constraint pro_connections_status_chk check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'ended'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_connections add constraint pro_connections_text_chk check (
      (custom_label is null or char_length(custom_label) between 1 and 40)
      and (context is null or char_length(context) between 1 and 80)
      and (note is null or char_length(note) between 1 and 300)
      and ((addressee_role = 'custom') = (custom_label is not null)));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_recommendations add constraint pro_recommendations_kind_chk check (kind in ('recommendation', 'testimonial', 'client_review', 'reference', 'mentor_review'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_recommendations add constraint pro_recommendations_status_chk check (status in ('pending', 'shown', 'hidden'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_recommendations add constraint pro_recommendations_body_chk check (char_length(body) between 20 and 1500);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.skill_endorsements add constraint skill_endorsements_skill_chk check (char_length(skill) between 1 and 40);
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_opportunities add constraint pro_opportunities_kind_chk check (kind in ('job', 'internship', 'freelance', 'volunteer', 'partnership', 'research', 'creator'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_opportunities add constraint pro_opportunities_status_chk check (status in ('open', 'closed'));
  exception when duplicate_object then null;
  end;
  begin
    alter table public.pro_opportunities add constraint pro_opportunities_text_chk check (
      char_length(title) between 3 and 80
      and (description is null or char_length(description) <= 1500)
      and (location is null or char_length(location) <= 80)
      and (link is null or (link like 'https://%' and char_length(link) <= 300)));
  exception when duplicate_object then null;
  end;
end;
$$;
