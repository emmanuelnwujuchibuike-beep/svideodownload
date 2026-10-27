# Stories — security, privacy and expiry (Part 1, 2026-10-26)

What the 2026-10-26 Stories audit found (S1–S6), what Part 1 changes, and the production steps
that are **not** automatic. Nothing in Part 1 was applied to production, and no production file
was deleted while building it.

## What changed

| Finding | Before | After |
|---|---|---|
| S1 stories never disappeared | 69 rows, all expired, never removed; files expired 117 days earlier still answered 200; a member's DELETE removed the row that recorded the file | Daily sweep `app/api/cron/story-cleanup` (`lib/social/story-cleanup.ts`) removes expired stories, their viewer lists, and every file of theirs nothing else uses. DELETE now **ends** the story (`expire_own_story`) and the sweep finishes the job |
| S2 anyone could read every live story | policy `stories public read` for every role, anon included | owner-only read (`stories owner read`), anon has no table access; every surface already read through the service role |
| S3 members could write any story | insert policy checked only `user_id`: any `expires_at`, any `media_url`, any provenance | no member insert, update or delete. `POST /api/stories` accepts only the member's own upload of the right kind (`lib/storage/owned-media.ts`), refuses suspended accounts, and writes as the server. A trigger stamps a 24 hour life on every insert, whoever the caller |
| S4 reshare switch bypassable | follows from S2 + S3, and `resolveStoryMedia` checked no blocks | S2/S3 closed, and a story reshare also needs `story_view_access = ok` |
| S5 rings and seen marks outlived sign-out | saved under no account | saved under the signed-in handle, read back only for it, cleared on sign-out |
| S6 views from anyone | any member could record a view on any story id | `story_view_access` (0285): blocks and status restrictions both ways, suspended/hidden author, private profile without a direct chat, ended story |

Migration: `supabase/migrations/0285_stories_security.sql`.
Proof against Postgres: `supabase/tests/0285_stories_security.pglite.mjs` (49 checks, 6 mutants that must fail).

## The media itself — what is and is not protected

Story media lives in the **public** R2 bucket, served by `R2_PUBLIC_BASE_URL` (media.frenzsave.com),
with `Cache-Control: public, max-age=31536000, immutable`. So:

- **A database policy cannot hide a file.** Anyone holding the URL can fetch it while the object exists.
- **Deleting the object is what ends it at the origin.** The sweep does that for every file a story
  owned, once nothing else (a feed post, an album, a chat attachment, another story — every
  `*_url` text column and `*_urls` text[] column in `public`) still uses it.
- **Cloudflare may keep serving a cached copy after the delete.** The sweep purges each deleted URL
  when `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_PURGE_API_TOKEN` are set, and reports `cdn.configured`
  either way. Without them, cached copies expire only when Cloudflare evicts them.
- **A copy already in a viewer's browser cache cannot be recalled by anyone.**
- While a story is live (24 hours) its file is reachable by anyone who has its URL, exactly like a
  feed post's. Keys are unguessable; making live story files private (a private bucket and signed
  reads) is a larger change to the viewer, the rings and reshares, and is not part of Part 1.

Never deleted by the sweep, by construction:
- a URL that is not our upload (another site, a query string, any `..`), and
- a key with no owner id. Two old covers have that shape (`post-media/images/<ts>-poster.jpg`).
  They stay until removed by hand.

## Production steps, in order

1. **Review, then push.** Pushing applies 0285 through the Supabase GitHub integration. Deploy the
   app in the same push: once 0285 is live, the OLD `POST /api/stories` (member-session insert) and
   the OLD DELETE route stop working, so the code and the migration must land together.
2. **Probe the migration, each object** (applied is not fully applied — see the 0130 incident):
   ```sql
   select polname from pg_policy where polrelid = 'public.stories'::regclass;           -- only: stories owner read
   select has_table_privilege('anon', 'public.stories', 'select');                     -- false
   select has_table_privilege('authenticated', 'public.stories', 'insert');            -- false
   select tgname from pg_trigger where tgrelid = 'public.stories'::regclass and not tgisinternal; -- stories_enforce_expiry
   select proname, proowner::regrole, prosecdef from pg_proc
    where proname in ('story_view_access', 'story_media_references', 'expire_own_story');  -- owned by the table owner, prosecdef true
   select has_function_privilege('anon', 'public.story_view_access(uuid,uuid)', 'execute');          -- false
   select has_function_privilege('authenticated', 'public.story_media_references(text[],uuid[])', 'execute'); -- false
   ```
   And as the anon key over REST: `GET /rest/v1/stories?select=id&limit=1` must answer 401/403
   (permission denied), not `200 []`.
