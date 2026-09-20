-- ═══════════════════════════════════════════════════════════════════════════
--  0159 — THE FRENZ AI BALANCE MOVES TO US DOLLARS (2026-09-20)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "the AI currency is still showing in naira — it should show in USD,
-- but when clicked the Paystack checkout should convert the price to naira.
-- It shouldn't show naira anywhere in the dashboard, nor in the deposit
-- shortcut amounts; the minimum in USD, and in the admin dashboard too."
--
-- One transaction, guarded so it runs ONCE (only while the stored wallet
-- currency is still NGN):
--
--   1. every NGN balance becomes its dollar value at the rate below, with two
--      statement lines per member so the move is visible and auditable — an
--      adjustment OUT in naira (balance after 0) and an adjustment IN in
--      dollars (balance after = the new figure). The unique
--      (user, product, kind, reference) index makes a re-run insert nothing.
--   2. the settings row: the wallet currency, every price (kobo → cents at the
--      same rate, rounded to the nearest cent, never below 1), the recharge
--      bounds and packages in dollars ($1 … $500; $5/$10/$25/$50/$100), the
--      Paystack checkout currency (NGN) with the manual fallback rate, and the
--      pricing version bumped with the superseded numbers kept in history.
--
-- The rate is the market rate on the day (open.er-api.com, 2026-09-20:
-- ₦1,335.694724 per $1). From here on checkouts use the LIVE rate
-- (lib/ai/character-replace/fx-rate-server.ts); this number only converts
-- what already existed.
--
-- Every ledger row keeps its own currency, so the member's statement reads
-- "₦500.00 added" for the past and "$5.00 added" from now on — the balance
-- page prints each line with its own symbol.

do $$
declare
  kobo_per_usd  numeric := 133569.4724;   -- ₦1,335.694724 × 100
  v_rate_note   text    := 'Balance moved to US dollars at ₦1,335.69 per $1';
  v_now         timestamptz := now();
  r             record;
  v_new         bigint;
  v_landing     jsonb;
  v_cr          jsonb;
  v_history     jsonb;
  v_version     int;
