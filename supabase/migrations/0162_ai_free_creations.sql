-- ═══════════════════════════════════════════════════════════════════════════
--  0162 — COMPLIMENTARY CREATIONS + DEVICE ASSOCIATIONS (Character Replace Part 11)
-- ═══════════════════════════════════════════════════════════════════════════
-- Owner, 2026-09-20: "Every eligible new account gets 2 complimentary Character
-- Replace creations — lifetime, per account, consumed permanently, never
-- refilled, never converted to balance. After both, every video is paid."
--
-- Three tables and five functions, all service-role only (the 0154 rule:
-- a SECURITY DEFINER with a p_user_id argument is "anyone spends anyone's"
-- until revoked). The rechargeable wallet (0154/0155/0159) is untouched:
-- a complimentary creation is an ENTITLEMENT, not money, and it never
-- writes ai_product_ledger.
--
--   ai_free_entitlements   one row per member per product: granted / used /
--                          restored, the eligibility verdict, the device it
--                          was granted on. remaining = granted − used.
--   ai_free_uses           the audit of every use: which job, the use number,
--                          the NORMAL price that was not charged, the pricing
--                          snapshot, consumed / settled / restored. UNIQUE on
--                          job_id — one free use per job, ever.
--   ai_device_associations a pseudonymous device id (an HMAC of a server-set
--                          cookie) ↔ account, first/last seen, whether the
--                          free grant went to this pairing, a coarse network
--                          hash for the secondary signal, a risk state. No raw
--                          fingerprint, no IP.
--
--   grant_free_entitlement   idempotent per member; decides eligibility under
--                            an advisory lock on the device hash so two
--                            accounts racing on one device cannot both win
--   consume_free_use         atomic: row lock, one use per job, refuses when
--                            exhausted, writes the audit row with the snapshot
--   restore_free_use         at most once per job (consumed → restored)
--   settle_free_use          consumed → settled (the creation was delivered)
--   claim_ai_job_start       0158's claim, now with p_funding ('balance' | 'free')
--
-- Split across three files after the first push did not land (2026-09-20):
--   0162  the tables, indexes, RLS, comments        (plain DDL only)
--   0163  the five functions                        (dollar-quoted bodies only)
--   0164  the revokes + the drop of the old overload (one `do $$ … execute` block)
-- Each migration file is its own transaction on the runner; one small file
-- per kind of statement makes a failure name itself.

create table if not exists public.ai_free_entitlements (
  user_id       uuid not null references auth.users (id) on delete cascade,
  product       text not null default 'character_replace',
  granted       integer not null default 0,
  used          integer not null default 0,
  restored      integer not null default 0,
  eligibility   text not null default 'eligible',
  device_hash   text,
  network_hash  text,
  granted_at    timestamptz,
  consumed_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (user_id, product),
  constraint ai_free_entitlements_product_chk check (product in ('character_replace')),
  constraint ai_free_entitlements_counts_chk check (granted >= 0 and used >= 0 and used <= granted and restored >= 0),
  constraint ai_free_entitlements_elig_chk check (eligibility in ('eligible', 'device_limit', 'review', 'ineligible'))
);

create table if not exists public.ai_free_uses (
  id                 bigint generated always as identity primary key,
  user_id            uuid not null references auth.users (id) on delete cascade,
  product            text not null default 'character_replace',
  job_id             uuid not null references public.ai_jobs (id) on delete cascade,
  use_number         integer not null,
  status             text not null default 'consumed',
  mode               text,
  quality            text,
  duration_ms        integer,
  normal_price_cents bigint not null default 0,
  currency           text not null default 'USD',
  pricing_snapshot   jsonb,
  consumed_at        timestamptz not null default now(),
  settled_at         timestamptz,
  restored_at        timestamptz,
  constraint ai_free_uses_product_chk check (product in ('character_replace')),
  constraint ai_free_uses_status_chk check (status in ('consumed', 'settled', 'restored'))
);

create unique index if not exists ai_free_uses_job_uniq on public.ai_free_uses (job_id);
create index if not exists ai_free_uses_user_idx on public.ai_free_uses (user_id, product, consumed_at desc);

create table if not exists public.ai_device_associations (
  device_hash   text not null,
  user_id       uuid not null references auth.users (id) on delete cascade,
  network_hash  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  seen_count    integer not null default 1,
  free_granted  boolean not null default false,
  risk_state    text not null default 'normal',
  primary key (device_hash, user_id),
  constraint ai_device_associations_risk_chk check (risk_state in ('normal', 'limit_reached', 'review'))
);

create index if not exists ai_device_associations_user_idx on public.ai_device_associations (user_id);
create index if not exists ai_device_associations_network_idx on public.ai_device_associations (network_hash, first_seen_at desc) where network_hash is not null;

alter table public.ai_free_entitlements enable row level security;
alter table public.ai_free_uses enable row level security;
alter table public.ai_device_associations enable row level security;

comment on table public.ai_free_entitlements is 'Complimentary Character Replace creations per member (Part 11): granted/used/restored and the eligibility verdict. Service role only; the API answers the member.';
comment on table public.ai_free_uses is 'Every complimentary creation used: the job, the use number, the normal price that was NOT charged, the pricing snapshot, consumed/settled/restored.';
comment on table public.ai_device_associations is 'Pseudonymous device ↔ account pairings for the complimentary-creation limit. An HMAC of a server-set cookie and a coarse network hash — never a raw fingerprint or an IP.';
