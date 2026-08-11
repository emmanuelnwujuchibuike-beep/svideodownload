import { describe, expect, it } from "vitest";

import { pickPreview } from "./reel-extras";

/**
 * The badge on this preview makes a CLAIM — "Friend", "Creator", "Top comment".
 * The failure that matters is not picking a slightly worse comment; it is
 * picking one and labelling it something it is not. These tests are about the
 * label being earned.
 */

const author = (id: string, over: Partial<{ handle: string | null; display_name: string | null; is_verified: boolean }> = {}) =>
  [id, { id, handle: over.handle === undefined ? id : over.handle, display_name: over.display_name ?? null, avatar_url: null, is_verified: over.is_verified ?? false }] as const;

const authors = new Map<string, { id: string; handle: string | null; display_name: string | null; avatar_url: string | null; is_verified: boolean | null }>([
  author("me"),
  author("pal"),
  author("creator"),
  author("famous", { is_verified: true }),
  author("stranger"),
  author("ghost", { handle: null }),
]);

// Rows arrive newest-first, as the query orders them.
const row = (author_id: string, body = "hi", likes_count = 0, created_at = "2026-08-11T00:00:00Z") => ({
  id: `${author_id}-c`,
  post_id: "p1",
  author_id,
  body,
  created_at,
  likes_count,
});

const ctx = (following: string[] = []) => ({ publisherId: "creator", followingIds: new Set(following) });

describe("pickPreview", () => {
  it("prefers a FRIEND over everything else", () => {
    const got = pickPreview([row("stranger"), row("famous"), row("creator"), row("pal")], authors, ctx(["pal"]));
    expect(got?.authorHandle).toBe("pal");
    expect(got?.reason).toBe("friend");
  });

  it("prefers the CREATOR when no friend commented", () => {
    const got = pickPreview([row("stranger"), row("famous"), row("creator")], authors, ctx());
    expect(got?.authorHandle).toBe("creator");
    expect(got?.reason).toBe("creator");
  });

  it("🔴 never labels the creator a 'friend' just because you follow them", () => {
    // You follow almost every creator whose reel you are watching. Calling that
    // a friend comment would make the friend badge meaningless.
    const got = pickPreview([row("creator")], authors, ctx(["creator"]));
    expect(got?.reason).toBe("creator");
  });

  it("falls to a VERIFIED account next", () => {
    const got = pickPreview([row("stranger"), row("famous")], authors, ctx());
    expect(got?.reason).toBe("verified");
  });

  it("🔴 only calls it a TOP comment when the likes are a real signal", () => {
    // One like is noise. Badging it "Top" is a small inflation that makes every
    // other badge less believable.
    const one = pickPreview([row("stranger", "a", 1), row("stranger", "b", 0)], authors, ctx());
    expect(one?.reason).toBe("newest");

    const two = pickPreview([row("stranger", "newest", 0), row("stranger", "loved", 2)], authors, ctx());
    expect(two?.reason).toBe("top");
    expect(two?.body).toBe("loved");
  });

  it("falls back to the newest, which is the FLOOR and not the default", () => {
    const got = pickPreview([row("stranger", "newest"), row("stranger", "older")], authors, ctx());
    expect(got?.reason).toBe("newest");
    expect(got?.body).toBe("newest");
  });

  it("skips a comment whose author has no handle — it cannot be attributed", () => {
    const got = pickPreview([row("ghost", "from nowhere"), row("stranger", "real")], authors, ctx());
    expect(got?.body).toBe("real");
  });

  it("skips an empty or whitespace-only body", () => {
    const got = pickPreview([row("stranger", "   "), row("stranger", "real")], authors, ctx());
    expect(got?.body).toBe("real");
  });

  it("returns null when there is nothing usable", () => {
    expect(pickPreview([], authors, ctx())).toBeNull();
    expect(pickPreview([row("ghost")], authors, ctx())).toBeNull();
  });

  it("falls back to the handle when the author has no display name", () => {
    const got = pickPreview([row("stranger")], authors, ctx());
    expect(got?.authorName).toBe("stranger");
  });

  it("trims the body — a preview is one line and leading space shifts it", () => {
    const got = pickPreview([row("stranger", "  spaced  ")], authors, ctx());
    expect(got?.body).toBe("spaced");
  });
});
