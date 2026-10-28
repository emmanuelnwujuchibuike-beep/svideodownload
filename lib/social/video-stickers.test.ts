import { readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { videoStickerId, videoStickerUuid } from "./video-stickers";

/**
 * Video stickers (0303, owner 2026-10-28). The id travels as `vs:<uuid>` in the emoji sticker's slots, so parsing it
 * strictly is what keeps junk out of comments and libraries; the create route only records the member's OWN uploads.
 */
describe("video sticker ids", () => {
  const U = "0f8b2b9e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
  it("round-trips a uuid and refuses anything else", () => {
    expect(videoStickerUuid(videoStickerId(U))).toBe(U);
    expect(videoStickerUuid("fire")).toBeNull();
    expect(videoStickerUuid("vs:not-a-uuid")).toBeNull();
    expect(videoStickerUuid(`vs:${U}' or 1=1`)).toBeNull();
    expect(videoStickerUuid(null)).toBeNull();
  });
});

let user: { id: string } | null = { id: "11111111-1111-4111-8111-111111111111" };
const inserted: unknown[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/lib/rate-limit", () => ({ trackLimiter: { limit: async () => ({ success: true }) } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: (row: unknown) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "22222222-2222-4222-8222-222222222222" }, error: null }) }) };
      },
      upsert: async () => ({ error: null }),
    }),
  }),
}));

const route = await import("@/app/api/stickers/video/route");
const SB = "https://x.supabase.co/storage/v1/object/public/post-media";
const body = (over: Record<string, unknown> = {}) => ({
  videoUrl: `${SB}/${user!.id}/videos/1730000000000-abc.mp4`,
  posterUrl: `${SB}/${user!.id}/images/1730000000000-abc.jpg`,
  durationMs: 3000,
  width: 320,
  height: 320,
  mime: "video/mp4",
  ...over,
});
const post = (b: unknown) => route.POST(new Request("https://frenzsave.com/api/stickers/video", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }));

describe("POST /api/stickers/video", () => {
  beforeEach(() => {
    inserted.length = 0;
    user = { id: "11111111-1111-4111-8111-111111111111" };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  });

  it("records the member's own clip and poster, as a vs: id", async () => {
    const r = await post(body());
    const j = (await r.json()) as { sticker?: { id: string } };
    expect(r.status).toBe(200);
    expect(j.sticker?.id).toBe("vs:22222222-2222-4222-8222-222222222222");
    expect(inserted).toHaveLength(1);
  });

  it("teeth: someone else's upload, another site, or a clip over 3 s is refused and nothing is recorded", async () => {
    expect((await post(body({ videoUrl: `${SB}/99999999-9999-4999-8999-999999999999/videos/1730000000000-abc.mp4` }))).status).toBe(400);
    expect((await post(body({ videoUrl: "https://evil.example/a.mp4" }))).status).toBe(400);
    expect((await post(body({ durationMs: 9000 }))).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("a comment or a library save only takes a video sticker that exists and isn't hidden", () => {
    for (const f of ["app/api/posts/[id]/comments/route.ts", "app/api/stickers/route.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("videoStickerUsable(parsed.data.sticker)");
    }
    expect(readFileSync("lib/social/video-stickers-server.ts", "utf8")).toContain('.is("hidden_at", null)');
  });
});
