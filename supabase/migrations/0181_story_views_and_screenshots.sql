-- ═══════════════════════════════════════════════════════════════════════════
--  0181 — who viewed a story, who screenshotted it, and the switch (2026-10-04)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner: "make users see who viewed and screenshotted their story, and they can
-- turn it off in story settings. When they turn it off, them and users who see
-- when they screenshot their post."
--
-- ── 🔴 THE RECIPROCITY RULE, AND WHY IT IS ENFORCED ON THE WRITER ──────────
--
-- The second sentence is the whole design: turning the switch off is not a
-- privacy setting that only hides OTHER people from you. It cuts both ways —
-- you stop seeing who screenshotted your stories, AND you stop being reported
-- when you screenshot someone else's. That is the only version of this feature
-- that is fair, and it is the one Snapchat settled on for the same reason.
--
-- So the switch is read at WRITE time, from the screenshotter's own row: with
-- it off, no `screenshot_at` is ever recorded for that member, anywhere. A
-- read-time filter would leave the evidence in the table and merely decline to
-- show it, which is a promise the database would not actually be keeping.
--
-- ── One row per viewer per story ───────────────────────────────────────────
--
-- `story_views` is keyed (story_id, viewer_id), so re-opening a story updates
-- its row rather than adding another. A screenshot stamps the SAME row: a
-- screenshot is a property of a view, not a separate event, and keeping them
-- together is what makes "Sarah viewed this, and screenshotted it" one line in
-- the viewers list rather than two that must be joined.
--
-- ON DELETE CASCADE from `stories` matters more here than usual: a story is
-- ephemeral by definition (24h), and its viewer list must die with it rather
-- than outliving the thing it describes.

create table if not exists public.story_views (
  story_id       uuid not null references public.stories (id) on delete cascade,
  viewer_id      uuid not null references auth.users (id) on delete cascade,
  viewed_at      timestamptz not null default now(),
  -- null = not screenshotted (or the viewer has the switch off; see above)
  screenshot_at  timestamptz,
  primary key (story_id, viewer_id)
);

-- The author's own question: "who has seen this one?", newest first.
create index if not exists story_views_story_idx
  on public.story_views (story_id, viewed_at desc);

alter table public.story_views enable row level security;

/*
  🔴 READ: the story's AUTHOR only. A viewer list is the author's information,
  not the audience's — without this, any signed-in member could read who had
  watched anybody's story. Writes go through the service role (the route checks
  the session and sets `viewer_id` itself), so there is deliberately no insert
  or update policy here: a member cannot forge a view, their own or anyone's.
*/
drop policy if exists "story_views author read" on public.story_views;
create policy "story_views author read" on public.story_views
  for select using (
    exists (
      select 1 from public.stories s
      where s.id = story_views.story_id
        and s.user_id = (select auth.uid())
    )
  );

-- ── The switch ─────────────────────────────────────────────────────────────
--
-- Defaults TRUE, matching 0106's `show_views`: the feature is on for everybody
-- the moment this lands, and a member turns it off deliberately. The reader
-- selects it behind a fallback and the writer strips it on failure, so the app
-- degrades gracefully on a deployment where this has not been applied yet —
-- the same contract 0106 documents.
alter table public.privacy_settings
  add column if not exists story_screenshot_alerts boolean not null default true;
