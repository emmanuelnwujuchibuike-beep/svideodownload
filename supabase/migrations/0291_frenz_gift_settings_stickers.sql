-- ═══════════════════════════════════════════════════════════════════════════
--  0291 — Frenz Gift Coin: persistent conversion settings and the sticker catalogue (Frenz Gift Coin Part 3, 2026-10-27)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── 1 · The landing settings row can no longer lose a section ────────────────
--   save_landing_settings(value)   the ONE writer of the landing row for setLandingSettings. It stores
--                                  stored || (value - 'frenzGift'): every key the app sends replaces its stored value,
--                                  every key it does not know (and frenzGift, always) is kept as stored. Atomic, in
--                                  one statement, so a save of an unrelated panel can never erase or roll back the
--                                  gift settings, even when two administrators save at the same moment.
--
-- ── 2 · The gift conversion settings (landing.frenzGift.conversion) ──────────
--   save_frenz_gift_conversion     the ONLY writer of frenzGift.conversion. Locks the settings row, refuses a stale
--                                  expected version, builds { version, fcToFgc, fgcToFc } from exactly the seven fields
--                                  of each leg (nothing else is stored), and:
--                                    unchanged legs            -> answered unchanged, version NOT bumped, nothing written
--                                    invalid / arbitrage-prone -> refused with the reason, nothing stored, the refusal
--                                                                 audited
--                                    a real change             -> stored with version + 1, updatedAt, updatedBy, and
--                                                                 audited in financial_audit_log AND config_audit_log in
--                                                                 the same transaction (before, after, version, the
--                                                                 validation outcome).
--                                  Unconfigured stays unconfigured: nothing is ever filled in.
--   fgc_conversion_rules_check     0290's check restated word for word, plus one rule: the SMALLEST allowed conversion
--                                  of each leg must leave at least 1 unit after fees (net is non-decreasing in the
--                                  amount, so then every allowed amount does). lib/gift/conversion-rules.ts says the
--                                  same (lib/gift/conversion-sql.server.test.ts compares them).
--
-- ── 3 · The sticker catalogue ────────────────────────────────────────────────
--   gift_stickers                  one row per sticker: slug (fixed once made), name, description, rarity, price in FGC
--                                  minor units, artwork (a static image, and optionally an animated one for the stage,
--                                  bubble and reveal), gallery category, featured, published, display order, archived_at,
--                                  revision. Fields follow design/sticker-gifts.html (rarity tags, category chips, the
--                                  featured banner, a static frame in the grid).
--   gift_sticker_revisions         every state a sticker has had, append-only. A gift (Part 4) records the sticker id
--                                  AND the revision it was bought at, so editing, re-pricing, unpublishing or archiving
--                                  a sticker never rewrites what a completed gift was.
--   admin_save_gift_sticker        the ONLY writer of both tables: validates every field (the price above all), refuses
--                                  a stale revision, publishes only with artwork and never while archived, writes the
--                                  revision and the audit rows in the same transaction.
--   gift_sticker_offer             what Part 4 may sell: a published, not archived sticker at its current revision, or
--                                  'not_available'.
--   A sticker is never deleted (trigger): "remove from the gallery" is archive (unpublished, kept with its history).
--
-- Depends on 0001 (settings), 0093 (config_audit_log), 0227 (financial_audit_log), 0278 (financial_append_only_guard),
-- 0290 (fgc_conversion_quote). Run by hand AFTER 0290. Safe to run twice.
-- No semicolon inside any quoted string or comment. Every dollar-quoted block is at the end.

