import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/* ── a fake Stream, driven per test ── */
const stream = vi.hoisted(() => ({
  video: null as null | { ready: boolean; failed: string | null; durationSeconds: number | null; width: number | null; height: number | null },
  mp4: null as null | { status: "ready" | "inprogress" | "error"; url: string | null },
  deleted: [] as string[],
}));
vi.mock("@/lib/media/stream", () => ({
  hasStream: true,
  copyAdVideoToStream: async () => "uid-1",
  getStreamVideo: async () => stream.video,
  ensureStreamMp4: async () => stream.mp4,
  deleteStreamVideo: async (uid: string) => void stream.deleted.push(uid),
  streamThumbnailUrl: (uid: string) => `https://stream.example/${uid}/thumb.jpg`,
}));
const notices = vi.hoisted(() => [] as string[]);
vi.mock("./ad-notify", () => ({ notifyAdvertiser: async (_db: unknown, _id: string, n: { kind: string }) => void notices.push(n.kind) }));
const swaps = vi.hoisted(() => [] as string[]);
vi.mock("./campaign-manage", () => ({ swapProcessedReplacement: async (_db: unknown, _c: string, id: string) => void swaps.push(id) }));
const activations = vi.hoisted(() => [] as string[]);
vi.mock("./server", () => ({ activateCampaign: async (_db: unknown, id: string) => (activations.push(id), { ok: true }) }));
vi.mock("./advertiser-server", () => ({ STAGING_BUCKET: "ad-creatives-staging", posterPath: (p: string) => p.replace(/\.[a-z0-9]+$/, "-poster.webp") }));

