-- =====================================================================
-- 0108_wallpaper_metrics.sql
-- Frenzsave · Wallpaper views + admin engagement adjustments
--
-- Two things the owner asked for (2026-08-03):
--   1. Wallpapers should count VIEWS, like the rest of the platform does.
--   2. An admin should be able to add to, or reduce, a wallpaper's views,
--      likes and saves.
--
-- ── Why adjustments are SEPARATE columns, not edits to the counters ─────
-- `likes_count` / `saves_count` are maintained by the triggers in 0105 from
-- real rows in `wallpaper_likes` / `wallpaper_saves`. If an admin wrote
-- directly into those, two things would break:
--
--   · The next real like or unlike re-runs the trigger arithmetic on a
--     number the trigger did not produce, so the adjustment would drift or
--     be silently wiped.
--   · The platform would permanently lose the ability to answer "how many
--     people actually liked this?" — the real signal and the operator's
--     adjustment would be indistinguishable for ever.
--
-- So each metric keeps its real counter untouched and gains a signed
-- `*_boost`. What visitors see is `real + boost` (floored at zero); what
-- the admin dashboard shows is BOTH, side by side. This is the same shape
-- as `profiles.reputation_bonus` (0097) — an operator adjustment that is
-- always attributable and always reversible by setting it back to 0.
--
-- Honest note, recorded here because the schema is where it matters: a
-- non-zero boost means the number a visitor sees is not purely earned. The
-- separation is what keeps that recoverable rather than hidden.
--
-- Idempotent; safe to re-run.
-- =====================================================================

-- Real views, incremented once per viewer per wallpaper per session by the
-- reels viewer (see /api/wallpapers/engage).
alter table public.wallpapers
  add column if not exists views_count integer not null default 0;

-- Signed operator adjustments. Negative is allowed — the owner asked to be
-- able to REDUCE a count as well as raise it — and the display floors the
-- sum at zero so a large negative can never render below nothing.
alter table public.wallpapers
  add column if not exists views_boost integer not null default 0;
alter table public.wallpapers
  add column if not exists likes_boost integer not null default 0;
alter table public.wallpapers
  add column if not exists saves_boost integer not null default 0;

-- Counting a view must not require read-modify-write from the app (two
-- concurrent viewers would lose one), so the increment happens in one
-- atomic statement.
create or replace function public.increment_wallpaper_view(target uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.wallpapers
     set views_count = views_count + 1
   where id = target;
$$;

-- Anyone may count a view (the library is public, signed-out included).
-- The function can only ever add one to one row, so this grants no ability
-- to read or alter anything else.
grant execute on function public.increment_wallpaper_view(uuid) to anon, authenticated;