-- ── the sticker catalogue ───────────────────────────────────────────────────
create table if not exists public.gift_stickers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null,
  name         text not null,
  description  text,
  rarity       text not null default 'common',
  price_fgc    bigint not null,
  image_url    text,
  animation_url text,
  category     text,
  featured     boolean not null default false,
  published    boolean not null default false,
  sort_order   integer not null default 0,
  archived_at  timestamptz,
  revision     integer not null default 1,
  created_by   uuid,
  updated_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint gift_stickers_slug_chk check (slug ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  constraint gift_stickers_name_chk check (char_length(btrim(name)) between 1 and 40),
  constraint gift_stickers_description_chk check (description is null or char_length(description) <= 200),
  constraint gift_stickers_rarity_chk check (rarity in ('common', 'rare', 'epic', 'legendary')),
  constraint gift_stickers_price_chk check (price_fgc between 1 and 99999999999),
  constraint gift_stickers_image_chk check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ '^https://[^[:space:]"<>]+$')),
  constraint gift_stickers_animation_chk check (animation_url is null or (char_length(animation_url) <= 2048 and animation_url ~ '^https://[^[:space:]"<>]+$')),
  constraint gift_stickers_category_chk check (category is null or category ~ '^[a-z0-9][a-z0-9-]{0,23}$'),
  constraint gift_stickers_sort_chk check (sort_order between 0 and 100000),
  constraint gift_stickers_revision_chk check (revision >= 1),
  -- only a sticker with artwork, and never an archived one, can be on sale
  constraint gift_stickers_publish_chk check (not published or (image_url is not null and archived_at is null))
);
create unique index if not exists gift_stickers_slug_uidx on public.gift_stickers (slug);
create index if not exists gift_stickers_gallery_idx on public.gift_stickers (sort_order, created_at) where published and archived_at is null;
alter table public.gift_stickers enable row level security;
revoke all on public.gift_stickers from public, anon, authenticated;
grant all on public.gift_stickers to service_role;
comment on table public.gift_stickers is 'Frenz Gift Coin stickers (0291): the catalogue, priced in FGC minor units. Written only by admin_save_gift_sticker. Never deleted (archived instead). Service role only.';

create table if not exists public.gift_sticker_revisions (
  id           bigint generated always as identity primary key,
  sticker_id   uuid not null references public.gift_stickers (id),
  revision     integer not null,
  slug         text not null,
  name         text not null,
  description  text,
  rarity       text not null,
  price_fgc    bigint not null,
  image_url    text,
  animation_url text,
  category     text,
  featured     boolean not null,
  published    boolean not null,
  sort_order   integer not null,
  archived_at  timestamptz,
  changed      text[] not null,
  changed_by   uuid,
  created_at   timestamptz not null default now(),
  constraint gift_sticker_revisions_price_chk check (price_fgc between 1 and 99999999999)
);
create unique index if not exists gift_sticker_revisions_uidx on public.gift_sticker_revisions (sticker_id, revision);
alter table public.gift_sticker_revisions enable row level security;
revoke all on public.gift_sticker_revisions from public, anon, authenticated;
grant all on public.gift_sticker_revisions to service_role;
comment on table public.gift_sticker_revisions is 'Frenz Gift Coin sticker history (0291): every state of every sticker, append-only. A gift records the revision it was bought at.';

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

-- 0290's check, restated word for word, plus the smallest-conversion rule (marked 0291).
create or replace function public.fgc_conversion_rules_check(p_rules jsonb) returns text
language plpgsql immutable as $$
declare
  leg   text;
  k     text;
  v     jsonb;
  l     jsonb;
  pat   text;
  a     numeric;
  b     numeric;
  c     numeric;
  d     numeric;
  kn    numeric;
  kd    numeric;
