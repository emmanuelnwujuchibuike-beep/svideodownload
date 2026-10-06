# Fast Origin Transfer / media delivery — owner brief (2026-10-06)

> Owner-supplied, verbatim, so it survives context compaction. Record progress
> in the ledger at the end; do not edit the brief text.

My fast origin transfer is consuming a lot.

You are working on the Frenzsave codebase.

I want you to optimize the architecture specifically to reduce unnecessary Vercel Fast Origin Transfer (FOT), server bandwidth, API payload size, and overall media delivery cost while improving performance.

IMPORTANT:
Do NOT blindly rewrite working features. First inspect the existing architecture, identify where large files currently pass through Vercel, then make targeted changes.

PRIMARY GOAL

Large images, videos, generated AI media, wallpapers, downloads, and other media files should NOT unnecessarily pass through:

User → Vercel Function → Supabase/Storage → Vercel → User

Instead, use:

User → Vercel/API → direct storage/CDN URL → User

Vercel should primarily handle:

* HTML
* lightweight API responses
* authentication/session logic
* metadata
* database operations
* signed URL generation
* authorization
* lightweight server-side processing

Large media should be delivered directly from Supabase Storage or the appropriate storage/CDN provider.

⸻

1. AUDIT THE EXISTING CODEBASE FIRST

Before changing anything, inspect:

* Vercel API routes
* Serverless/Edge Functions
* Next.js route handlers
* Server actions
* Supabase Storage usage
* image upload/download logic
* video upload/download logic
* wallpaper delivery
* feed/reel media delivery
* user profile media
* AI generated images
* AI generated videos
* AI audio
* download functionality
* batch downloads
* signed URLs
* public URLs
* proxy endpoints
* fetch() calls that retrieve media
* API endpoints returning binary/blob/file responses
* API endpoints that fetch Supabase files and then return them to the browser
* image optimization/proxy systems
* admin dashboard polling
* realtime subscriptions
* large database queries

Search the codebase for patterns such as:

* fetch()
* Response(blob)
* arrayBuffer()
* Buffer
* Blob
* stream()
* Supabase Storage download()
* Supabase Storage createSignedUrl()
* Supabase Storage download URLs
* API routes returning files
* redirects to media
* server-side media proxying
* large JSON responses

Create a concise internal assessment before making changes.

Do not stop after finding one problem. Audit the complete media delivery path.

⸻

2. LARGE MEDIA MUST BYPASS VERCEL

For images/videos/files stored in Supabase Storage, prefer:

Browser → Supabase Storage

rather than:

Browser → Vercel → Supabase Storage

If a file is private, the Vercel API may authorize the request and return a short-lived signed URL.

Example architecture:

Browser
↓
Vercel API
↓
authorize user
↓
generate signed Supabase URL
↓
Browser downloads directly from Supabase Storage

The Vercel response should contain only lightweight metadata such as:

{
"url": "…",
"expiresAt": "…",
"fileName": "…",
"size": …
}

Do NOT download the actual file into the Vercel function unless there is a genuine server-side processing requirement.

⸻

3. REMOVE UNNECESSARY MEDIA PROXYING

Find endpoints like:

