/**
 * The Enterprise Media Platform, described by itself.
 *
 * The Media brief asks for a Media Gateway, Upload Service, Transcoding, Image/
 * Video/Audio processing, a Thumbnail service, a Media AI service, Streaming, a
 * CDN Manager, a Storage Manager, a Media Registry, analytics and monitoring —
 * plus a Media Pipeline™, Media Intelligence™ and a Media Registry™. As with the
 * Search, Design, Engineering and Data platforms before it, the substrate ALREADY
 * EXISTS — deeply, because this product IS a media pipeline — and this file is the
 * honest map over it, not a second implementation:
 *
 *   - Cloudflare Stream ABR/HLS + auto multi-language captions (`lib/media/stream.ts`),
 *   - R2 object storage with presigned direct upload + immutable CDN caching
 *     (`lib/storage/*`),
 *   - the yt-dlp/ffmpeg extraction + transcode worker (`lib/worker.ts`, `server/*`),
 *   - poster/thumbnail + waveform generation, HLS playback tuning, playback QoE
 *     telemetry and live health probes (`lib/media/*`).
 *
 * So every row points at the REAL provider of a capability, staged honestly. The
 * enterprise pieces that genuinely do not exist yet — background removal,
 * upscaling, object/face detection, smart cropping, AI enhancement, OCR, virus
 * scanning, cold archival, content-hash dedupe, 3D/AR/VR — are `planned`, never
 * implied as done.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `media-platform.test.ts`: a `live`/`partial` row must point at a
 * file that exists; a `planned` row must not pretend to.
 */

export type MediaStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a subset of the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every source-backed catalogue row satisfies. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: MediaStatus;
}

/* ─────────────────────────────── services ───────────────────────────────────
 * The brief's Backend Architecture list, mapped to the real provider of each
 * capability. In a modular monolith a "service" is the module that owns a
 * capability, not a separate process.
 */

export interface MediaService extends CatalogueEntry {
  name: string;
  capability: string;
  note?: string;
}

export const MEDIA_SERVICES: MediaService[] = [
  { id: "upload", name: "Upload Service", source: "lib/storage/client-upload.ts", status: "live", capability: "Presigned direct-to-R2 (or Supabase) browser upload; prefetchable plan; survives a mid-PUT service-worker reload.", note: "Bytes never pass through our server on R2." },
  { id: "storage-router", name: "Storage Manager", source: "lib/storage/index.ts", status: "live", capability: "Routes each asset to the right backend, builds owner-scoped collision-resistant keys, plans client uploads." },
  { id: "object-store", name: "Object Storage (R2)", source: "lib/storage/r2.ts", status: "live", capability: "S3-compatible Cloudflare R2 — zero-egress, CDN-served; presigned PUT signing server-side." },
  { id: "stream", name: "Streaming & Transcode (Cloudflare Stream)", source: "lib/media/stream.ts", status: "live", capability: "Adaptive-bitrate HLS with an auto quality ladder (AV1/H.265/H.264), direct upload, copy-from-URL, auto captions, thumbnails and a completion webhook." },
  { id: "hls", name: "Adaptive Playback", source: "lib/media/hls.ts", status: "live", capability: "Native HLS on Safari/iOS; hls.js elsewhere (dynamically imported), level-capped to the element, segments parsed off-thread." },
  { id: "extraction", name: "Extraction Pipeline", source: "server/extractors/index.ts", status: "live", capability: "Source extraction across 11 platforms (yt-dlp + Apify + direct HTTP) with a quality ladder." },
  { id: "ingest", name: "Ingest & Store Service", source: "server/services/store-media-service.ts", status: "live", capability: "Downloads a source on the worker (no serverless ceiling), size-guards, stores to R2/Supabase and records the asset." },
  { id: "transcode-worker", name: "Transcode Worker", source: "lib/worker.ts", status: "live", capability: "Frontend/worker split — heavy yt-dlp/ffmpeg run on a Docker worker, proxied from the Vercel tier with a shared secret." },
  { id: "poster", name: "Thumbnail / Poster Service", source: "lib/media/video-poster.ts", status: "live", capability: "Generates and re-hosts video posters/thumbnails onto our own CDN." },
  { id: "captions", name: "Caption / Subtitle Service", source: "lib/media/stream.ts", status: "live", capability: "Cloudflare-generated captions (English + French by default), exposed as HLS subtitle renditions — rendered natively, no player changes." },
  { id: "webhook", name: "Processing Webhook", source: "lib/media/stream-webhook.ts", status: "live", capability: "Signed Cloudflare Stream callback on processing-complete/error — re-requests captions once the video is genuinely ready." },
  { id: "metrics", name: "Playback Analytics", source: "lib/media/playback-metrics.ts", status: "live", capability: "Fire-and-forget QoE beacon: time-to-first-frame, rebuffers, dropped frames, bitrate, source path." },
  { id: "moderation", name: "Media Moderation", source: "lib/moderation", status: "live", capability: "Reports, AI assessments and trust scoring over user media." },
  { id: "media-ai", name: "Media AI Service", source: "", status: "planned", capability: "Enhancement/detection stack (background removal, upscaling, object/face detection, smart crop, tagging).", note: "Captions/subtitles ship today via Cloudflare Stream; the enhancement + detection stack is deferred — it needs a GPU inference tier the app doesn't run." },
];