begin
  if p_rules is null or jsonb_typeof(p_rules) = 'null' then return 'config_missing'; end if;
  if jsonb_typeof(p_rules) <> 'object' then return 'config_invalid:shape'; end if;
  if coalesce(jsonb_typeof(p_rules -> 'version'), '') <> 'number' or (p_rules ->> 'version') !~ '^[1-9][0-9]{0,14}$' then return 'config_invalid:version'; end if;
  foreach leg in array array['fcToFgc', 'fgcToFc'] loop
    l := p_rules -> leg;
    if l is null or jsonb_typeof(l) <> 'object' then return 'config_invalid:' || leg; end if;
    foreach k in array array['rateNum', 'rateDen', 'feeBp', 'feeFlat', 'minIn', 'maxIn', 'dailyMaxIn'] loop
      v := l -> k;
      pat := case k when 'rateNum' then '^[1-9][0-9]{0,8}$' when 'rateDen' then '^[1-9][0-9]{0,8}$' when 'feeBp' then '^[0-9]{1,4}$'
                    when 'feeFlat' then '^[0-9]{1,9}$' when 'dailyMaxIn' then '^[1-9][0-9]{0,11}$' else '^[1-9][0-9]{0,10}$' end;
      if v is null or jsonb_typeof(v) <> 'number' or (v #>> '{}') !~ pat then return 'config_invalid:' || leg || '.' || k; end if;
    end loop;
    if (l ->> 'feeBp')::int > 5000 then return 'config_invalid:' || leg || '.feeBp'; end if;
    if (l ->> 'maxIn')::bigint < (l ->> 'minIn')::bigint then return 'config_invalid:' || leg || '.maxIn'; end if;
    if (l ->> 'dailyMaxIn')::bigint < (l ->> 'minIn')::bigint then return 'config_invalid:' || leg || '.dailyMaxIn'; end if;
    -- the largest allowed input must give an output that stays an exact integer in JavaScript (2^53 - 1)
    if div((l ->> 'maxIn')::numeric * (l ->> 'rateNum')::numeric, (l ->> 'rateDen')::numeric) > 9007199254740991 then return 'config_invalid:' || leg || '.range'; end if;
    -- 0291: the smallest allowed conversion must leave something after the fee
    if (public.fgc_conversion_quote((l ->> 'minIn')::bigint, l) ->> 'net')::bigint < 1 then return 'config_invalid:' || leg || '.minNet'; end if;
  end loop;
  -- arbitrage: K = a c (10000 - bp1)(10000 - bp2) / (b d 10^8), refused when K > 1, or K = 1 with no flat fee
  a := (p_rules #>> '{fcToFgc,rateNum}')::numeric;
  b := (p_rules #>> '{fcToFgc,rateDen}')::numeric;
  c := (p_rules #>> '{fgcToFc,rateNum}')::numeric;
  d := (p_rules #>> '{fgcToFc,rateDen}')::numeric;
  kn := a * c * (10000 - (p_rules #>> '{fcToFgc,feeBp}')::numeric) * (10000 - (p_rules #>> '{fgcToFc,feeBp}')::numeric);
  kd := b * d * 100000000;
  if kn > kd then return 'config_arbitrage'; end if;
  if kn = kd and (p_rules #>> '{fcToFgc,feeFlat}')::numeric = 0 and (p_rules #>> '{fgcToFc,feeFlat}')::numeric = 0 then return 'config_arbitrage'; end if;
  return null;
end;
$$;

-- The landing row's writer: what the app sends replaces its keys, everything else stored (frenzGift above all) stays.
create or replace function public.save_landing_settings(p_value jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then raise exception 'save_landing_settings: an object is required (0291)'; end if;
  insert into public.settings (key, value) values ('landing', p_value - 'frenzGift')
  on conflict (key) do update set value = (case when jsonb_typeof(public.settings.value) = 'object' then public.settings.value else '{}'::jsonb end) || (excluded.value - 'frenzGift');
end;
$$;

-- The gift conversion settings' only writer. See the header.
create or replace function public.save_frenz_gift_conversion(p_admin uuid, p_legs jsonb, p_expected_version bigint, p_validation jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_value jsonb;
  v_gift  jsonb;
  v_cur   jsonb;
  v_ver   bigint := 0;
  v_new   jsonb;
  v_err   text;
  v_leg   text;
  v_legs  jsonb := '{}'::jsonb;
  v_l     jsonb;
  v_at    timestamptz := now();
begin
  if p_admin is null or p_legs is null or jsonb_typeof(p_legs) <> 'object' or p_expected_version is null or p_expected_version < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  insert into public.settings (key, value) values ('landing', '{}'::jsonb) on conflict (key) do nothing;
  select value into v_value from public.settings where key = 'landing' for update;
  v_gift := case when jsonb_typeof(v_value -> 'frenzGift') = 'object' then v_value -> 'frenzGift' else '{}'::jsonb end;
  v_cur := case when jsonb_typeof(v_gift -> 'conversion') = 'object' then v_gift -> 'conversion' end;
  if v_cur is not null and (v_cur ->> 'version') ~ '^[0-9]{1,15}$' then v_ver := (v_cur ->> 'version')::bigint; end if;
  if p_expected_version <> v_ver then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_conversion_config_rejected', 'settings', 'frenzGift', 'frenz-gift-config', jsonb_build_object('reason', 'stale', 'expected_version', p_expected_version, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'stale', 'version', v_ver);
  end if;
  -- exactly the seven fields of each leg: nothing else the caller sent is stored
  foreach v_leg in array array['fcToFgc', 'fgcToFc'] loop
    v_l := p_legs -> v_leg;
    if v_l is null or jsonb_typeof(v_l) <> 'object' then v_legs := v_legs || jsonb_build_object(v_leg, v_l);
    else
      v_legs := v_legs || jsonb_build_object(v_leg, jsonb_build_object('rateNum', v_l -> 'rateNum', 'rateDen', v_l -> 'rateDen', 'feeBp', v_l -> 'feeBp', 'feeFlat', v_l -> 'feeFlat',
                                                                       'minIn', v_l -> 'minIn', 'maxIn', v_l -> 'maxIn', 'dailyMaxIn', v_l -> 'dailyMaxIn'));
    end if;
  end loop;
  if v_cur is not null and (v_cur - 'version') = v_legs then
    return jsonb_build_object('ok', true, 'unchanged', true, 'version', v_ver, 'conversion', v_cur);
  end if;
  v_new := jsonb_build_object('version', v_ver + 1) || v_legs;
  v_err := public.fgc_conversion_rules_check(v_new);
  if v_err is not null then
    insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
    values (p_admin, 'gift_conversion_config_rejected', 'settings', 'frenzGift', 'frenz-gift-config', jsonb_build_object('reason', v_err, 'attempted', v_new, 'version', v_ver));
    return jsonb_build_object('ok', false, 'reason', 'invalid', 'detail', v_err, 'version', v_ver);
  end if;
  update public.settings
     set value = jsonb_set(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end, '{frenzGift}',
                           v_gift || jsonb_build_object('conversion', v_new, 'updatedAt', v_at, 'updatedBy', p_admin), true)
   where key = 'landing';
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, 'gift_conversion_config_updated', 'settings', 'frenzGift', 'frenz-gift-config:v' || (v_ver + 1)::text,
          jsonb_build_object('before', v_cur, 'after', v_new, 'version', v_ver + 1, 'validation', coalesce(p_validation, '{}'::jsonb) || jsonb_build_object('database_check', 'valid')));
  insert into public.config_audit_log (actor_id, surface, target_id, action, before, after)
  values (p_admin, 'frenz_gift', 'settings', 'settings.update', jsonb_build_object('conversion', v_cur),
          jsonb_build_object('conversion', v_new, 'validation', coalesce(p_validation, '{}'::jsonb)));
  return jsonb_build_object('ok', true, 'version', v_ver + 1, 'conversion', v_new, 'updated_at', v_at);
end;
$$;

-- A sticker or its history may be written only inside admin_save_gift_sticker. A sticker is never deleted.
create or replace function public.gift_sticker_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'a gift sticker is never deleted: archive it (0291)'; end if;
  if coalesce(current_setting('frenz.sticker_writer', true), '') <> 'on' then
    raise exception 'gift stickers are written only by admin_save_gift_sticker (0291)';
  end if;
  return new;
end;
$$;

-- Why one sticker field is not acceptable (null = it is).
create or replace function public.gift_sticker_field_problem(p_key text, p_value jsonb) returns text
language plpgsql immutable as $$
begin
  case p_key
    when 'slug' then if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^[a-z0-9][a-z0-9-]{1,47}$' then return 'slug'; end if;
    when 'name' then if jsonb_typeof(p_value) <> 'string' or char_length(btrim(p_value #>> '{}')) not between 1 and 40 or (p_value #>> '{}') ~ '[[:cntrl:]]' then return 'name'; end if;
    when 'description' then if not (jsonb_typeof(p_value) = 'null' or (jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 200 and (p_value #>> '{}') !~ '[[:cntrl:]]')) then return 'description'; end if;
    when 'rarity' then if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') not in ('common', 'rare', 'epic', 'legendary') then return 'rarity'; end if;
    when 'priceFgc' then if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[1-9][0-9]{0,10}$' then return 'priceFgc'; end if;
    when 'imageUrl' then if not (jsonb_typeof(p_value) = 'null' or (jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 2048 and (p_value #>> '{}') ~ '^https://[^[:space:]"<>]+$')) then return 'imageUrl'; end if;
    when 'animationUrl' then if not (jsonb_typeof(p_value) = 'null' or (jsonb_typeof(p_value) = 'string' and char_length(p_value #>> '{}') <= 2048 and (p_value #>> '{}') ~ '^https://[^[:space:]"<>]+$')) then return 'animationUrl'; end if;
    when 'category' then if not (jsonb_typeof(p_value) = 'null' or (jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[a-z0-9][a-z0-9-]{0,23}$')) then return 'category'; end if;
    when 'featured' then if jsonb_typeof(p_value) <> 'boolean' then return 'featured'; end if;
    when 'sortOrder' then if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[0-9]{1,6}$' or (p_value #>> '{}')::int > 100000 then return 'sortOrder'; end if;
    when 'published' then if jsonb_typeof(p_value) <> 'boolean' then return 'published'; end if;
    when 'archived' then if jsonb_typeof(p_value) <> 'boolean' then return 'archived'; end if;
    else return 'unknown:' || p_key;
  end case;
  return null;
end;
$$;

-- Create (p_id null) or change a sticker. Every field validated, a stale revision refused, history written.
create or replace function public.admin_save_gift_sticker(p_admin uuid, p_id uuid, p_expected_revision integer, p_fields jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k         text;
  v_problem text;
  v_old     public.gift_stickers%rowtype;
  v_new     public.gift_stickers%rowtype;
  v_changed text[] := '{}';
  v_archive boolean;
begin
  if p_admin is null or p_fields is null or jsonb_typeof(p_fields) <> 'object' then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', 'request'); end if;
  for k in select jsonb_object_keys(p_fields) loop
    v_problem := public.gift_sticker_field_problem(k, p_fields -> k);
    if v_problem is not null then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', v_problem); end if;
  end loop;

  if p_id is null then
    if not (p_fields ? 'slug' and p_fields ? 'name' and p_fields ? 'priceFgc') then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', case when not p_fields ? 'slug' then 'slug' when not p_fields ? 'name' then 'name' else 'priceFgc' end); end if;
    if coalesce((p_fields ->> 'archived')::boolean, false) then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', 'archived'); end if;
    if exists (select 1 from public.gift_stickers where slug = p_fields ->> 'slug') then return jsonb_build_object('ok', false, 'reason', 'slug_taken'); end if;
    if coalesce((p_fields ->> 'published')::boolean, false) and jsonb_typeof(p_fields -> 'imageUrl') is distinct from 'string' then return jsonb_build_object('ok', false, 'reason', 'needs_artwork'); end if;
    perform set_config('frenz.sticker_writer', 'on', true);
    insert into public.gift_stickers (slug, name, description, rarity, price_fgc, image_url, animation_url, category, featured, published, sort_order, revision, created_by, updated_by)
    values (p_fields ->> 'slug', btrim(p_fields ->> 'name'), nullif(btrim(coalesce(p_fields ->> 'description', '')), ''), coalesce(p_fields ->> 'rarity', 'common'),
            (p_fields ->> 'priceFgc')::bigint, p_fields ->> 'imageUrl', p_fields ->> 'animationUrl', p_fields ->> 'category', coalesce((p_fields ->> 'featured')::boolean, false),
            coalesce((p_fields ->> 'published')::boolean, false), coalesce((p_fields ->> 'sortOrder')::int, 0), 1, p_admin, p_admin)
    returning * into v_new;
    v_changed := array['created'];
  else
    if p_fields ? 'slug' then return jsonb_build_object('ok', false, 'reason', 'invalid', 'field', 'slug_fixed'); end if;
    select * into v_old from public.gift_stickers where id = p_id for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
    if p_expected_revision is null or p_expected_revision <> v_old.revision then return jsonb_build_object('ok', false, 'reason', 'stale', 'revision', v_old.revision); end if;
    v_new := v_old;
    if p_fields ? 'name' then v_new.name := btrim(p_fields ->> 'name'); end if;
    if p_fields ? 'description' then v_new.description := nullif(btrim(coalesce(p_fields ->> 'description', '')), ''); end if;
    if p_fields ? 'rarity' then v_new.rarity := p_fields ->> 'rarity'; end if;
    if p_fields ? 'priceFgc' then v_new.price_fgc := (p_fields ->> 'priceFgc')::bigint; end if;
    if p_fields ? 'imageUrl' then v_new.image_url := p_fields ->> 'imageUrl'; end if;
    if p_fields ? 'sortOrder' then v_new.sort_order := (p_fields ->> 'sortOrder')::int; end if;
    if p_fields ? 'animationUrl' then v_new.animation_url := p_fields ->> 'animationUrl'; end if;
    if p_fields ? 'category' then v_new.category := p_fields ->> 'category'; end if;
    if p_fields ? 'featured' then v_new.featured := (p_fields ->> 'featured')::boolean; end if;
    if p_fields ? 'published' then v_new.published := (p_fields ->> 'published')::boolean; end if;
    if p_fields ? 'archived' then
      v_archive := (p_fields ->> 'archived')::boolean;
      if v_archive and v_old.archived_at is null then v_new.archived_at := now(); v_new.published := false;
      elsif not v_archive then v_new.archived_at := null; end if;
    end if;
    if v_new.published and v_new.archived_at is not null then return jsonb_build_object('ok', false, 'reason', 'archived'); end if;
    if v_new.published and v_new.image_url is null then return jsonb_build_object('ok', false, 'reason', 'needs_artwork'); end if;
    if v_new.name is distinct from v_old.name then v_changed := array_append(v_changed, 'name'); end if;
    if v_new.description is distinct from v_old.description then v_changed := array_append(v_changed, 'description'); end if;
    if v_new.rarity is distinct from v_old.rarity then v_changed := array_append(v_changed, 'rarity'); end if;
    if v_new.price_fgc is distinct from v_old.price_fgc then v_changed := array_append(v_changed, 'price'); end if;
    if v_new.image_url is distinct from v_old.image_url then v_changed := array_append(v_changed, 'artwork'); end if;
    if v_new.sort_order is distinct from v_old.sort_order then v_changed := array_append(v_changed, 'order'); end if;
    if v_new.animation_url is distinct from v_old.animation_url then v_changed := array_append(v_changed, 'animation'); end if;
    if v_new.category is distinct from v_old.category then v_changed := array_append(v_changed, 'category'); end if;
    if v_new.featured is distinct from v_old.featured then v_changed := array_append(v_changed, case when v_new.featured then 'featured' else 'unfeatured' end); end if;
    if v_new.published is distinct from v_old.published then v_changed := array_append(v_changed, case when v_new.published then 'published' else 'unpublished' end); end if;
    if v_new.archived_at is distinct from v_old.archived_at then v_changed := array_append(v_changed, case when v_new.archived_at is null then 'restored' else 'archived' end); end if;
    if cardinality(v_changed) = 0 then return jsonb_build_object('ok', true, 'unchanged', true, 'sticker', to_jsonb(v_old)); end if;
    perform set_config('frenz.sticker_writer', 'on', true);
    update public.gift_stickers
       set name = v_new.name, description = v_new.description, rarity = v_new.rarity, price_fgc = v_new.price_fgc, image_url = v_new.image_url,
           animation_url = v_new.animation_url, category = v_new.category, featured = v_new.featured,
           sort_order = v_new.sort_order, published = v_new.published, archived_at = v_new.archived_at, revision = v_old.revision + 1, updated_by = p_admin, updated_at = now()
     where id = p_id
    returning * into v_new;
  end if;
  insert into public.gift_sticker_revisions (sticker_id, revision, slug, name, description, rarity, price_fgc, image_url, animation_url, category, featured, published, sort_order, archived_at, changed, changed_by)
  values (v_new.id, v_new.revision, v_new.slug, v_new.name, v_new.description, v_new.rarity, v_new.price_fgc, v_new.image_url, v_new.animation_url, v_new.category, v_new.featured,
          v_new.published, v_new.sort_order, v_new.archived_at, v_changed, p_admin);
  perform set_config('frenz.sticker_writer', 'off', true);
  insert into public.financial_audit_log (actor_id, action, target_type, target_id, reference, details)
  values (p_admin, case when p_id is null then 'gift_sticker_created' else 'gift_sticker_updated' end, 'gift_sticker', v_new.id::text, 'gift-sticker:' || v_new.id::text || ':r' || v_new.revision::text,
          jsonb_build_object('changed', to_jsonb(v_changed), 'revision', v_new.revision, 'before', case when p_id is null then null else to_jsonb(v_old) end, 'after', to_jsonb(v_new)));
  insert into public.config_audit_log (actor_id, surface, target_id, action, before, after)
  values (p_admin, 'frenz_gift', 'sticker:' || v_new.id::text, case when p_id is null then 'sticker.create' else 'sticker.update' end,
          case when p_id is null then null else to_jsonb(v_old) end, to_jsonb(v_new));
  return jsonb_build_object('ok', true, 'sticker', to_jsonb(v_new), 'changed', to_jsonb(v_changed));
end;
$$;

-- What Part 4 may sell: a published, not archived sticker, at its current revision and price.
create or replace function public.gift_sticker_offer(p_sticker uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.gift_stickers%rowtype;
begin
  select * into v from public.gift_stickers where id = p_sticker;
  if v.id is null or not v.published or v.archived_at is not null then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  return jsonb_build_object('ok', true, 'sticker_id', v.id, 'revision', v.revision, 'price_fgc', v.price_fgc, 'name', v.name, 'image_url', v.image_url,
                            'animation_url', v.animation_url, 'rarity', v.rarity, 'category', v.category);
end;
$$;

do $$
begin
  execute 'drop trigger if exists gift_stickers_guard on public.gift_stickers';
  execute 'create trigger gift_stickers_guard before insert or update or delete on public.gift_stickers for each row execute function public.gift_sticker_guard()';
  execute 'drop trigger if exists gift_sticker_revisions_writer on public.gift_sticker_revisions';
  execute 'create trigger gift_sticker_revisions_writer before insert on public.gift_sticker_revisions for each row execute function public.gift_sticker_guard()';
  execute 'drop trigger if exists gift_sticker_revisions_append_only on public.gift_sticker_revisions';
  execute 'create trigger gift_sticker_revisions_append_only before update or delete on public.gift_sticker_revisions for each row execute function public.financial_append_only_guard()';

  execute 'revoke all on function public.fgc_conversion_rules_check(jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.fgc_conversion_rules_check(jsonb) to service_role';
  execute 'revoke all on function public.save_landing_settings(jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.save_landing_settings(jsonb) to service_role';
  execute 'revoke all on function public.save_frenz_gift_conversion(uuid, jsonb, bigint, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.save_frenz_gift_conversion(uuid, jsonb, bigint, jsonb) to service_role';
  execute 'revoke all on function public.gift_sticker_guard() from public, anon, authenticated';
  execute 'revoke all on function public.gift_sticker_field_problem(text, jsonb) from public, anon, authenticated';
  execute 'revoke all on function public.admin_save_gift_sticker(uuid, uuid, integer, jsonb) from public, anon, authenticated';
  execute 'grant execute on function public.admin_save_gift_sticker(uuid, uuid, integer, jsonb) to service_role';
  execute 'revoke all on function public.gift_sticker_offer(uuid) from public, anon, authenticated';
  execute 'grant execute on function public.gift_sticker_offer(uuid) to service_role';
end;
$$;
