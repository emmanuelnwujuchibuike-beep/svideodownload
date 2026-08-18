# Feature 15 — Part 7: Sounds (Music & Audio Discovery)

## What this is, honestly

The brief asked for a TikTok-Sounds/Instagram-Music-scale platform: licensed
catalogues, AI-generated music, spatial audio, royalty tracking, remix/mashup
tooling, ContentID-style matching, a full mood-detection AI. None of that
infrastructure exists here, and building fake versions of it would violate
this codebase's own standing rule against invented data (`revenue-overview.tsx`:
*"this project has declined invented statistics three times"*; the reel-viewer's
sound-row comment: *"deliberately does NOT invent a track title, an artist, or
a 'trending sound' count — the fabrications this row invites"*).

So Part 7 ships the real, honest slice: a genuine `sounds` entity, decoupled
from posts for the first time, that creators can attach to a Reel, that gets
its own page, that's discoverable and searchable, and that carries REAL
counted usage — plus the one thing the brief asked for that this app can
uniquely offer: turning a Downloader-fetched clip's audio into an attributed,
reusable sound. Licensed music, AI generation, spatial audio, remix/mashup
DSP, and royalty tracking are explicitly OUT of scope — the schema is shaped
so a real licensing/ContentID partner can plug in later (`source_type` is
already an enum, not a boolean), but nothing here pretends one exists today.

## Pre-existing groundwork (audited before writing any of this)

- **The integration point already exists and was built for exactly this.**
  `features/feed/reel-viewer.tsx`'s "sound row" (~line 2432) has carried an
  explicit comment since Part 2/3: *"When a music system exists, this becomes
  the sound page and the label becomes data — the row is already the right
  shape."* This part fulfills that comment rather than redesigning the row.
- **The waveform UI already exists.** `features/social/comment-media.tsx`'s
  `VoiceMessage` component is a complete, shipped waveform-scrubber (tap to
  seek, play/pause, speed cycle) driven by real decoded amplitude peaks, not
  decoration. The Sound Page's player is that pattern, generalized.
- **The trending-score pattern already exists.** `posts.hot_score` +
  `recompute_hot_scores()` (migration `0009_trending.sql`) is a materialized
  column recomputed by a cron-called Postgres function with admin-tunable
  weights. Sound trending reuses the identical shape.
- **The storage/upload pipeline already exists.** `presignUpload()`
  (`lib/storage/client-upload.ts`) already accepts `"audio"` and `"image"`
  kinds — no new upload plumbing needed for a sound's audio file or cover art.
- **The entity-page convention already exists.** `/p/[id]` is the template:
  Server Component, `generateMetadata`, JSON-LD via `lib/seo/json-ld.ts`,
  data layer isolated in `lib/social/*.ts`, below-the-fold content code-split
  with `next/dynamic`.
- **The hard constraint that must not be violated**: `lib/media/audio-playback.ts`
  documents, in its own header, that the feed deliberately never takes audio
  focus on autoplay, never uses Web Audio API/`AudioContext`, never uses
  hidden auto-playing `<audio>`, and never calls `navigator.mediaSession` —
  specifically so a visitor's own music/podcast keeps playing. Every sound
  surface here (discovery grid, Sound Page) requires an explicit tap before a
  single frame of audio plays. Nothing auto-previews on hover or scroll.

## Data model (migration `0125_sounds.sql`)

```
sounds
  id               uuid pk
  created_by       uuid -> auth.users            -- who published it here
  source_type      text check (original | downloaded)   -- room for 'licensed' later, unused today
  source_platform  text null                      -- e.g. "tiktok" — only set when source_type = downloaded
  source_url       text null                      -- the original post this audio came from — attribution link
  title            text
  artist_label     text                           -- free text: "@handle" for an original sound, or the credited
                                                    -- artist/creator name for a downloaded one — never invented
  cover_art_url    text null
  audio_url        text                           -- via presignUpload("audio", …), same pipeline as post media
  waveform_peaks   real[]                          -- decoded amplitude, same shape as comment voice notes
  duration_sec     int
  mood_tag         text null                       -- CREATOR-set, from a small fixed vocabulary — not AI-inferred
  genre_tag        text null                       -- same
  is_public        boolean default true
  usage_count      int default 0                   -- trigger-maintained off posts.sound_id, real count
  plays_count      bigint default 0                 -- trigger-maintained off sound_plays, deduped like post_views
  created_at       timestamptz

posts.sound_id     uuid null -> sounds(id) on delete set null   -- ALTER on existing table

sound_plays                                        -- dedup log, identical shape to post_views
  id, sound_id, viewer_id null, ip_hash, day, created_at
  unique (sound_id, coalesce(viewer_id, ip_hash), day)
```

`source_type = 'original'` is the default for a sound published straight from
a Reel's own audio (`artist_label` = the publisher's own handle, matching the
current fallback row exactly). `source_type = 'downloaded'` is the
owner-approved path (see decision below) for turning a Downloader-fetched
clip's audio into a sound others can browse and reuse — `source_platform` +
`source_url` are then REQUIRED (enforced by a check constraint), and every
surface that renders the sound (Sound Page, sound row, discovery grid, "use
this sound" picker) shows a "From {platform}" attribution badge, never
presented as if it were original.

**Product decision, made explicitly rather than assumed**: downloaded audio
IS allowed to become a public, discoverable sound, but only with that clear
attribution — the owner's call, not a default I picked.

## Tranches

1. **Data model + reel-viewer wiring** — the migration above, `lib/social/sounds.ts`
   data layer, `FeedItem.sound` field, and rewiring the existing sound row to
   link to `/sound/[id]` + show real data when `item.sound` exists, falling
   back to today's exact "Original sound · @handle" → profile link when it
   doesn't (the vast majority of reels, at least at first — attaching a sound
   is opt-in, not retroactive).
2. **Sound Page** (`/sound/[id]`) — cover art, tap-to-play waveform player,
   real usage/play counts, "Reels using this sound" grid, JSON-LD
   (`MusicRecording`), matching `/p/[id]`'s conventions.
3. **"Use this sound"** — a music-picker step in the Reel composer (search
   mine/trending, or skip and keep the reel's own audio, today's only path,
   unchanged) and a "Use this sound" action on the Sound Page / sound row.
4. **Discovery** — trending sounds (mirrors `recompute_hot_scores`), sound
   search (extends `lib/social/search.ts`), and a `/sounds` library page with
   creator-set mood/genre filters (curated tags, not AI-inferred — the
   honest version of "MoodFlow™").
5. **Downloaded-audio-as-sound** — the "Publish as sound" action on an
   audio-kind download in History/Library, scoped to audio-kind downloads for
   this pass (extracting a shareable audio track out of a downloaded VIDEO
   file is a separate, larger undertaking — server-side transcoding — and is
   explicitly deferred, not silently dropped).
6. **Creator sound analytics** — real counts only (total uses, total plays,
   trend), same discipline as `revenue-overview.tsx`.

## Explicitly deferred (stated, not silently dropped)

Licensed Music (needs a real licensing partner — previously declined per
`docs/PROJECT_NOTES.md`), AI-generated music, spatial audio, in-app
remix/mashup DSP, voice-effect processing, ContentID-style copyright
matching, royalty tracking (nothing to track without licensing deals),
podcast-clip as a distinct taxonomy (folds into the same `sounds` row shape,
no separate system needed), and the animated "Sound Journey™" milestone
timeline (a visual flourish over data this schema already supports —
buildable later without a schema change).