import { advanceVideoProcessing, PROCESSING_TIMEOUT_MS } from "./media-processing";
import { containBox, fitWithin, imageNeedsOptimizing, specOf, videoNeedsProcessing, withinUploadCaps } from "./media-spec";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** A minimal Supabase stand-in: rows by table, the chain the processing code uses. */
function fakeDb(rows: Record<string, Record<string, unknown>[]>) {
  const removed: string[] = [];
  const db = {
    removed,
    rows,
    storage: { from: () => ({ remove: async (paths: string[]) => (removed.push(...paths), { error: null }) }) },
    from(table: string) {
      const filters: [string, unknown][] = [];
      let patch: Record<string, unknown> | null = null;
      const match = () => (rows[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      const q = {
        select: () => q,
        update: (p: Record<string, unknown>) => ((patch = p), q),
        eq: (k: string, v: unknown) => (filters.push([k, v]), q),
        neq: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        then: (res: (v: { data: unknown; error: null }) => void) => {
          const hit = match();
          if (patch) for (const r of hit) Object.assign(r, patch);
          res({ data: hit, error: null });
        },
      };
      return q;
    },
  };
  return db;
}

const creative = (over: Record<string, unknown> = {}) => ({
  id: "cr-1",
  campaign_id: "camp-1",
  storage_path: "u/camp-1/cr-1.mp4",
  status: "active",
  processing_status: "processing",
  processing_kind: "draft",
  processing_error: null,
  stream_uid: "uid-1",
  processing_started_at: new Date().toISOString(),
  media_url: null,
  thumbnail_url: null,
  moderation_status: "passed",
  validation_status: "pending",
  validation_errors: [],
  format_code: "REWARD_VIDEO",
  ...over,
});

beforeEach(() => {
  stream.video = null;
  stream.mp4 = null;
  stream.deleted = [];
  notices.length = 0;
  swaps.length = 0;
  activations.length = 0;
});

describe("the four sizes (media-spec)", () => {
  const spec = specOf({ width: 1280, height: 800, max_width: 2160, max_height: 3840, max_file_bytes: 10 * 1024 * 1024, max_upload_bytes: 200 * 1024 * 1024, delivery_long_edge: 1280, image_quality: 82, max_duration_seconds: 30 });

  it("a large landscape image for a 320×200 slot is reduced with the SAME proportions, never enlarged", () => {
    expect(fitWithin(1920, 1080, 1280)).toEqual({ width: 1280, height: 720 });
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(640, 400, 1280)).toEqual({ width: 640, height: 400 }); // smaller: untouched
    const r = fitWithin(3001, 1999, 1280);
    expect(Math.abs(r.width / r.height - 3001 / 1999)).toBeLessThan(0.01); // proportions kept to rounding
    expect(r.width % 2 + (r.height % 2)).toBe(0); // even, for encoders
  });

  it("portrait in a landscape slot, and landscape in a portrait slot, are shown whole (contain), with space around", () => {
    const portraitInCard = containBox(1080, 1920, 320 / 200);
    expect(portraitInCard.height).toBe(1);
    expect(portraitInCard.width).toBeCloseTo((1080 / 1920) / (320 / 200), 5);
    expect(portraitInCard.letterboxed).toBe(true);
    const landscapeInStory = containBox(1920, 1080, 9 / 16);
    expect(landscapeInStory.width).toBe(1);
    expect(landscapeInStory.letterboxed).toBe(true);
    expect(containBox(1280, 800, 1.6).letterboxed).toBe(false);
  });

  it("upload caps are orientation-agnostic: 4K landscape passes 2160×3840, 8K does not", () => {
    expect(withinUploadCaps(3840, 2160, 2160, 3840)).toBe(true);
    expect(withinUploadCaps(2160, 3840, 2160, 3840)).toBe(true);
    expect(withinUploadCaps(7680, 4320, 2160, 3840)).toBe(false);
  });

  it("what needs work: an oversized image is optimized, a small one is left exactly as made; a 4K video is transcoded", () => {
    expect(imageNeedsOptimizing(4000, 3000, 2_000_000, "image/jpeg", spec)).toBe(true);
    expect(imageNeedsOptimizing(1200, 750, 150_000, "image/jpeg", spec)).toBe(false);
    expect(imageNeedsOptimizing(1200, 750, 900_000, "image/png", spec)).toBe(true); // heavy PNG → WebP
    expect(imageNeedsOptimizing(1200, 750, 20 * 1024 * 1024, "image/webp", spec)).toBe(true); // over the served size
    expect(videoNeedsProcessing(3840, 2160, 40_000_000, spec)).toBe(true);
    expect(videoNeedsProcessing(1280, 720, 4_000_000, spec)).toBe(false);
    expect(videoNeedsProcessing(1280, 720, 15 * 1024 * 1024, spec)).toBe(true); // too heavy to serve as is
  });

  it("a database without 0208 still works: delivery limits default", () => {
    const old = specOf({ max_width: 2160, max_height: 3840, max_file_bytes: 1000 });
    expect(old.deliveryLongEdge).toBe(1280);
    expect(old.imageQuality).toBe(82);
    expect(old.maxUploadBytes).toBe(1000); // no larger uploads until the migration exists
  });
});

describe("video processing (Cloudflare Stream) moves forward safely", () => {
  it("still transcoding → stays pending; nothing is published", async () => {
    const db = fakeDb({ ad_creatives: [creative()], ad_formats: [{ code: "REWARD_VIDEO", max_duration_seconds: 30 }] });
    stream.video = { ready: false, failed: null, durationSeconds: null, width: null, height: null };
    expect((await advanceVideoProcessing(db as never, "cr-1")).state).toBe("processing");
    expect(db.rows.ad_creatives![0]!.validation_status).toBe("pending");
  });

  it("ready → the MP4 is published, the staging copies go, and a paid draft is activated", async () => {
    const db = fakeDb({ ad_creatives: [creative()], ad_formats: [{ code: "REWARD_VIDEO", max_duration_seconds: 30 }], ad_campaigns: [{ id: "camp-1", status: "paid" }] });
    stream.video = { ready: true, failed: null, durationSeconds: 12, width: 3840, height: 2160 };
    stream.mp4 = { status: "ready", url: "https://stream.example/uid-1/downloads/default.mp4" };
    const out = await advanceVideoProcessing(db as never, "cr-1");
    expect(out.state).toBe("ready");
    const row = db.rows.ad_creatives![0]!;
    expect(row.media_url).toBe("https://stream.example/uid-1/downloads/default.mp4");
    expect(row.validation_status).toBe("valid");
    expect(row.processing_status).toBe("ready");
    expect(db.removed).toContain("u/camp-1/cr-1.mp4.checked");
    expect(activations).toEqual(["camp-1"]);
  });

  it("a replacement is swapped in only when ready — the live creative served until then", async () => {
    const db = fakeDb({ ad_creatives: [creative({ processing_kind: "replacement", status: "staged" })], ad_formats: [{ code: "REWARD_VIDEO", max_duration_seconds: 30 }] });
    stream.video = { ready: true, failed: null, durationSeconds: 10, width: 1080, height: 1920 };
    stream.mp4 = { status: "inprogress", url: null };
    expect((await advanceVideoProcessing(db as never, "cr-1")).state).toBe("processing");
    expect(swaps).toEqual([]);
    stream.mp4 = { status: "ready", url: "https://stream.example/uid-1.mp4" };
    expect((await advanceVideoProcessing(db as never, "cr-1")).state).toBe("ready");
    expect(swaps).toEqual(["cr-1"]);
  });

  it("over the admin's duration (reward video) → failed, never trimmed to fit", async () => {
    const db = fakeDb({ ad_creatives: [creative()], ad_formats: [{ code: "REWARD_VIDEO", max_duration_seconds: 15 }] });
    stream.video = { ready: true, failed: null, durationSeconds: 21, width: 1920, height: 1080 };
    const out = await advanceVideoProcessing(db as never, "cr-1");
    expect(out).toMatchObject({ state: "failed", error: "video_too_long" });
    expect(db.rows.ad_creatives![0]!.validation_status).toBe("invalid");
    expect(stream.deleted).toEqual(["uid-1"]);
  });

  it("a Stream error, or an hour without finishing, fails it — and a failed replacement tells the advertiser", async () => {
    const db = fakeDb({ ad_creatives: [creative({ processing_kind: "replacement" })], ad_formats: [] });
    stream.video = { ready: false, failed: "ERR_MALFORMED", durationSeconds: null, width: null, height: null };
    expect((await advanceVideoProcessing(db as never, "cr-1")).error).toBe("processing_failed");
    expect(notices).toEqual(["creative_rejected"]);

    const old = new Date(Date.now() - PROCESSING_TIMEOUT_MS - 1000).toISOString();
    const db2 = fakeDb({ ad_creatives: [creative({ processing_started_at: old })], ad_formats: [] });
    expect((await advanceVideoProcessing(db2 as never, "cr-1")).error).toBe("processing_timeout");
  });

  it("refused before transcoding (content check) → the status says failed, so the page stops waiting", async () => {
    const db = fakeDb({ ad_creatives: [creative({ processing_status: "none", validation_status: "blocked", validation_errors: ["content_rejected"] })] });
    expect(await advanceVideoProcessing(db as never, "cr-1")).toMatchObject({ state: "failed", error: "content_rejected" });
  });
});

describe("the upload answers fast and never hangs (owner: 'check and load in less than 3 seconds')", () => {
  const adv = code("lib/ads-platform/advertiser-server.ts");
  it("a draft answers once its BYTES pass; the content check and publish run after the response", () => {
    expect(adv).toContain('if (kind === "draft") {');
    expect(adv).toContain("after(async () => {");
    expect(adv).toContain("const r = await publishAll().catch(() => null);");
    // held until checked: pending + review, both refused by activation
    expect(adv).toContain('validation_status: "pending", validation_errors: [], validated_at: now }, { moderation_status: "review", moderation_labels: ["moderation_pending"] }');
    // replacements keep the synchronous path
    expect(adv).toContain("  return publishAll();\n}");
  });
  it("independent storage steps run together, and a stalled range read times out", () => {
    expect(adv).toContain("await Promise.all([staging.copy(cr.storage_path, locked), staging.copy(poster, lockedPoster)]);");
    expect(adv).toContain("signal: AbortSignal.timeout(8000)");
  });
  it("moderation columns are written apart from the verdict (a database without 0206 cannot strand a creative)", () => {
    expect(adv).toContain("async function writeCreative(");
    expect(adv).not.toMatch(/validation_status: "valid", validation_errors: \[\], validated_at: now,\n\s*moderation_status/);
  });
  it("submit waits briefly for a creative still being checked, then says so", () => {
    expect(adv).toContain('if (tries === 6) refuse("creative_checking", 409);');
  });
});

describe("one preparation for every upload, off the main thread", () => {
  it("new creatives and replacements share prepareCreativeFile and waitForProcessing", () => {
    for (const f of ["features/ads-platform/creative-step.tsx", "features/ads-platform/dashboard/campaign-detail.tsx"]) {
      expect(code(f), f).toContain("prepareCreativeFile(");
      expect(code(f), f).toContain("waitForProcessing(");
    }
  });
  it("the resize runs in a worker; the header is read before any decode (pixel-bomb guard)", () => {
    const o = code("features/ads-platform/image-optimizer.ts");
    expect(o).toContain('new Worker(new URL("./optimize-image.worker.ts", import.meta.url))');
    expect(o).toContain("if (dims.width * dims.height > MAX_DECODE_PIXELS) return { error: \"decode_too_large\" };");
    const w = code("features/ads-platform/optimize-image.worker.ts");
    expect(w).toContain('imageOrientation: "from-image"');
    expect(w).toContain('type: "image/webp"');
  });
  it("transcoding is used only when Stream AND migration 0208 exist", () => {
    expect(code("lib/ads-platform/server.ts")).toContain("videoProcessing: hasStream && f.delivery_long_edge !== undefined,");
  });
});

describe("migration 0208 (also run twice on PGlite, with a mutant)", () => {
  const sql = code("supabase/migrations/0208_ad_media_fit.sql");
  it("is additive and idempotent", () => {
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|truncate/i);
    // every add column is guarded
    expect((sql.match(/add column if not exists/g) ?? []).length).toBe((sql.match(/add column/g) ?? []).length);
  });
  it("bounds the admin's numbers and the processing states", () => {
    expect(sql).toContain("check (delivery_long_edge between 240 and 3840)");
    expect(sql).toContain("check (image_quality between 40 and 100)");
    expect(sql).toContain("check (processing_status in ('none', 'processing', 'ready', 'failed'))");
  });
  it("the catalog hands the browser the delivery limits", () => {
    expect(sql).toContain("'delivery_long_edge', f.delivery_long_edge, 'image_quality', f.image_quality,");
  });
});
