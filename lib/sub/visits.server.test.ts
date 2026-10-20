import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Profile visits and exclusive-post views (0265, step 21): one per visitor per day, never the owner's own,
 * a guest only as a daily one-way hash, and the top posts ranked by views.
 */
let db: FakeDb;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = U(1);
const FAN = U(2);
const P1 = U(10);
const P2 = U(11);

beforeEach(() => {
  db = fakeDb({
    profile_visits: [],
    sub_post_views: [],
    sub_posts: [
      { id: P1, creator_id: OWNER, created_at: "2026-10-01T00:00:00Z", blur_preview: null },
      { id: P2, creator_id: OWNER, created_at: "2026-10-02T00:00:00Z", blur_preview: "data:image/webp;base64,AA" },
    ],
    sub_post_media: [
      { post_id: P1, media_kind: "image", idx: 0 },
      { post_id: P2, media_kind: "video", idx: 0 },
    ],
  });
  db.unique.profile_visits = [["profile_id", "visitor_key", "day"]];
  db.unique.sub_post_views = [["post_id", "viewer_id", "day"]];
});

describe("profile visits", () => {
  it("counts a visitor once a day and never the owner", async () => {
    const { recordProfileVisit, profileVisitsSince } = await import("./visits");
    await recordProfileVisit(OWNER, FAN, null);
    await recordProfileVisit(OWNER, FAN, null);
    await recordProfileVisit(OWNER, OWNER, null);
    expect(db.tables.profile_visits).toHaveLength(1);
    expect(await profileVisitsSince(OWNER, "2000-01-01")).toBe(1);
  });

  it("a guest is a daily one-way hash — never the address itself, and a different key the next day", async () => {
    const { guestVisitorKey } = await import("./visits");
    const k1 = guestVisitorKey("203.0.113.9", "UA", "2026-10-19")!;
    expect(k1).toMatch(/^g:[0-9a-f]{32}$/);
    expect(k1).not.toContain("203.0.113.9");
    expect(guestVisitorKey("203.0.113.9", "UA", "2026-10-20")).not.toBe(k1);
    expect(guestVisitorKey(null, "UA")).toBeNull();
  });
});

describe("exclusive post views", () => {
  it("one per viewer per day, never the creator, ranked by views with the post's kind", async () => {
    const { recordSubPostView, topSubPostsSince } = await import("./visits");
    await recordSubPostView(P2, OWNER, FAN);
    await recordSubPostView(P2, OWNER, FAN);
    await recordSubPostView(P2, OWNER, U(3));
    await recordSubPostView(P1, OWNER, FAN);
    await recordSubPostView(P1, OWNER, OWNER);
    const top = await topSubPostsSince(OWNER, "2000-01-01");
    expect(top!.map((t) => [t.id, t.views, t.kind])).toEqual([
      [P2, 2, "video"],
      [P1, 1, "photo"],
    ]);
    expect(top![0]!.thumb).toBe("data:image/webp;base64,AA");
  });
});