/* ─────────────────────────────── storage tiers ──────────────────────────────
 * The brief's Media Storage section — the tiers we actually run, plus the
 * lifecycle rules, and the honestly-absent cold tier.
 */

export interface StorageTier extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const STORAGE_TIERS: StorageTier[] = [
  { id: "hot-r2", name: "Hot object storage (R2)", source: "lib/storage/r2.ts", status: "live", description: "Large media — video, audio, reels, story media. Zero-egress, CDN-fronted." },
  { id: "managed-video", name: "Managed video store (Stream)", source: "lib/media/stream.ts", status: "live", description: "Cloudflare Stream holds the ABR renditions of a video alongside the R2 original." },
  { id: "supabase-images", name: "Supabase Storage", source: "lib/storage/index.ts", status: "partial", description: "Small profile/cover images, and the fallback backend before R2 is provisioned.", note: "Deliberately a fallback + small-image tier; the 5 GB egress cap was hit once, which is why large media lives on R2." },
  { id: "immutable-lifecycle", name: "Immutable versioning", source: "lib/storage/cache-control.ts", status: "live", description: "Every key is unique, so bytes at a URL never change — editing produces a new key/URL. Version-by-URL, nothing to invalidate." },
  { id: "cold-archival", name: "Cold archival tier", source: "", status: "planned", description: "Move rarely-accessed originals to an infrequent-access class.", note: "R2 has no lifecycle tiering configured yet; hot is the only tier. Worth it only once storage growth justifies the operational complexity." },
  { id: "content-dedupe", name: "Content-hash dedupe", source: "", status: "planned", description: "Collapse byte-identical uploads to one stored object.", note: "Keys are unique today (URL-level reuse only). Hash dedupe needs an ingest-time digest index." },
];

/* ─────────────────────────────── pipeline stages ────────────────────────────
 * The Media Pipeline™ — the processing steps, each mapped to real code or an
 * honest `planned`.
 */

export interface PipelineStage extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "extract", name: "Source extraction", source: "server/extractors/index.ts", status: "live", description: "Resolve and pull the source media across supported platforms." },
  { id: "validate", name: "Validation & size guard", source: "server/services/store-media-service.ts", status: "live", description: "Type/extension mapping and an early streamed size ceiling before anything is stored." },
  { id: "transcode-abr", name: "ABR transcode", source: "lib/media/stream.ts", status: "live", description: "Cloudflare Stream produces the adaptive quality ladder and modern codecs." },
  { id: "poster", name: "Thumbnail / poster generation", source: "lib/media/video-poster.ts", status: "live", description: "Extract a poster frame and re-host it on our CDN." },
  { id: "captions", name: "Caption / subtitle extraction", source: "lib/media/stream.ts", status: "live", description: "Auto-generated multi-language captions, exposed as HLS renditions." },
  { id: "waveform", name: "Audio waveform", source: "lib/media/comment-recording.ts", status: "live", description: "Peak waveform generated for voice notes/audio at record time." },
  { id: "image-adjust", name: "Image adjust & orientation", source: "lib/media/photo-adjust.ts", status: "partial", description: "Client-side crop/rotate/adjust.", note: "User-driven; automatic server-side EXIF orientation + colour-profile normalisation on ingest is not wired." },
  { id: "moderation", name: "Content moderation", source: "lib/moderation", status: "live", description: "AI assessment + report/appeal flow over uploaded media." },
  { id: "webhook-complete", name: "Processing-complete signal", source: "lib/media/stream-webhook.ts", status: "live", description: "Reliable notification that transcode finished, so downstream steps aren't guessed." },
  { id: "virus-scan", name: "Virus / malware scan", source: "", status: "planned", description: "Scan uploads before they are served." },
  { id: "transcription", name: "Speech transcription", source: "", status: "planned", description: "Full speech-to-text beyond caption tracks.", note: "Caption tracks exist via Stream; a separate transcript store/search index is deferred." },
  { id: "ocr", name: "OCR", source: "", status: "planned", description: "Text extraction from images and video frames." },
  { id: "scene-detection", name: "Scene / object / face detection", source: "", status: "planned", description: "Frame analysis, policy-gated.", note: "Needs a GPU inference tier; face detection additionally needs an explicit consent policy." },
  { id: "watermark", name: "Watermarking", source: "", status: "planned", description: "Overlay attribution/ownership marks where policy applies." },
  { id: "ai-enhance", name: "AI enhancement", source: "", status: "planned", description: "Upscaling, denoise, background removal." },
];

