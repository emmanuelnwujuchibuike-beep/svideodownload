import { describe, expect, it } from "vitest";

import { collectSnaps, isCollectionUrl, stripSnapWatermark } from "./snapchat";

/**
 * Snapchat Spotlight watermark removal.
 *
 * Spotlight share pages serve a watermarked render (the `.27.` rendition, and a
 * `mo` query carrying `SpotlightSharing`); the same media is served clean at the
 * `.1034.` story-original rendition. The bug this suite pins: the rewrite only
 * matched a `/d/` media path, while Spotlight also serves from `/y/` — so a
 * `/y/` URL passed the watermark check and had nothing rewritten, and the file
 * downloaded WITH the watermark. That is the reported "Snapchat Spotlight still
 * downloads with watermarks".
 */
describe("stripSnapWatermark", () => {
  const watermarked = (dir: string) =>
    `https://cf-st.sc-cdn.net/${dir}/ABC123def.27.XYZtoken?mo=U3BvdGxpZ2h0U2hhcmluZw&uc=42`;

  it("strips the watermark on a /d/ Spotlight URL", () => {
    const out = stripSnapWatermark(watermarked("d"));
    expect(out).toContain(".1034.");
    expect(out).not.toContain(".27.");
    expect(out).not.toContain("mo=");
  });

  it("strips the watermark on a /y/ Spotlight URL — the case that was broken", () => {
    const out = stripSnapWatermark(watermarked("y"));
    expect(out, "the /y/ rendition was left watermarked").toContain(".1034.");
    expect(out).not.toContain(".27.");
    expect(out).not.toContain("mo=");
  });

  it("detects the watermark from the SpotlightSharing media-option alone", () => {
    // A non-.27. rendition can still carry the sharing overlay via `mo`.
    const out = stripSnapWatermark(
      "https://cf-st.sc-cdn.net/y/ABC123def.99.tok?mo=U3BvdGxpZ2h0U2hhcmluZw",
    );
    expect(out).toContain(".1034.");
    expect(out).not.toContain("mo=");
  });

  it("leaves a clean story URL untouched", () => {
    const clean = "https://cf-st.sc-cdn.net/d/ABC123def.mp4";
    expect(stripSnapWatermark(clean)).toBe(clean);
  });

  it("leaves an already-clean .1034. URL untouched", () => {
    const clean = "https://cf-st.sc-cdn.net/y/ABC123def.1034.XYZtoken";
    expect(stripSnapWatermark(clean)).toBe(clean);
  });

  it("returns the input unchanged when it is not a URL", () => {
    expect(stripSnapWatermark("not a url")).toBe("not a url");
  });
});

/**
 * The saved-story-FOLDER regression (owner, 2026-08-04).
 *
 * A story saved into a folder on a profile ("My Obsession") downloaded exactly
 * ONE video. Its snaps live in neither `story.snapList` nor `curatedHighlights`,
 * so the extractor's fixed key list found nothing and fell through to a regex
 * that — without /g — matched a single media URL. Hence "only the first one".
 */
const snap = (id: string, url = `https://cf-st.sc-cdn.net/d/${id}.mp4`) => ({
  snapId: id,
  snapMediaType: 1,
  snapUrls: { mediaUrl: url },
});

describe("collectSnaps", () => {
  it("finds a live 24-hour story's snaps", () => {
    const page = { props: { pageProps: { story: { snapList: [snap("a"), snap("b")] } } } };
    expect(collectSnaps(page).map((s) => s.snapId)).toEqual(["a", "b"]);
  });

  it("finds snaps in a container the code has never seen — the folder case", () => {
    const page = {
      props: {
        pageProps: {
          savedStoryCollection: {
            title: "My Obsession",
            entries: { items: [snap("s1"), snap("s2"), snap("s3"), snap("s4")] },
          },
        },
      },
    };
    expect(collectSnaps(page)).toHaveLength(4);
  });

  it("reaches EVERY highlight folder, not just the first", () => {
    const page = {
      props: {
        pageProps: {
          curatedHighlights: [
            { snapList: [snap("h1a"), snap("h1b")] },
            { snapList: [snap("h2a"), snap("h2b")] },
          ],
        },
      },
    };
    expect(collectSnaps(page).map((s) => s.snapId)).toEqual(["h1a", "h1b", "h2a", "h2b"]);
  });

  it("de-duplicates a snap that appears in more than one place", () => {
    const shared = snap("dupe");
    const page = { a: { snapList: [shared] }, b: { preview: [shared] }, c: [snap("other")] };
    expect(collectSnaps(page).map((s) => s.snapId)).toEqual(["dupe", "other"]);
  });

  it("de-duplicates by media URL when snapIds are absent", () => {
    const u = "https://cf-st.sc-cdn.net/d/same.mp4";
    expect(collectSnaps([{ snapUrls: { mediaUrl: u } }, { snapUrls: { mediaUrl: u } }])).toHaveLength(1);
  });

  it("ignores objects that only look like snaps", () => {
    expect(collectSnaps({ user: { name: "x" }, snapUrls: {}, o: { snapUrls: { mediaUrl: "" } } })).toHaveLength(0);
  });

  it("survives junk without throwing", () => {
    for (const input of [null, undefined, 42, "string", [], {}]) {
      expect(() => collectSnaps(input)).not.toThrow();
    }
  });

  it("is bounded, so a pathological page cannot spin the server", () => {
    let deep: Record<string, unknown> = { snapUrls: { mediaUrl: "https://x/deep.mp4" } };
    for (let i = 0; i < 60; i++) deep = { nested: deep };
    expect(() => collectSnaps(deep)).not.toThrow();

    expect(collectSnaps(Array.from({ length: 500 }, (_, i) => snap(`s${i}`))).length).toBeLessThanOrEqual(200);
  });

  it("does not hang on a self-referencing object", () => {
    const cyclic: Record<string, unknown> = { snapUrls: { mediaUrl: "https://x/a.mp4" } };
    cyclic.self = cyclic;
    expect(() => collectSnaps(cyclic)).not.toThrow();
  });
});

describe("isCollectionUrl", () => {
  it("treats a profile, folder or share link as a collection", () => {
    // Narrowing any of these to a single snap is what produced "one video".
    for (const url of [
      "https://snapchat.com/t/dY2J6e2d",
      "https://www.snapchat.com/@someuser",
      "https://www.snapchat.com/p/abc123/456",
      "https://www.snapchat.com/add/someuser",
      "https://www.snapchat.com/story/xyz",
    ]) {
      expect(isCollectionUrl(url), url).toBe(true);
    }
  });

  it("treats a single Spotlight clip as one item", () => {
    expect(isCollectionUrl("https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPw")).toBe(false);
  });
});
