-- Server-side reward sessions for HD/batch download unlocks.
--
-- WHY: the reward-ad "unlock" for HD/top-tier downloads and batch downloads was
-- entirely client-side and self-reported (features/monetization/rewarded-ad.tsx
-- calling onDownload() directly on a local timer/video clock), with zero
-- server-side record that a reward was ever claimed. app/api/download/route.ts
-- had no way to know a request was supposed to be reward-gated at all, so a
-- forged request for a top-tier formatId succeeded with no consequence, and
-- batch had no server-side identity beyond a client-minted UUID used only for
-- quota bookkeeping.
--
-- A reward session is always "an authorization for a specific list of
-- (url, formatId, kind) items" — HD is simply a list of one. Storing the exact
-- items server-side at /start time (validated against real extractor metadata)
-- and requiring an exact match at redemption is what makes it impossible to
-- earn a reward for one quality/batch and redeem it against another.
--
-- Shape mirrors the two closest existing precedents: webauthn_challenges
-- (0058_webauthn_credentials.sql) for the expires_at-scoped-token shape, and
-- mfa_recovery_codes (0057_mfa_recovery_codes.sql) for redemption tracking.
create table if not exists public.reward_sessions (
  id uuid primary key default gen_random_uuid(),
  -- Nullable: signed-out visitors get daily reward limits too, keyed by IP hash
  -- instead (see ip_hash below) — same identity model as the wallpaper allowance
  -- and guest-like routes.
  user_id uuid references auth.users(id) on delete cascade,
  -- sha256(client ip), never the raw address — same pattern as
  -- app/api/posts/[id]/guest-like/route.ts. Null when user_id is set.
  ip_hash text,
  type text not null check (type in ('hd', 'batch')),
  status text not null default 'pending' check (status in ('pending', 'granted', 'expired')),
  -- { items: [{ url, formatId, kind, title? }] } — validated against real
  -- extractor metadata at insert time (server/services/download-service.ts's
  -- own findFormat), so a redemption can only ever match what was actually
  -- offered, never a substituted resource or a different quality.
  payload jsonb not null,
  -- Which item indexes have been billed against the daily reward-claim limit.
  -- Re-fetching an already-consumed index within expires_at is still allowed
  -- (a network failure mid-download must not cost a second ad) — this array
  -- only prevents double-BILLING, not re-serving the same authorized bytes.
  consumed_indexes int[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  granted_at timestamptz
);

alter table public.reward_sessions enable row level security;
-- No public policies, deliberately — every read/write goes through an API
-- route using createAdminClient() (service role), same as webauthn_challenges.
-- A signed-in or anonymous visitor never queries this table directly.

create index if not exists reward_sessions_identity_idx
  on public.reward_sessions (coalesce(user_id::text, ip_hash), created_at desc);

comment on table public.reward_sessions is
  'Server-issued authorization for a reward-gated HD/batch download. See lib/monetization/reward-sessions.ts.';