/* ─────────────────────────────── delivery ───────────────────────────────────
 * The brief's Content Delivery section — CDN, edge caching and adaptive delivery.
 */

export interface DeliveryCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const DELIVERY_CAPABILITIES: DeliveryCapability[] = [
  { id: "cdn-cache", name: "Global CDN + immutable caching", source: "lib/storage/cache-control.ts", status: "live", description: "Cloudflare fronts R2/Vercel; every media object is served `public, max-age=1y, immutable`. Fixed a real bug where missing Cache-Control re-billed egress on every view." },
  { id: "abr-delivery", name: "Adaptive-bitrate delivery", source: "lib/media/hls.ts", status: "live", description: "HLS from the global edge; start level chosen by bandwidth for a fast first frame." },
  { id: "network-aware", name: "Network-aware delivery", source: "lib/media/network-conditions.ts", status: "live", description: "Adapts behaviour to the observed connection (data-saver / slow networks)." },
  { id: "device-aware", name: "Device-aware delivery", source: "lib/media/hls.ts", status: "live", description: "Never fetches a rendition taller than the player element — no 4K into a phone." },
  { id: "signed-upload", name: "Signed upload URLs", source: "lib/storage/r2.ts", status: "live", description: "Short-lived presigned PUT URLs so clients upload directly without seeing credentials." },
  { id: "poster-rehost", name: "CDN poster re-hosting", source: "lib/media/poster-host.ts", status: "live", description: "External thumbnails are copied onto our own CDN so playback never depends on a third-party host." },
  { id: "prefetch", name: "Predictive prefetch", source: "lib/media/prefetch-image.ts", status: "live", description: "Warms the next media so open feels instant." },
  { id: "signed-playback", name: "Signed playback URLs", source: "", status: "planned", description: "Token-gated delivery for private media.", note: "All served media is public today; private-media tokening is deferred until a private surface needs it." },
];

/* ─────────────────────────────── media AI ───────────────────────────────────
 * Media Intelligence™ — the AI capabilities matrix, answered honestly. Live/partial
 * name the code; the rest are `planned` with no fabricated source.
 */

export interface MediaAiCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const MEDIA_AI: MediaAiCapability[] = [
  { id: "captions", name: "Automatic captions & subtitles", source: "lib/media/stream.ts", status: "live", description: "Cloudflare-generated multi-language captions — the accessibility win, shipping today." },
  { id: "moderation", name: "AI content moderation", source: "lib/moderation", status: "live", description: "Automated assessment feeding the report/appeal queue." },
  { id: "language", name: "Language detection & translation", source: "lib/i18n", status: "partial", description: "UI localisation + multi-language captions.", note: "Interface + caption languages are real; per-asset spoken-language detection and on-the-fly media translation are not." },
  { id: "bg-removal", name: "Background removal", source: "", status: "planned", description: "Cut the subject from its background." },
  { id: "upscaling", name: "Upscaling / enhancement", source: "", status: "planned", description: "Super-resolution for image and video." },
  { id: "object-detection", name: "Object / face detection", source: "", status: "planned", description: "Policy-gated frame analysis." },
  { id: "smart-crop", name: "Smart cropping", source: "", status: "planned", description: "Saliency-aware framing for thumbnails and responsive art." },
  { id: "ai-tagging", name: "AI tagging & semantic analysis", source: "", status: "planned", description: "Auto tags + embeddings for media search/recommendation." },
  { id: "tts", name: "Text-to-speech", source: "", status: "planned", description: "Synthesised voice-over." },
  { id: "ai-generation", name: "AI media generation", source: "", status: "planned", description: "Generated images/video/audio.", note: "No generation surface exists; the `smart` module is concept-stage in the Product Genome." },
];

/* ─────────────────────────────── observability ──────────────────────────────
 * The brief's Observability + Analytics sections — the media signals we actually
 * collect.
 */

