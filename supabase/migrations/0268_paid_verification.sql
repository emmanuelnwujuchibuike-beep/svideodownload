-- ═══════════════════════════════════════════════════════════════════════════
--  0268 — paying for the blue tick (2026-10-23)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-22: "Make users able to pay for blue verification, and the
-- price can be set by admin." A second way to the tick beside the reviewed
-- application (0104): the member pays the admin's price through Paystack, the
-- charge is verified with Paystack on the server, and the tick is granted
-- through the same audited path an admin's direct issue uses (an approved
-- verification_request + a verification_events row). The price, the switch
-- and the validity period live in `settings` under 'paid_verification'.
--
-- One row per checkout. `status` moves initiated → paid exactly once (a
-- conditional update in lib/social/paid-verification.ts, so a webhook and the
-- return page can never both grant), or → failed. `expires_at` is null for a
-- lifetime tick; otherwise the daily sweep takes back a PAID tick whose period
-- ended without a renewal — never one granted by review or by an admin.
--
-- Server-only: RLS on, a member may read their own rows; every write is the
-- service role's.

create table if not exists public.verification_purchases (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  reference        text not null unique check (length(reference) between 10 and 100),
  price_cents      integer not null check (price_cents > 0),
  charged_currency text not null check (length(charged_currency) = 3),
  charged_minor    bigint not null check (charged_minor > 0),
  fx_minor_per_usd numeric,
  period_days      integer not null check (period_days between 0 and 3650),
  status           text not null default 'initiated',
  failure_source   text,
  checkout_url     text,
  provider_ref     text,
  paid_at          timestamptz,
  expires_at       timestamptz,
  expired_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint verification_purchases_status_chk check (status in ('initiated', 'paid', 'failed', 'refunded'))
);

create index if not exists verification_purchases_user_idx on public.verification_purchases (user_id, created_at desc);
create index if not exists verification_purchases_expiring_idx on public.verification_purchases (expires_at) where status = 'paid' and expired_at is null and expires_at is not null;

alter table public.verification_purchases enable row level security;

drop policy if exists "verification purchases own read" on public.verification_purchases;
create policy "verification purchases own read" on public.verification_purchases
  for select using (auth.uid() = user_id);
