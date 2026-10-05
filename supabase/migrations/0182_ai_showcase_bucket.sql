-- 0182 — the Frenz AI showcase images (2026-10-05)
--
-- The welcome page carousel's slides are admin-editable (owner, 2026-10-05).
-- Their TEXT lives in `settings` under key `ai_showcase` (no new table: one
-- short ordered list, written by one admin, read when the page renders). Their
-- IMAGES live here: two pre-sized webp copies per upload (~720 px, ~1280 px),
-- written by app/api/admin/ai/showcase/route.ts through the service role.
--
-- Public, because visitors' browsers load them straight from the CDN — that is
-- what keeps a slide image off the Vercel image optimizer's bill.
--
-- 🔴 No `storage.objects` policy at all, on purpose:
--   · reads of a PUBLIC bucket go through /object/public/, which does not
--     consult RLS — a select policy would only add the ability to LIST the
--     bucket through the API, which nobody needs;
--   · writes come only from the service role, which bypasses RLS, so an insert
--     policy would only open a door for members.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-showcase',
  'ai-showcase',
  true,
  5242880,                                     -- 5 MB: the copies are ~50–250 kB
  array['image/webp']
)
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