begin
  select value into v_landing from public.settings where key = 'landing' for update;
  if v_landing is null or coalesce(v_landing->>'frenzAiCurrency', 'NGN') <> 'NGN' then
    raise notice '0159: wallet is not NGN — nothing to do';
    return;
  end if;

  -- ── 1. balances and their statement lines ────────────────────────────────
  for r in select user_id, product, balance_cents from public.ai_product_balances where currency = 'NGN' loop
    v_new := round(r.balance_cents * 100.0 / kobo_per_usd);
    if r.balance_cents > 0 then
      insert into public.ai_product_ledger
        (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, created_at, updated_at)
      values
        (r.user_id, r.product, 'adjustment', 'settled', -r.balance_cents, 0, 'NGN', 'usd-switch-out:' || r.user_id::text,
         v_rate_note, jsonb_build_object('migration', '0159', 'koboPerUsd', kobo_per_usd, 'usdCents', v_new), v_now, v_now)
      on conflict do nothing;
      insert into public.ai_product_ledger
        (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference, note, metadata, created_at, updated_at)
      values
        (r.user_id, r.product, 'adjustment', 'settled', v_new, v_new, 'USD', 'usd-switch-in:' || r.user_id::text,
         v_rate_note, jsonb_build_object('migration', '0159', 'koboPerUsd', kobo_per_usd, 'fromKobo', r.balance_cents), v_now + interval '1 millisecond', v_now)
      on conflict do nothing;
    end if;
    update public.ai_product_balances
       set balance_cents = v_new, currency = 'USD', updated_at = v_now
     where user_id = r.user_id and product = r.product;
  end loop;

  -- ── 2. the settings row ──────────────────────────────────────────────────
  v_cr := coalesce(v_landing->'frenzAiCharacterReplace', '{}'::jsonb);
  v_version := coalesce((v_cr->>'pricingVersion')::int, 1);

  -- the superseded numbers, kept beside the new version (the same shape versionCharacterReplacePricing writes)
  v_history := coalesce(v_cr->'pricingHistory', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'version', v_version,
    'replacedAt', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'config', jsonb_build_object(
      'basePriceCents', v_cr->'basePriceCents',
      'pricePerSecondCents', v_cr->'pricePerSecondCents',
      'minimumChargeCents', v_cr->'minimumChargeCents',
      'qualities', v_cr->'qualities',
      'lipSyncEnabled', v_cr->'lipSyncEnabled',
      'lipSync', v_cr->'lipSync',
      'voice', v_cr->'voice',
      'modes', v_cr->'modes',
      'tts', v_cr->'tts',
      'currency', 'NGN'
    ),
    'changedBy', null,
    'reason', v_rate_note || ' (migration 0159)'
  ));

  -- kobo → cents at the rate, to the nearest cent, never below one
  v_cr := jsonb_set(v_cr, '{pricePerSecondCents}', to_jsonb(greatest(1, round(coalesce((v_cr->>'pricePerSecondCents')::numeric, 0) * 100 / kobo_per_usd))));
  v_cr := jsonb_set(v_cr, '{basePriceCents}', to_jsonb(round(coalesce((v_cr->>'basePriceCents')::numeric, 0) * 100 / kobo_per_usd)));
  v_cr := jsonb_set(v_cr, '{minimumChargeCents}', to_jsonb(greatest(1, round(coalesce((v_cr->>'minimumChargeCents')::numeric, 0) * 100 / kobo_per_usd))));

  if jsonb_typeof(v_cr->'qualities') = 'array' then
    v_cr := jsonb_set(v_cr, '{qualities}', (
      select coalesce(jsonb_agg(
        case when jsonb_typeof(q->'perSecondCents') = 'number'
             then jsonb_set(q, '{perSecondCents}', to_jsonb(greatest(1, round((q->>'perSecondCents')::numeric * 100 / kobo_per_usd))))
             else q end), '[]'::jsonb)
      from jsonb_array_elements(v_cr->'qualities') q));
  end if;
  if jsonb_typeof(v_cr->'lipSync') = 'array' then
    v_cr := jsonb_set(v_cr, '{lipSync}', (
      select coalesce(jsonb_agg(
        case when jsonb_typeof(l->'perSecondCents') = 'number'
             then jsonb_set(l, '{perSecondCents}', to_jsonb(greatest(1, round((l->>'perSecondCents')::numeric * 100 / kobo_per_usd))))
             else l end), '[]'::jsonb)
      from jsonb_array_elements(v_cr->'lipSync') l));
  end if;
  if jsonb_typeof(v_cr->'voice'->'surchargePerSecondCents') = 'number' then
    v_cr := jsonb_set(v_cr, '{voice,surchargePerSecondCents}', to_jsonb(round((v_cr->'voice'->>'surchargePerSecondCents')::numeric * 100 / kobo_per_usd)));
  end if;
  if jsonb_typeof(v_cr->'tts'->'perRequestCents') = 'number' then
    v_cr := jsonb_set(v_cr, '{tts,perRequestCents}', to_jsonb(round((v_cr->'tts'->>'perRequestCents')::numeric * 100 / kobo_per_usd)));
  end if;
  if jsonb_typeof(v_cr->'tts'->'perCharacterCents') = 'number' then
    v_cr := jsonb_set(v_cr, '{tts,perCharacterCents}', to_jsonb(round((v_cr->'tts'->>'perCharacterCents')::numeric * 100 / kobo_per_usd)));
  end if;
  if jsonb_typeof(v_cr->'tts'->'voiceChange'->'perSecondCents') = 'number' then
    v_cr := jsonb_set(v_cr, '{tts,voiceChange,perSecondCents}', to_jsonb(round((v_cr->'tts'->'voiceChange'->>'perSecondCents')::numeric * 100 / kobo_per_usd)));
  end if;
  for r in select m from unnest(array['face_only', 'skin_face']) as m loop
    if jsonb_typeof(v_cr->'modes'->r.m->'tiers') = 'array' then
      v_cr := jsonb_set(v_cr, array['modes', r.m, 'tiers'], (
        select coalesce(jsonb_agg(
          case when jsonb_typeof(t->'perSecondCents') = 'number'
               then jsonb_set(t, '{perSecondCents}', to_jsonb(greatest(1, round((t->>'perSecondCents')::numeric * 100 / kobo_per_usd))))
               else t end), '[]'::jsonb)
        from jsonb_array_elements(v_cr->'modes'->r.m->'tiers') t));
    end if;
  end loop;

  -- the recharge experience, in dollars: $1 … $500, and the five shortcuts the owner named
  v_cr := jsonb_set(v_cr, '{recharge}', coalesce(v_cr->'recharge', '{}'::jsonb) || jsonb_build_object(
    'minCents', 100,
    'maxCents', 50000,
    'packages', jsonb_build_array(
      jsonb_build_object('amountCents', 500,   'enabled', true, 'order', 0),
      jsonb_build_object('amountCents', 1000,  'enabled', true, 'order', 1),
      jsonb_build_object('amountCents', 2500,  'enabled', true, 'order', 2),
      jsonb_build_object('amountCents', 5000,  'enabled', true, 'order', 3),
      jsonb_build_object('amountCents', 10000, 'enabled', true, 'order', 4)
    ),
    'checkoutCurrency', 'NGN',
    'fxMarkupPercent', 0
  ));
  -- the manual fallback for the checkout rate (the live rate is the rule)
  v_cr := jsonb_set(v_cr, '{localMinorUnitsPerUsd}', to_jsonb(round(kobo_per_usd)));
  v_cr := jsonb_set(v_cr, '{pricingVersion}', to_jsonb(v_version + 1));
  v_cr := jsonb_set(v_cr, '{pricingUpdatedAt}', to_jsonb(to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  v_cr := jsonb_set(v_cr, '{pricingHistory}', v_history);

  v_landing := v_landing || jsonb_build_object(
    'frenzAiCurrency', 'USD',
    -- the AI Clean price and its minimum top-up share the wallet currency
    'frenzAiVideoPriceCents', greatest(1, round(coalesce((v_landing->>'frenzAiVideoPriceCents')::numeric, 0) * 100 / kobo_per_usd)),
    'frenzAiMinTopupCents', 200,
    'frenzAiCharacterReplace', v_cr
  );
  update public.settings set value = v_landing where key = 'landing';
  raise notice '0159: wallet moved to USD at % kobo per $1', kobo_per_usd;
end $$;
