import { describe, expect, it, vi } from "vitest";

import { titleFromCaption } from "@/lib/social/caption";
import type { PublicPost } from "@/lib/social/posts";
import { postPageMetadata } from "@/lib/social/post-metadata";
import { SITE_URL } from "@/lib/site";

/**
 * Owner, 2026-10-30: shared links preview like TikTok, Instagram and Facebook — "the content shows only the image and
 * not the profile preview unless it was the Profile link". A PROFILE link is the person (photo, name, bio — the small
 * card); a REEL or SOUND link is the content's own picture (the large card) and caption, never the creator's photo.
 * The share-card route is driven for real, with the profile/post/sound reads stubbed.
 */
const REEL = "0b5f2a52-6d1e-4c43-9c1f-2f7a3c0d9e11";
const SOUND = "6a3e2b10-1c2d-4e5f-8a9b-0c1d2e3f4a5b";
const AVATAR = "https://media.example/ada-avatar.jpg";
const THUMB = "https://media.example/reel-thumb.jpg";
const COVER = "https://media.example/sound-cover.jpg";

vi.mock("@/lib/social/profile", () => ({
  getPublicProfile: async (handle: string) => (handle === "ada" ? { handle: "ada", displayName: "Ada Obi", bio: "Makes travel reels.", avatarUrl: AVATAR } : null),
}));
vi.mock("@/lib/social/posts", () => ({
  getPost: async (id: string) =>
    id === REEL
      ? {
          id: REEL,
          title: "Sunset run on the beach. Part two tomorrow",
          description: "Sunset run on the beach.",
          platform: "tiktok",
          thumbnail_url: THUMB,
          media_kind: "video",
          publisher: { id: "u1", handle: "ada", displayName: "Ada Obi", avatarUrl: AVATAR, isVerified: false, isFollowing: false },
        }
      : null,
}));
vi.mock("@/lib/social/sounds", () => ({
  getSound: async (id: string) => (id === SOUND ? { id: SOUND, title: "Calm Waves", artistLabel: "Ada Obi", coverArtUrl: COVER, isPublic: true } : null),
}));

async function card(path: string, to: string) {
  const { GET } = await import("@/app/api/share-card/route");
  const res = await GET(new Request(`${SITE_URL}/api/share-card?path=${encodeURIComponent(path)}&to=${encodeURIComponent(to)}`));
  const html = await res.text();
  const meta = (key: string) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`))?.[1] ?? null;
  return { html, meta };
}

describe("a PROFILE link is the person's card", () => {
  it("their photo, name and bio — the small card", async () => {
    const { meta } = await card("/u/ada", "/ada");
    expect(meta("og:type")).toBe("profile");
    expect(meta("og:title")).toBe("Ada Obi (@ada)");
    expect(meta("og:description")).toBe("Makes travel reels.");
    expect(meta("og:image")).toBe(AVATAR);
    expect(meta("og:url")).toBe(`${SITE_URL}/ada`);
    expect(meta("twitter:card")).toBe("summary");
  });

  it("an Exclusive subscribe link (/ada?tab=sub) keeps its tab; another address never becomes the profile's", async () => {
    expect((await card("/u/ada", "/ada?tab=sub")).meta("og:url")).toBe(`${SITE_URL}/ada?tab=sub`);
    expect((await card("/u/ada", "/someone-else")).meta("og:url")).toBe(`${SITE_URL}/ada`);
  });
});

describe("a CONTENT link is the content's own picture — never the creator's profile", () => {
  it("a shared reel (/p/<id> → /reels?start=<id>): its thumbnail and caption, large", async () => {
    const { html, meta } = await card("/reels", `/reels?start=${REEL}`);
    expect(meta("og:type")).toBe("video.other");
    expect(meta("og:image")).toBe(THUMB);
    expect(meta("twitter:image")).toBe(THUMB);
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(meta("og:title")).toBe(titleFromCaption("Sunset run on the beach. Part two tomorrow"));
    expect(meta("og:url")).toBe(`${SITE_URL}/p/${REEL}`);
    // teeth: the creator's photo and name appear nowhere on a content card
    expect(html).not.toContain(AVATAR);
    expect(html).not.toContain("Ada Obi");
  });

  it("a shared sound: its cover, large", async () => {
    const { html, meta } = await card(`/sound/${SOUND}`, `/sound/${SOUND}`);
    expect(meta("og:type")).toBe("music.song");
    expect(meta("og:image")).toBe(COVER);
    expect(meta("twitter:card")).toBe("summary_large_image");
    expect(html).not.toContain(AVATAR);
  });

  it("a reel that cannot be shown (private, deleted, a bad id) gets the plain Reels card — still no profile", async () => {
    for (const to of ["/reels?start=11111111-2222-4333-8444-555555555555", "/reels?start=nope", "/reels"]) {
      const { html, meta } = await card("/reels", to);
      expect(meta("og:title"), to).toBe("Reels on Frenzsave");
      expect(html, to).not.toContain(AVATAR);
    }
  });
});

describe("a post page's own preview (photo posts stay public at /p/<id>)", () => {
  const post = {
    id: "p1",
    title: "Lagos at night. Shot on a phone",
    description: "Lagos at night.",
    platform: "instagram",
    thumbnail_url: THUMB,
    indexable: true,
    publisher: { id: "u1", handle: "ada", displayName: "Ada Obi", avatarUrl: AVATAR, isVerified: false, isFollowing: false },
  } as unknown as PublicPost;

  it("is the content: its picture as the large card on X too, its own address — no profile photo", () => {
    const meta = postPageMetadata(post, "/p/p1");
    expect(meta.openGraph).toMatchObject({ url: "/p/p1", images: [{ url: THUMB }] });
    // set explicitly: left out, X inherited the ROOT layout's site headline for every post
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: titleFromCaption("Lagos at night. Shot on a phone"), images: [{ url: THUMB }] });
    expect(JSON.stringify(meta)).not.toContain(AVATAR);
  });
});
