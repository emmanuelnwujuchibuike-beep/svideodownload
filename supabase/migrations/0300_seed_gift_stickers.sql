-- ═══════════════════════════════════════════════════════════════════════════
--  0300 — the first sticker gallery (2026-10-28)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "the stickers should be uploaded in sticker gallery, and use the price there as default, but sticker price
-- should be able to be changed by admin."
--
-- The twelve stickers of design/gallery.html, artwork served from /stickers (public/stickers/*.svg), at the gallery's
-- prices (coins there = Gift Coins here, stored in hundredths: 20 coins = 2000). Published, so they are in the gift
-- sheet as soon as sticker gifting is switched on in Admin. Each one gets revision 1 in gift_sticker_revisions, as if
-- created in the admin screen.
--
-- Never overwrites: a slug that already exists is skipped, so an admin's later price, name or artwork change survives a
-- re-run. Every later change goes through Admin, Gift Coin, Stickers (admin_save_gift_sticker, versioned and audited).
--
-- ── Repair first (owner's run, 2026-10-28: "invalid regular expression: invalid repetition count(s)") ─────────────
-- The live gift_stickers table was created by an earlier draft of 0291 whose text checks used a regex repetition above
-- 255 (Postgres refuses those). Because 0291 says "create table if not exists", the corrected checks never replaced
-- them, so EVERY sticker with artwork failed to save, the admin screen included. Below, the four text checks are
-- dropped and re-added exactly as 0291 now defines them, and the field check function is restated from 0291, before
-- anything is inserted.
--
-- Depends on 0291. Safe to run twice. No semicolon inside any quoted string or comment. Dollar-quoted blocks last.

-- ═════════════════════════════════════════════════════════════════════════════
--  EVERY DOLLAR-QUOTED BLOCK FROM HERE DOWN.
-- ═════════════════════════════════════════════════════════════════════════════

do $$
begin
  execute 'alter table public.gift_stickers drop constraint if exists gift_stickers_slug_chk';
  execute 'alter table public.gift_stickers add constraint gift_stickers_slug_chk check (slug ~ ''^[a-z0-9][a-z0-9-]{1,47}$'')';
  execute 'alter table public.gift_stickers drop constraint if exists gift_stickers_image_chk';
  execute 'alter table public.gift_stickers add constraint gift_stickers_image_chk check (image_url is null or (char_length(image_url) <= 2048 and image_url ~ ''^https://[^[:space:]"<>]+$''))';
  execute 'alter table public.gift_stickers drop constraint if exists gift_stickers_animation_chk';
  execute 'alter table public.gift_stickers add constraint gift_stickers_animation_chk check (animation_url is null or (char_length(animation_url) <= 2048 and animation_url ~ ''^https://[^[:space:]"<>]+$''))';
  execute 'alter table public.gift_stickers drop constraint if exists gift_stickers_category_chk';
  execute 'alter table public.gift_stickers add constraint gift_stickers_category_chk check (category is null or category ~ ''^[a-z0-9][a-z0-9-]{0,23}$'')';
end
$$;

-- the field check the admin save uses, restated from 0291 (the draft's copy may carry the same bad regex)
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

do $$
declare
  r     record;
  v_new public.gift_stickers%rowtype;
begin
  -- the writer flag the 0291 guard requires, for this transaction only
  perform set_config('frenz.sticker_writer', 'on', true);
  for r in
    select * from (values
      ('heart',   'Big Heart',    2000,  'common',    'love', 10),
      ('rose',    'Red Rose',     5000,  'rare',      'love', 20),
      ('flame',   'On Fire',      3000,  'common',    'fun',  30),
      ('star',    'Gold Star',    4000,  'common',    'fun',  40),
      ('cake',    'Party Cake',   6000,  'rare',      'fun',  50),
      ('coffee',  'Coffee Date',  2500,  'common',    'love', 60),
      ('moon',    'Sweet Dreams', 3500,  'common',    'love', 70),
      ('planet',  'Out of Orbit', 8000,  'rare',      'fun',  80),
      ('rocket',  'To the Moon',  15000, 'epic',      'fun',  90),
      ('diamond', 'Diamond',      30000, 'legendary', 'luxe', 100),
      ('gift',    'Surprise Box', 10000, 'epic',      'luxe', 110),
      ('crown',   'Royal Crown',  50000, 'legendary', 'luxe', 120)
    ) as t(slug, name, price, rarity, category, sort)
  loop
    if exists (select 1 from public.gift_stickers where slug = r.slug) then continue; end if;
    insert into public.gift_stickers (slug, name, rarity, price_fgc, image_url, category, featured, published, sort_order, revision)
    values (r.slug, r.name, r.rarity, r.price, 'https://frenzsave.com/stickers/' || r.slug || '.svg', r.category, false, true, r.sort, 1)
    returning * into v_new;
    insert into public.gift_sticker_revisions (sticker_id, revision, slug, name, description, rarity, price_fgc, image_url, animation_url, category, featured, published, sort_order, archived_at, changed, changed_by)
    values (v_new.id, 1, v_new.slug, v_new.name, null, v_new.rarity, v_new.price_fgc, v_new.image_url, null, v_new.category, false, true, v_new.sort_order, null, array['created'], null);
  end loop;
  perform set_config('frenz.sticker_writer', 'off', true);
end
$$;