3. **Smoke-test on production with your own account:** post a photo story and a video story,
   watch one from a second account, reshare one, delete one. Each should behave as before.
4. **Optional, recommended: Cloudflare purge.** Create an API token with only
   *Zone → Cache Purge → Purge* for the zone serving media.frenzsave.com, then set
   `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_PURGE_API_TOKEN` on Vercel (Production).
5. **The first sweep.** GitHub → Actions → *Cron - Story cleanup* → *Run workflow*. It uses the
   existing `CRON_SECRET` Actions secret. Expect about 69 stories removed on the first run. Check
   the body: `errors` must be 0. `retried` > 0 means a file could not be deleted and will be retried.
6. **Verify old media is gone** — do not claim it before this. For a few expired story URLs taken
   from the database BEFORE step 5:
   ```bash
   curl -sI "<url>" | grep -iE "^HTTP|cf-cache-status"
   ```
   `404` = gone. `200` with `cf-cache-status: HIT` = deleted at the origin but still in Cloudflare's
   cache: purge those URLs (step 4, or Cloudflare dashboard → Caching → Purge Cache → Custom Purge).
   `200` with `MISS`/`DYNAMIC` = the object still exists: read the sweep's response and logs.
7. After that, the workflow runs daily at 04:45 UTC on its own.

## Cost

One GitHub Actions run and one Vercel function call a day (well under a minute), one
`story_media_references` call per page of up to 100 stories (a scan of each `*_url` column, once a
day), and one storage DELETE per removed file. No polling, nothing while idle, no new paid service.

## Not in Part 1

Who sees whose stories (Part 2), seen state from `story_views` (Part 3), screenshot copy, reply
notifications and video limits (Part 4), loading the viewer on first tap (Part 5).
🔴 When Part 2 widens visibility, `story_view_access` must widen with it, or views and reshares
will refuse people the rings show.

## Part 5 (2026-10-27) — highlights and performance

**Highlights (migration 0289, not applied by this change — it runs with the next push through the Supabase integration).**
`story_highlights` + `story_highlight_items`, no member table access (the 0285 model); every read and write is the
server's (`lib/social/story-highlights.ts`, routes under `/api/stories/highlights`, catalogued in `api-registry.ts`).

| Rule | How |
|---|---|
| Who sees a member's highlights | whoever may see their stories — `canSeeStoriesOf` (the rings' one rule: blocks and status restrictions both ways, profile visibility, ties). A refusal is an empty list / 404, never the rows or media URLs |
| Who writes | the owner, and only with their OWN stories (checked on the `stories` row before anything is written) |
| The file outlives the story | an item copies the story's `media_url` / `thumbnail_url`; the daily sweep never deletes a file any `*_url` column names (`story_media_references`, 0285), so no sweep change was needed |
| Nothing left behind | removing a story or deleting a highlight offers its files to `releaseUnreferencedUploads` (`lib/storage/release-unreferenced.ts`, shared with the refused-upload path): deleted only when nothing references them |
| Limits | titles 1–30 characters, 100 highlights per member, 100 stories per highlight; the last story out deletes the highlight |

Where: **Highlight** on your own story (the bar and Story options) opens "Add to highlight"; the profile shows a row of
circles (owner + visitors who may see the stories; not on a restricted profile) with **New** for the owner while they
have a story up; a circle opens the highlight viewer (owner: remove, make cover, rename, delete).

**Performance.** Home's ring read went from 4 sequential database round trips to 3 (public discovery now runs with the
ties and block list instead of after the tied authors' stories — same filtering after). With a migration unapplied,
the missing-column fallback is remembered for 10 minutes instead of costing a failed query on every read. The viewer's
code is fetched on a ring press and after page load (never during it, never on a slow connection) — still not in the
page bundle. No index was needed: `stories_user_idx`, `stories_active_idx` and `story_views`' primary key cover every
read. Tests: `lib/social/stories-perf.server.test.ts` (round trips, the fallback, access unchanged — mutation-checked),
`lib/social/story-highlights.server.test.ts`, `features/ui/warm-after-load.test.ts`.
