-- =====================================================================
-- 0090_ad_placements_v2.sql
-- Frenzsave · Ad placements, second pass: Google AdSense support, the new
-- placement zones, and the retirement of click-hijacking formats.
--
-- ── Why `pop` is being retired ────────────────────────────────────────
-- The 2026-07-20 audit found exactly one ad row in the whole table: an
-- Adsterra `pop` unit on `download_result_page`. Pop-under / OnClick /
-- Social Bar formats monetise by hijacking the visitor's first click,
-- which is what produced the reported "I click a button and it redirects
-- me to an ad site". On a product positioned on trust that is a bad
-- trade, and the owner's decision was to drop it in favour of `display`
-- and `native` units placed as part of the design.
--
-- The UPDATE below is the data half of that decision. The code half is a
-- serving filter that refuses any format outside the allowed set, so a
-- legacy row cannot be served even if this migration has not run yet —
-- the two are independent on purpose, because the migrations are applied
-- by hand and this should not wait for that.
--
-- Rows are DEACTIVATED, not deleted: the network id and script are the
-- only record of what was configured, and turning a row back on is a
-- click if this decision is ever revisited.
--
-- ── AdSense is a different shape from a script blob ───────────────────
-- Every existing network is "paste this script tag". AdSense is a
-- publisher id plus an ad-unit id, rendered into a specific `<ins>` tag
-- whose attributes matter. Stuffing that into `script_code` would work
-- and would lose the ability to validate it, so it gets real columns.
--
-- Idempotent; safe to re-run.
-- =====================================================================

-- ── AdSense fields ───────────────────────────────────────────────────
-- Nullable because only `format = 'adsense'` rows use them; the check
-- constraint below is what keeps them coherent rather than NOT NULL.
alter table public.ads add column if not exists ad_client text;   -- ca-pub-…
alter table public.ads add column if not exists ad_slot_id text;  -- ad unit id
alter table public.ads add column if not exists ad_layout text;   -- auto | fluid | rectangle | …

-- ── Skippable video / interstitial behaviour ─────────────────────────
-- The download-result and download-complete placements show something the
-- visitor is waiting through, so "can this be skipped, and after how
-- long" is a property of the PLACEMENT, not a hardcoded constant. The
-- reward placement is the deliberate exception — it is an exchange, and a
-- skippable reward ad is not one.
alter table public.ads add column if not exists skippable boolean not null default true;
alter table public.ads add column if not exists skip_after_seconds int not null default 5;

-- A row claiming to be AdSense with no publisher id renders an empty unit
-- that silently earns nothing — the failure mode is invisible, which is
-- exactly the kind this table has produced before.
alter table public.ads drop constraint if exists ads_adsense_needs_client;
alter table public.ads add constraint ads_adsense_needs_client
  check (format <> 'adsense' or (ad_client is not null and ad_slot_id is not null));

alter table public.ads drop constraint if exists ads_skip_after_sane;
alter table public.ads add constraint ads_skip_after_sane
  check (skip_after_seconds between 0 and 120);

-- ── Retire click-hijacking units ─────────────────────────────────────
-- Deactivated rather than deleted, and scoped to `format = 'pop'` only.
update public.ads set active = false where format = 'pop' and active;

comment on column public.ads.ad_client is
  'AdSense publisher id (ca-pub-…). Required when format = adsense.';
comment on column public.ads.skippable is
  'Whether the visitor may skip this unit. Ignored by the reward placement, which is an exchange.';
