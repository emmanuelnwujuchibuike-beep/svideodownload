-- 0276 — one open checkout at a time: SUB per (subscriber, creator), paid verification per member (Part 4 closure, 2026-10-24)
--
-- The app resolves an open or held purchase BEFORE opening a checkout (reuse a link under 30 minutes; a held Paystack
-- or Flutterwave purchase is asked about by its reference first). Two requests arriving together could both pass that
-- read before either inserted its row, and both open a provider checkout. These functions make the check and the
-- insert ONE step: a transaction-scoped advisory lock on the pair (or the member) serialises them, and an `initiated`
-- purchase created in the last 30 minutes — the app's own reuse window — answers `open` instead of inserting. The
-- loser is handed the winner's reference and link (when it has one); it never opens a checkout of its own.
--
-- Why a lock and not a unique index: purchases are history (one row per attempt, kept forever), and an `initiated` row
-- can legitimately stay `initiated` long after its link was handed out (a bank transfer finishing later; no sweep closes
-- link-less rows). A partial unique index on status = 'initiated' would fail to build on existing data, or block a
-- legitimate later purchase until someone closed old rows by hand. The lock needs no cleanup and touches no row.
--
-- Older `initiated` rows are deliberately NOT considered here: the app has already reused (link) or resolved/held
-- (no link) them before calling. Nothing else changes: settlement (settle_sub_purchase, the verification grant), the
-- webhooks, statuses and constraints are as they were.
--
-- Depends on 0227 (sub_purchases), 0247 (failure_source), 0268 (verification_purchases), 0271 (verification_purchases.provider).
-- Run by hand AFTER 0271. Safe to run twice (create or replace; grants re-applied). Until it runs, the app falls back to
-- the plain insert it used before (no simultaneous-request protection).

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
  p_hold_days integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open record;
  v_id uuid;
begin
  -- held until this transaction ends: a parallel call for the same pair waits here, then sees this one's row
  perform pg_advisory_xact_lock(hashtextextended('frenz:sub_purchase:' || p_subscriber::text || ':' || p_creator::text, 0));
  select reference, checkout_url into v_open
    from public.sub_purchases
   where subscriber_id = p_subscriber and creator_id = p_creator and status = 'initiated' and created_at > now() - interval '30 minutes'
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'open', 'reference', v_open.reference, 'checkout_url', v_open.checkout_url);
  end if;
  insert into public.sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, fx_minor_per_usd, reference, provider, period_days, hold_days)
  values (p_creator, p_subscriber, p_price_cents, p_fee_cents, p_total_cents, p_fee_bp, p_charged_currency, p_charged_minor, p_fx_minor_per_usd, p_reference, p_provider, p_period_days, p_hold_days)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

create or replace function public.begin_verification_purchase(
  p_user uuid,
  p_reference text,
  p_provider text,
  p_price_cents integer,
  p_charged_currency text,
  p_charged_minor bigint,
  p_fx_minor_per_usd numeric,
  p_period_days integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_open record;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('frenz:verification_purchase:' || p_user::text, 0));
  select reference, checkout_url into v_open
    from public.verification_purchases
   where user_id = p_user and status = 'initiated' and created_at > now() - interval '30 minutes'
   order by created_at desc
   limit 1;
  if found then
    return jsonb_build_object('ok', false, 'reason', 'open', 'reference', v_open.reference, 'checkout_url', v_open.checkout_url);
  end if;
  insert into public.verification_purchases (user_id, reference, provider, price_cents, charged_currency, charged_minor, fx_minor_per_usd, period_days)
  values (p_user, p_reference, p_provider, p_price_cents, p_charged_currency, p_charged_minor, p_fx_minor_per_usd, p_period_days)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- server only (the admin client): never callable by a signed-in member or anonymously
revoke all on function public.begin_sub_purchase(uuid, uuid, text, text, integer, integer, integer, integer, text, bigint, bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.begin_sub_purchase(uuid, uuid, text, text, integer, integer, integer, integer, text, bigint, bigint, integer, integer) to service_role;
revoke all on function public.begin_verification_purchase(uuid, text, text, integer, text, bigint, numeric, integer) from public, anon, authenticated;
grant execute on function public.begin_verification_purchase(uuid, text, text, integer, text, bigint, numeric, integer) to service_role;
