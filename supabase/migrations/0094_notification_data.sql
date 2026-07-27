-- =====================================================================
-- FrenzSave — per-notification payload
-- A nullable JSON payload on notifications. Today it carries an admin
-- broadcast / AD's own title + body + sponsored flag, so the in-app
-- notification (drop-down + Notification Center) can show the ACTUAL ad,
-- clearly labelled "Sponsored", instead of a generic "Frenz announcement"
-- that reads like a personal message. Additive + nullable; all readers treat
-- it best-effort, so nothing breaks if this migration lags behind the code.
-- =====================================================================
alter table public.notifications add column if not exists data jsonb;
