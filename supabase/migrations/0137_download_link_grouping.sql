-- ============================================================================
-- 0137 — group download outcome alerts by LINK, not by media item
-- ============================================================================
--
-- Owner, 2026-08-26: "the failed, cancelled and abandoned email and push
-- notification sent to the admin should send one per link, not each media in a
-- batch download, causing email and push notification spamming i dont want".
--
-- One pasted link can expand into many downloads — a story's snaps, a
-- slideshow's photos, every item of a multi-link batch. Each of those is its
-- own `analytics_downloads` row with its own `download_id`, and the admin alert
-- deduped on exactly that, so a ten-photo slideshow that failed sent TEN emails
-- and TEN pushes for what the operator experiences as one broken link.
--
-- Grouping needs two facts the table never stored:
--
--   batch_id  — shared by every download that came from one batch operation.
--   link_key  — which SOURCE LINK inside that batch this download came from.
--               For a single link that expanded into several media it is the
--               batch id itself (one link, one batch). For a multi-link batch
--               it is the source id, so ten links still produce ten alerts —
--               collapsing those to one would under-report, which is the
--               opposite failure and just as bad.
--
-- Together, `(batch_id, link_key)` IS "one link". The alert's dedupe key
-- becomes that pair instead of `download_id`; a plain single download has no
-- batch and keeps deduping on `download_id` exactly as before.
--
-- 🔴 NOT BACKFILLABLE. Rows written before this migration have no batch or link
-- recorded anywhere recoverable — `analytics_download_log` (0115) holds the
-- source URL but only for downloads that reached `requested` with one, and it
-- cannot say which of them shared a batch. Both columns are therefore nullable
-- and every consumer treats NULL as "not part of a batch", which is precisely
-- the pre-migration behaviour. No historical alert changes; only new downloads
-- group.

alter table public.analytics_downloads add column if not exists batch_id text null;
alter table public.analytics_downloads add column if not exists link_key text null;

comment on column public.analytics_downloads.batch_id is
  'Shared by every download from one batch operation. NULL for a plain single download.';
comment on column public.analytics_downloads.link_key is
  'Which source link inside the batch this download came from. Equals batch_id when one link expanded into several media. NULL for a plain single download.';

-- The abandoned-download sweep selects stuck rows and then groups them per link
-- before alerting, so it reads this pair for every row it touches.
create index if not exists analytics_downloads_link_idx
  on public.analytics_downloads (batch_id, link_key)
  where batch_id is not null;
