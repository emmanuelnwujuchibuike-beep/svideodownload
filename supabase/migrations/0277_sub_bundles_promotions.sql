-- ═══════════════════════════════════════════════════════════════════════════
--  0277 — Exclusive bundles and promotions (Frenz Exclusive, bundles & promotions Part 2, 2026-10-24)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Everything stays PREPAID: a bundle is one sub_purchases row whose period_days is 90 / 180 / 365 and whose
-- price_cents is the bundle (or promotional) price. settle_sub_purchase (0247), the refund / dispute reversal
-- (0247 / 0254) and the earnings hold already work per row — they grant the row's own period_days and credit the
-- row's own price_cents — so none of them changes here. No recurring billing is added.
--
--   creator_membership_settings.bundle_prices  { "3": cents | null, "6": cents | null, "12": cents | null }
--                                              null or absent = that bundle is off. The monthly price stays in
--                                              sub_price_cents and is never copied here.
--   sub_promotions                             a creator's time-boxed offer: percent off or a fixed price, on chosen
--                                              durations, with an optional redemption limit and a pause switch.
--                                              Its status (scheduled / active / expired / paused) is computed from
--                                              the window and the switch at server time — no cron.
--   sub_purchases.months                       the commercial duration bought (1 / 3 / 6 / 12). period_days stays the
--                                              authoritative access length for settlement and refunds.
--   sub_purchases.promotion_id                 the promotion a purchase used. The price on the row is the snapshot:
--                                              it is never repriced, even if the promotion ends mid-payment.
--   begin_sub_purchase (15 arguments)          0276's pair lock and open-checkout check, plus — when a promotion is
--                                              named — a per-promotion advisory lock, the promotion's eligibility at
--                                              now(), and its redemption limit counted from LIVE purchase rows (paid
--                                              or refund_due, plus initiated rows under 30 minutes). An abandoned
--                                              checkout stops counting after 30 minutes on its own; there is no
--                                              stored counter to drift. 0276's 13-argument function is kept as it is
--                                              for an app that has not been updated yet.
--
-- Depends on 0227 (tables), 0247, 0276. Run by hand AFTER 0276. Safe to run twice. Until it runs the app keeps
-- selling the monthly subscription exactly as before (bundles and promotions answer "arrives with the next update").

