-- =====================================================================
-- FrenzSave — Public Feed SEO: descriptive post slugs
-- Lets a categorized post resolve at /[category]/[year]/[month]/[slug]
-- instead of only /p/[uuid]. Assigned once at publish/backfill time and
-- never regenerated on edit — a stable URL matters more than a slug that
-- stays in sync with a later-edited title. Nullable: an uncategorized
-- post has nowhere principled to live in /[category]/... and simply has
-- no slug, keeping /p/[id] as its permanent canonical. Idempotent.
-- =====================================================================

alter table public.posts add column if not exists slug text;

-- Partial + unique: only rows that HAVE a slug need to be unique against
-- each other, so this never blocks the (common, pre-backfill) null case.
create unique index if not exists posts_slug_unique_idx
  on public.posts (slug) where slug is not null;
