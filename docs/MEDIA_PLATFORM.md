# Enterprise Media Platform

One unified media layer — upload once, optimise automatically, deliver globally,
stream efficiently, store securely, observe continuously — across every Frenzsave
surface. This document is the human-readable companion to the machine-readable
registry in [`lib/platform/media-platform.ts`](../lib/platform/media-platform.ts),
which is the single source of truth and is kept honest by
[`media-platform.test.ts`](../lib/platform/media-platform.test.ts).

## Position: the substrate already exists

Frenzsave *is* a media pipeline, so the Media brief's Media Gateway, Upload
Service, Transcoding, Image/Video/Audio processing, Thumbnail service, Streaming,
CDN Manager, Storage Manager and Media Registry **already exist** and run in
production. The deliverable here is the honest *map* over them — every row points
at the real module that provides it, and the genuinely-absent enterprise pieces
are marked `planned`, not implied as shipped.

Infrastructure detail (hosting, buckets, regions) lives in
[`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md).

## What runs today

| Layer | Reality | Anchor |
|---|---|---|
| Upload | Presigned direct-to-R2 (or Supabase) browser upload; survives a mid-PUT SW reload | `lib/storage/client-upload.ts` |
| Object storage | Cloudflare R2 — zero-egress, CDN-served; Supabase for small images / fallback | `lib/storage/r2.ts`, `lib/storage/index.ts` |
| Streaming & transcode | Cloudflare Stream — ABR/HLS, auto quality ladder (AV1/H.265/H.264), direct upload, copy-from-URL, webhook | `lib/media/stream.ts` |
| Adaptive playback | Native HLS on Safari/iOS; hls.js elsewhere, level-capped to the element, off-thread parsing | `lib/media/hls.ts` |
| Extraction/transcode worker | yt-dlp/ffmpeg on a Docker worker, proxied from Vercel with a shared secret | `lib/worker.ts`, `server/*` |
| Captions/subtitles | Cloudflare-generated, multi-language (en + fr), as HLS subtitle renditions | `lib/media/stream.ts` |
| Thumbnails/posters | Generated + re-hosted onto our CDN | `lib/media/video-poster.ts`, `lib/media/poster-host.ts` |
| Waveforms | Peak waveform at record time for voice notes/audio | `lib/media/comment-recording.ts` |
| CDN delivery | Cloudflare fronts R2/Vercel; every object `public, max-age=1y, immutable` | `lib/storage/cache-control.ts` |
| Observability | Playback QoE beacon (TTFF/rebuffer/dropped/bitrate), stream health, egress | `lib/media/playback-metrics.ts` |

## Media philosophy

Upload once · optimise automatically · deliver globally · stream efficiently ·
store securely · reuse everywhere · observe continuously. Two rules make this
concrete and are already enforced:

- **Immutable by key.** Every upload key is unique, so the bytes at a media URL
  never change — an edit produces a new key/URL. There is nothing to invalidate,
  which is why the CDN can cache media for a year. (Missing `Cache-Control` once
  re-billed R2 egress on every view — a real, measured bug, now fixed at every
  upload path.)
- **Heavy work off the request path.** Extraction and ffmpeg transcode run on the
  worker (no serverless ceiling); ABR transcode is Cloudflare Stream's. Nothing
  media-heavy runs in a Vercel request, which keeps the 2-second budget
  (`docs/PERFORMANCE.md`) intact.

## Honestly planned

Named by the brief, not built — and marked `planned` in the registry:

- **Media Intelligence** beyond captions + moderation: background removal,
  upscaling, object/face detection (consent-gated), smart cropping, AI tagging,
  semantic analysis, text-to-speech, AI media generation. These need a GPU
  inference tier the app doesn't run.
- **Pipeline**: virus scanning, standalone speech transcription/search, OCR,
  scene detection, watermarking, automatic EXIF-orientation / colour-profile
  normalisation on ingest.
- **Storage**: a cold-archival tier and content-hash dedupe (keys are unique
  today, so reuse is URL-level only).
- **Delivery**: signed playback URLs for private media (all served media is
  public today).
- **Observability rollups**: transcode-latency, CDN cache-hit and storage-growth
  dashboards (Cloudflare reports cache-hit at the edge already).
- **Future kinds**: AI-generated image/video/audio and 3D/AR/VR assets.

## Governance

The registry is subject to the constitution's truth rule
(`docs/CONSTITUTION.md`, Article I.3): a `live`/`partial` row must point at a file
that exists, and a `planned` row must name no source. The test fails the build
otherwise. The operator view is the admin **Media** section.