-- ── bundle prices ───────────────────────────────────────────────────────────
create or replace function public.sub_bundle_prices_valid(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
        where e.key not in ('3', '6', '12')
           or not (jsonb_typeof(e.value) = 'null'
                   or (jsonb_typeof(e.value) = 'number' and (e.value #>> '{}')::numeric = trunc((e.value #>> '{}')::numeric)
                       and (e.value #>> '{}')::numeric between 1 and 100000000))
     );
$$;

alter table public.creator_membership_settings add column if not exists bundle_prices jsonb not null default '{}'::jsonb;
alter table public.creator_membership_settings drop constraint if exists creator_membership_settings_bundle_prices_chk;
alter table public.creator_membership_settings add constraint creator_membership_settings_bundle_prices_chk check (public.sub_bundle_prices_valid(bundle_prices));

-- ── promotions ──────────────────────────────────────────────────────────────
create table if not exists public.sub_promotions (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references auth.users (id) on delete cascade,
  name              text not null,
  description       text,
  kind              text not null,
  percent_off       smallint,
  fixed_price_cents integer,
  durations         smallint[] not null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  max_redemptions   integer,
  paused            boolean not null default false,
  -- who paused it: an admin's pause (moderation) is not lifted by the creator
  paused_by         text,
  paused_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint sub_promotions_name_chk check (char_length(btrim(name)) between 1 and 60),
  constraint sub_promotions_description_chk check (description is null or char_length(description) <= 200),
  constraint sub_promotions_kind_chk check (
    (kind = 'percent' and percent_off between 1 and 90 and fixed_price_cents is null)
    or (kind = 'fixed' and fixed_price_cents between 1 and 100000000 and percent_off is null)
  ),
  constraint sub_promotions_durations_chk check (cardinality(durations) between 1 and 4 and durations <@ array[1, 3, 6, 12]::smallint[]),
  constraint sub_promotions_window_chk check (ends_at > starts_at),
  constraint sub_promotions_limit_chk check (max_redemptions is null or max_redemptions between 1 and 1000000),
  constraint sub_promotions_paused_by_chk check (paused_by is null or paused_by in ('creator', 'admin'))
);
create index if not exists sub_promotions_creator_idx on public.sub_promotions (creator_id, created_at desc);

alter table public.sub_promotions enable row level security;
-- the creator reads their own; every write and every public read goes through the server (service role), which checks
-- the session and prices everything itself — no insert / update / delete policy exists for a signed-in member
drop policy if exists "sub promotions owner read" on public.sub_promotions;
create policy "sub promotions owner read" on public.sub_promotions
  for select using ((select auth.uid()) = creator_id);

-- ── purchases record the duration and the promotion ─────────────────────────
alter table public.sub_purchases add column if not exists months smallint not null default 1;
alter table public.sub_purchases drop constraint if exists sub_purchases_months_chk;
alter table public.sub_purchases add constraint sub_purchases_months_chk check (months in (1, 3, 6, 12));
alter table public.sub_purchases add column if not exists promotion_id uuid references public.sub_promotions (id);
-- the redemption count: one promotion's live rows
create index if not exists sub_purchases_promotion_idx on public.sub_purchases (promotion_id, status, created_at) where promotion_id is not null;

-- ── begin_sub_purchase with a duration and a promotion ──────────────────────
create or replace function public.begin_sub_purchase(
  p_subscriber uuid,
  p_creator uuid,
  p_reference text,
  p_provider text,
  p_price_cents integer,
  p_fee_cents integer,
  p_total_cents integer,
  p_fee_bp integer,
  p_charged_currency text,
  p_charged_minor bigint,
  p_fx_minor_per_usd bigint,
  p_period_days integer,
  p_hold_days integer,
  p_months smallint,
  p_promotion uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open record;
  v_promo record;
  v_live integer;
  v_id uuid;
begin
  if p_months is null or p_months not in (1, 3, 6, 12) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_duration');
  end if;
  -- 0276's pair lock: a parallel call for the same pair waits here, then sees this one's row
  perform pg_advisory_xact_lock(hashtextextended('frenz:sub_purchase:' || p_subscriber::text || ':' || p_creator::text, 0));
  -- an open checkout for the SAME option (duration, promotion, price) is handed back; a different option the member
  -- deliberately chose opens its own checkout
  select reference, checkout_url into v_open
    from public.sub_purchases
   where subscriber_id = p_subscriber and creator_id = p_creator and status = 'initiated' and created_at > now() - interval '30 minutes'
     and months = p_months and promotion_id is not distinct from p_promotion and price_cents = p_price_cents
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'open', 'reference', v_open.reference, 'checkout_url', v_open.checkout_url);
  end if;

  if p_promotion is not null then
    -- every checkout of ONE promotion queues here: the count below and the insert are one step
    perform pg_advisory_xact_lock(hashtextextended('frenz:sub_promotion:' || p_promotion::text, 0));
    select id, creator_id, durations, starts_at, ends_at, paused, max_redemptions into v_promo
      from public.sub_promotions where id = p_promotion;
    if not found or v_promo.creator_id <> p_creator then
      return jsonb_build_object('ok', false, 'reason', 'promotion_unavailable');
    end if;
    if v_promo.paused or now() < v_promo.starts_at or now() >= v_promo.ends_at or not (p_months = any (v_promo.durations)) then
      return jsonb_build_object('ok', false, 'reason', 'promotion_unavailable');
    end if;
    if v_promo.max_redemptions is not null then
      select count(*)::int into v_live
        from public.sub_purchases
       where promotion_id = p_promotion
         and (status in ('paid', 'refund_due') or (status = 'initiated' and created_at > now() - interval '30 minutes'));
      if v_live >= v_promo.max_redemptions then
        return jsonb_build_object('ok', false, 'reason', 'promotion_exhausted');
      end if;
    end if;
  end if;

  insert into public.sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, fx_minor_per_usd, reference, provider, period_days, hold_days, months, promotion_id)
  values (p_creator, p_subscriber, p_price_cents, p_fee_cents, p_total_cents, p_fee_bp, p_charged_currency, p_charged_minor, p_fx_minor_per_usd, p_reference, p_provider, p_period_days, p_hold_days, p_months, p_promotion)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- server only (the admin client): never callable by a signed-in member or anonymously
revoke all on function public.begin_sub_purchase(uuid, uuid, text, text, integer, integer, integer, integer, text, bigint, bigint, integer, integer, smallint, uuid) from public, anon, authenticated;
grant execute on function public.begin_sub_purchase(uuid, uuid, text, text, integer, integer, integer, integer, text, bigint, bigint, integer, integer, smallint, uuid) to service_role;