export interface MediaSignal extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const MEDIA_OBSERVABILITY: MediaSignal[] = [
  { id: "playback-qoe", name: "Playback quality (QoE)", source: "lib/media/playback-metrics.ts", status: "live", description: "Time-to-first-frame, rebuffer count, dropped frames and bitrate, per source path." },
  { id: "stream-health", name: "Stream health probe", source: "lib/media/stream.ts", status: "live", description: "Live reachability + credential check against the Cloudflare Stream API, surfaced at /api/health." },
  { id: "proxy-egress", name: "Proxy bandwidth & egress", source: "server/proxy/proxy-manager.ts", status: "live", description: "Residential-proxy spend and per-platform bandwidth, with a budget alert." },
  { id: "network", name: "Network conditions", source: "lib/media/network-conditions.ts", status: "live", description: "Observed connection quality used to shape delivery." },
  { id: "health", name: "Subsystem health", source: "app/api/health", status: "live", description: "Liveness + media subsystem health for ops." },
  { id: "transcode-latency", name: "Transcode latency dashboard", source: "", status: "planned", description: "End-to-end processing time per job as an operator rollup." },
  { id: "cache-hit", name: "CDN cache-hit rollup", source: "", status: "planned", description: "Aggregate hit-rate and egress trend.", note: "Cloudflare reports this at the edge; an in-app rollup is deferred." },
  { id: "storage-growth", name: "Storage growth rollup", source: "", status: "planned", description: "Bytes stored over time, per tier." },
];

/* ─────────────────────────────── supported media ────────────────────────────
 * The brief's SUPPORTED MEDIA taxonomy. Each kind names the service that handles
 * it (an id in MEDIA_SERVICES); the future kinds are `planned` with none.
 */

export interface SupportedMedia {
  id: string;
  label: string;
  /** The MEDIA_SERVICES id that handles it. Empty ONLY when `planned`. */
  handledBy: string;
  status: MediaStatus;
  note?: string;
}

export const SUPPORTED_MEDIA: SupportedMedia[] = [
  { id: "image", label: "Images", handledBy: "storage-router", status: "live" },
  { id: "video", label: "Video", handledBy: "stream", status: "live" },
  { id: "audio", label: "Audio", handledBy: "storage-router", status: "live" },
  { id: "voice", label: "Voice messages", handledBy: "upload", status: "live", note: "Recorded with a live waveform, uploaded as audio." },
  { id: "animated", label: "Animated images (GIF)", handledBy: "storage-router", status: "live" },
  { id: "document", label: "Documents", handledBy: "upload", status: "live" },
  { id: "thumbnail", label: "Thumbnails / posters", handledBy: "poster", status: "live" },
  { id: "profile", label: "Profile photos", handledBy: "storage-router", status: "live" },
  { id: "cover", label: "Cover photos", handledBy: "storage-router", status: "live" },
  { id: "marketplace", label: "Marketplace galleries", handledBy: "", status: "planned", note: "Image handling exists, but the Marketplace surface is concept-stage in the Product Genome." },
  { id: "ai-image", label: "AI-generated images", handledBy: "", status: "planned" },
  { id: "ai-video", label: "AI-generated video", handledBy: "", status: "planned" },
  { id: "ai-audio", label: "AI-generated audio", handledBy: "", status: "planned" },
  { id: "3d", label: "3D assets", handledBy: "", status: "planned" },
  { id: "ar", label: "AR assets", handledBy: "", status: "planned" },
  { id: "vr", label: "VR assets", handledBy: "", status: "planned" },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getMediaServices(): MediaService[] {
  return MEDIA_SERVICES;
}
export function getStorageTiers(): StorageTier[] {
  return STORAGE_TIERS;
}
export function getPipelineStages(): PipelineStage[] {
  return PIPELINE_STAGES;
}
export function getDeliveryCapabilities(): DeliveryCapability[] {
  return DELIVERY_CAPABILITIES;
}
export function getMediaAi(): MediaAiCapability[] {
  return MEDIA_AI;
}
export function getMediaObservability(): MediaSignal[] {
  return MEDIA_OBSERVABILITY;
}
export function getSupportedMedia(): SupportedMedia[] {
  return SUPPORTED_MEDIA;
}

/** Everything source-backed, for the platform-health summary + teeth. */
export function mediaPlatformEntries(): CatalogueEntry[] {
  return [
    ...MEDIA_SERVICES,
    ...STORAGE_TIERS,
    ...PIPELINE_STAGES,
    ...DELIVERY_CAPABILITIES,
    ...MEDIA_AI,
    ...MEDIA_OBSERVABILITY,
  ];
}