/api/download
/api/video
/api/image
/api/media
/api/wallpaper
/api/file
/api/stream
/api/ai/*
or equivalent routes.

If an endpoint currently does something similar to:

1. receive request
2. fetch large media from Supabase/external provider
3. load it into server memory
4. return it through Vercel

replace that architecture where safely possible.

Prefer:

1. authenticate/authorize
2. locate media metadata
3. generate signed/direct URL
4. return URL or redirect appropriately
5. browser fetches media directly

Do not expose private Supabase files publicly just to avoid Vercel bandwidth.

Use secure signed URLs where privacy/access control is required.

⸻

4. SUPABASE STORAGE ARCHITECTURE

Audit the existing buckets.

Organize media logically where appropriate, for example:

* wallpapers
* feed-media
* user-media
* profile-media
* downloads
* ai-images
* ai-videos
* ai-audio
* temporary-generation-files

Do NOT create unnecessary duplicate copies of the same media.

Store metadata in Supabase Database, while the actual large binary files remain in Storage.

Database records should contain information such as:

* storage path
* bucket
* MIME type
* file size
* width/height
* duration
* owner
* visibility
* created_at
* expiration if temporary
* processing status

Avoid storing large binary data directly in the database.

⸻

5. AI MEDIA

This is especially important for Frenz AI.

Audit all AI generation workflows including:

* image generation
* image-to-video
* text-to-video
* text-to-audio
* voice/audio generation
* lip sync
* face-related generation
* future AI generation providers

Do NOT allow a large generated file to unnecessarily travel:

AI provider → Vercel → browser

when a better architecture is possible.

Prefer:

AI provider
↓
storage
↓
database metadata
↓
browser receives direct/signed URL

If the AI provider gives a temporary result URL, determine whether the file needs to be copied to Supabase Storage for persistent access.

If copying is necessary, perform it intentionally and avoid downloading the same large file multiple times.

Do not duplicate AI media unnecessarily.

⸻

6. DOWNLOAD SYSTEM

Audit Frenzsave's downloader.

For large downloaded files, avoid:

User → Vercel → downloader provider → Vercel → User

where possible.

If the provider permits a secure redirect/direct URL, use that.

If server-side processing is genuinely required, keep the server operation lightweight and investigate whether the final file can be stored and served directly from Supabase/CDN rather than repeatedly passing through Vercel.

Do not break existing download functionality or provider protections.

⸻

7. WALLPAPERS

Optimize the Wallpapers section.

Images should load directly from storage/CDN.

Do not request every full-resolution image through a Vercel API.

Use:

* thumbnails for grids
* optimized dimensions
* lazy loading
* responsive images
* full-resolution files only when actually opened/downloaded

The initial page should load metadata/thumbnails rather than every original image.

⸻

8. FEED / REELS

Audit the public Feed/Reels system.

The API should return lightweight metadata rather than unnecessarily embedding huge media payloads.

For example:

{
"id": "…",
"caption": "…",
"thumbnailUrl": "…",
"mediaUrl": "…",
"duration": 15,
"aspectRatio": "16:9"
}

The actual video should be fetched directly from storage/CDN.

Do not proxy entire videos through Vercel.

Only preload/play media that is actually needed.

Preserve the existing UX requirements:

* smooth feed
* only the most visible video should autoplay
* avoid loading every video simultaneously
* 15-second chunks where already implemented
* safe-area support
* no blank/white loading experience

⸻

9. API RESPONSE OPTIMIZATION

Audit API responses for unnecessary payload size.

Reduce:

* duplicated fields
* unnecessary database columns
* huge nested objects
* full user profiles where only IDs are needed
* unnecessary historical records
* full media metadata when not required

Use pagination.

Use sensible limits.

Never return thousands of records to the browser when only 20–50 are required.

Prefer cursor-based pagination for large datasets where appropriate.

⸻

10. ADMIN DASHBOARD

Pay special attention to the Frenzsave Admin Dashboard.

Audit any polling/realtime logic for:

* visitors
* downloads
* users
* ad events
* AI jobs
* revenue
* rewards
* subscriptions
* errors
* platform statistics

Do not repeatedly download large datasets every second.

Where possible:

* use Supabase Realtime for actual event changes
* aggregate statistics server-side
* query only changed/recent data
* use lightweight counters
* paginate logs
* debounce/refetch intelligently
* avoid duplicate requests
* stop unnecessary polling when the dashboard/tab is not active

Preserve live functionality but reduce bandwidth and database load.

⸻

11. CACHING

Identify requests that can safely be cached.

Use appropriate caching for:

* public feed metadata
* wallpaper metadata
* public landing page data
* public configuration
* non-sensitive statistics
* static content

Do NOT cache private/user-specific data incorrectly.

Use appropriate Cache-Control behavior.

Avoid making everything dynamic if it doesn't need to be dynamic.

⸻

12. IMAGES

Do not send unnecessarily large images.

Use:

* thumbnails
* responsive sizes
* modern formats where supported
* appropriate quality
* lazy loading
* width/height metadata to prevent layout shifts

Do not repeatedly transform the same image on every request if a cached version can be reused.

⸻

13. SECURITY

Do NOT solve bandwidth problems by making everything public.

Maintain:

* authentication
* authorization
* Supabase RLS
* signed URLs for private files
* short expiration times where appropriate
* ownership checks
* download permissions
* Pro/Business/Max access restrictions
* reward/ad unlock restrictions

A user should not be able to modify a media URL or database ID and access another user's private media.

⸻

14. PERFORMANCE REQUIREMENTS

The optimization must improve or preserve:

* LCP
* page navigation speed
* PWA performance
* Android performance
* mobile data usage
* memory usage
* server response time

Do not introduce large client-side JavaScript bundles just to solve bandwidth problems.

Do not load an entire media library on page initialization.

Do not replace one bottleneck with another.

⸻

15. VERCEL FOT GOAL

The architectural goal is:

Small request:
User → Vercel → small response

Large media:
User → Supabase Storage/CDN

NOT:

User → Vercel → large media → User

The Vercel server should not unnecessarily download and re-upload large media.

⸻

16. DO NOT BREAK EXISTING FEATURES

Before changing each system:

* understand its current behavior
* preserve existing authentication
* preserve existing database relationships
* preserve existing UI
* preserve existing download behavior
* preserve existing AI job tracking
* preserve admin functionality
* preserve analytics
* preserve monetization/reward logic

Only change the underlying delivery architecture where beneficial.

Do not redesign the UI as part of this task unless required for the new media flow.

⸻

17. VALIDATION

After implementation:

1. Run the project's existing lint/type checks.
2. Run the build.
3. Check for broken imports.
4. Check all affected API routes.
5. Test authenticated media.
6. Test public media.
7. Test signed URLs.
8. Test expired signed URLs.
9. Test wallpaper loading.
10. Test feed/reel playback.
11. Test downloads.
12. Test AI-generated media.
13. Test mobile/PWA behavior.
14. Verify no large binary response is unnecessarily returned by Vercel API routes.
15. Check for accidental duplicate media downloads.

Where possible, measure response sizes before and after.

⸻

18. IMPORTANT IMPLEMENTATION RULE

Do not simply tell me what should be changed.

Actually inspect the codebase and implement the changes.

Before modifying files, identify the highest-impact FOT sources.

After implementation, give me a concise report containing:

Changed

* files/components modified
* media flows changed
* API routes changed

FOT improvements

* which large transfers no longer pass through Vercel
* which media now comes directly from Supabase Storage/CDN

Performance

* reduced API payloads
* reduced unnecessary requests
* caching improvements
* image/video loading improvements

Security

* signed URL changes
* authorization preserved

Validation

* lint result
* type-check result
* build result
* any remaining concerns

Do NOT claim FOT has been reduced by a specific percentage unless you actually measured it.

The most important principle is:

Vercel handles logic and lightweight responses. Supabase Storage/CDN handles large media delivery.

Implement this carefully without breaking Frenzsave.

---

# LEDGER

| Step | State | Note |
|---|---|---|
| Audit (every media path) | ✅ | production probe 10-06: post/reel/feed media come from R2/Supabase directly; idle + hidden ≈ 0 Vercel requests; downloads were the big FOT source |
| Downloads off Vercel | ✅ | 935aa45 · 8abcb8d — signed worker tickets, DOWNLOAD_DIRECT=1 on production; measured 2.8 s direct vs 9.7 s proxied, identical bytes; fallback to proxy on any worker failure |
| Size caps (Railway egress spike) | ✅ | 935aa45 · fd2674c · 66d4395 — free < 200 MB, Pro/Business uncapped; Telegram ≤ 60 MB on every path; bounded quota receipts |
| Admin download-outcome pushes | ✅ | f58c0aa — failed/cancelled no longer call Vercel |
| Save to device | ✅ | 935aa45 — direct storage fetch on the production origins, proxy fallback |
| Profile media on open | ✅ | 7ac594a — 67.8 MB → 2.4 MB |
| Open | ⏳ | /_next/image thumbnails (~50 per profile view, first-time ones transform on Vercel); 4 video posts need real thumbnails (production write — owner) ; AI audio save still proxies (owner rule: iOS must save, not open) |
