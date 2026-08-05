import { describe, expect, it } from "vitest";

import {
  chooseSnapGroup,
  collectSnapGroups,
  collectSnaps,
  dedupeSnaps,
  isCollectionUrl,
  stripSnapWatermark,
} from "./snapchat";

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
  it("treats a profile or folder link as a collection", () => {
    expect(isCollectionUrl("https://www.snapchat.com/@emily")).toBe(true);
    expect(isCollectionUrl("https://www.snapchat.com/p/abc123")).toBe(true);
    expect(isCollectionUrl("https://www.snapchat.com/add/emily")).toBe(true);
    expect(isCollectionUrl("https://www.snapchat.com/story/xyz")).toBe(true);
  });

  // A short code says nothing until it has been followed — classifying it as
  // a collection on sight is what made one shared snap return a whole archive.
  it("does NOT treat an unresolved /t/ short link as a collection", () => {
    expect(isCollectionUrl("https://snapchat.com/t/qTTonTHj")).toBe(false);
  });

  it("classifies a /t/ link by where it RESOLVED to", () => {
    expect(isCollectionUrl("https://www.snapchat.com/@emily")).toBe(true);
    expect(isCollectionUrl("https://www.snapchat.com/spotlight/W7_ABC")).toBe(false);
  });

  it("treats a single Spotlight clip as one item", () => {
    expect(isCollectionUrl("https://www.snapchat.com/spotlight/W7_EDlXWTBiXAEEniNoMPw")).toBe(false);
  });
});

/**
 * The duplication regression (owner, 2026-08-04).
 *
 * A normal story link started returning every snap many times over — one snap
 * showed as 12 items, six showed as 72. Snapchat re-saves story snaps into
 * highlight folders, so merging `story.snapList` with EVERY entry of
 * `curatedHighlights` multiplies the story by the number of folders.
 *
 * These pin both halves of the rule, because fixing one by breaking the other
 * is exactly how this happened the first time.
 */
describe("dedupeSnaps", () => {
  const snap = (id: string, url = `https://cf-st.sc-cdn.net/d/${id}.mp4`) => ({
    snapId: id,
    snapUrls: { mediaUrl: url },
  });

  it("keeps distinct snaps in order", () => {
    const out = dedupeSnaps([snap("a"), snap("b"), snap("c")]);
    expect(out.map((s) => s.snapId)).toEqual(["a", "b", "c"]);
  });

  it("drops a repeat of the same snapId", () => {
    expect(dedupeSnaps([snap("a"), snap("a"), snap("b")]).map((s) => s.snapId)).toEqual(["a", "b"]);
  });

  // The signed-URL case: the same snap arrives twice with different query
  // strings, so keying on the whole URL de-duplicates nothing.
  it("drops a repeat whose signed URL differs but whose path does not", () => {
    const a = { snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/x.mp4?sig=111&exp=1" } };
    const b = { snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/x.mp4?sig=222&exp=2" } };
    expect(dedupeSnaps([a, b])).toHaveLength(1);
  });

  it("keeps two genuinely different snaps that share a host", () => {
    const a = { snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/x.mp4?sig=1" } };
    const b = { snapUrls: { mediaUrl: "https://cf-st.sc-cdn.net/d/y.mp4?sig=1" } };
    expect(dedupeSnaps([a, b])).toHaveLength(2);
  });

  it("skips entries with no identity at all", () => {
    expect(dedupeSnaps([{ snapUrls: {} }, { snapUrls: { mediaUrl: "" } }])).toHaveLength(0);
  });

  it("handles an empty list", () => {
    expect(dedupeSnaps([])).toEqual([]);
  });
});

describe("collectSnaps de-duplication (the 12x regression)", () => {
  const withSig = (id: string, sig: number) => ({
    snapId: id,
    snapUrls: { mediaUrl: `https://cf-st.sc-cdn.net/d/${id}.mp4?sig=${sig}` },
  });

  it("counts a snap once however many containers hold it", () => {
    // One story of 6 snaps, re-saved into 11 highlight folders — the exact
    // shape that produced 72.
    const story = Array.from({ length: 6 }, (_, i) => withSig(`snap${i}`, 0));
    const highlights = Array.from({ length: 11 }, (_, folder) => ({
      snapList: story.map((s) => withSig(s.snapId, folder + 1)),
    }));
    const blob = { props: { pageProps: { story: { snapList: story }, curatedHighlights: highlights } } };

    expect(collectSnaps(blob)).toHaveLength(6);
  });

  it("still finds every snap of a genuine multi-folder page", () => {
    const blob = {
      props: {
        pageProps: {
          curatedHighlights: [
            { snapList: [withSig("a", 1), withSig("b", 1)] },
            { snapList: [withSig("c", 1)] },
          ],
        },
      },
    };
    expect(collectSnaps(blob).map((s) => s.snapId)).toEqual(["a", "b", "c"]);
  });
});

/**
 * The link must decide what you get.
 *
 * Owner (2026-08-04): a story link was returning the profile's saved stories
 * instead of the story it pointed at. The container the page names is the
 * authority; the deep walk is a last resort and can only ever ADD media the
 * link did not ask for.
 */
describe("the story a link points at wins over the profile's archive", () => {
  const snap = (id: string) => ({
    snapId: id,
    snapUrls: { mediaUrl: `https://cf-st.sc-cdn.net/d/${id}.mp4`, mediaPreviewUrl: `https://cf-st.sc-cdn.net/p/${id}.jpg` },
  });

  it("a ONE-snap story does not pull in the profile's highlights", () => {
    // The exact shape that broke: a single-snap story on a profile that also
    // has archived folders.
    const blob = {
      props: {
        pageProps: {
          story: { snapList: [snap("target")] },
          curatedHighlights: [
            { snapList: [snap("old1"), snap("old2")] },
            { snapList: [snap("old3")] },
          ],
        },
      },
    };
    const story = blob.props.pageProps.story.snapList.filter((s) => s.snapUrls?.mediaUrl);
    const highlights = blob.props.pageProps.curatedHighlights.flatMap((h) => h.snapList);
    const known = dedupeSnaps(story.length > 0 ? story : highlights);

    expect(known.map((s) => s.snapId)).toEqual(["target"]);
    // The deep walk would have returned all four — which is the bug.
    expect(collectSnaps(blob).length).toBeGreaterThan(known.length);
  });

  it("still falls back to the folders when there is no live story", () => {
    const blob = {
      props: {
        pageProps: {
          curatedHighlights: [{ snapList: [snap("a"), snap("b")] }],
        },
      },
    };
    const story: ReturnType<typeof snap>[] = [];
    const highlights = blob.props.pageProps.curatedHighlights.flatMap((h) => h.snapList);
    const known = dedupeSnaps(story.length > 0 ? story : highlights);
    expect(known.map((s) => s.snapId)).toEqual(["a", "b"]);
  });

  it("carries a per-snap poster through", () => {
    expect(dedupeSnaps([snap("x")])[0]!.snapUrls!.mediaPreviewUrl).toContain("/p/x.jpg");
  });
});


/**
 * ── The bug that came back three times ────────────────────────────────────
 * A 24-hour story link kept returning the account's SAVED profile stories.
 * Every earlier fix read a fixed key and, when the page did not use it, fell
 * through to a walk that FLATTENED every snap on the page.
 *
 * Flattening was the bug. These tests pin the property that makes it
 * impossible to recur: the page's lists are kept SEPARATE, and exactly one is
 * ever chosen — so a result can never contain snaps from two containers,
 * whatever key names Snapchat uses next.
 */
describe("snap groups", () => {
  const snap = (id: string) => ({
    snapId: id,
    snapUrls: { mediaUrl: `https://cf-st.sc-cdn.net/d/${id}.mp4`, mediaPreviewUrl: `https://cf-st.sc-cdn.net/p/${id}.jpg` },
  });

  const page = {
    props: {
      pageProps: {
        story: { storyId: "live-1", snapList: [snap("live_a"), snap("live_b")] },
        curatedHighlights: [
          { highlightId: "obsession", title: "My Obsession", snapList: [snap("saved_a"), snap("saved_b"), snap("saved_c")] },
          { highlightId: "trips", title: "Trips", snapList: [snap("trip_a")] },
        ],
      },
    },
  };

  it("keeps each list separate instead of flattening them", () => {
    const groups = collectSnapGroups(page);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.snaps.length).sort()).toEqual([1, 2, 3]);
  });

  it("labels the live story and the saved folders", () => {
    const groups = collectSnapGroups(page);
    expect(groups.filter((g) => g.isLiveStory)).toHaveLength(1);
    expect(groups.filter((g) => g.isHighlight)).toHaveLength(2);
  });

  it("records the container ids so a folder link can be matched", () => {
    const folder = collectSnapGroups(page).find((g) => g.ids.includes("obsession"));
    expect(folder).toBeDefined();
    expect(folder!.snaps).toHaveLength(3);
  });

  // Link 1 — a plain 24h story share.
  it("a share link with no folder in it picks the LIVE story, not the archive", () => {
    const choice = chooseSnapGroup(collectSnapGroups(page), ["https://snapchat.com/t/ErbU9eX5"]);
    expect(choice!.reason).toBe("live-story");
    expect(choice!.group.snaps.map((s) => s.snapId)).toEqual(["live_a", "live_b"]);
    // The decisive assertion: nothing saved leaks in.
    expect(choice!.group.snaps.some((s) => s.snapId!.startsWith("saved"))).toBe(false);
  });

  // Link 2 — a saved profile-story folder.
  it("a link naming a folder picks that folder", () => {
    const choice = chooseSnapGroup(collectSnapGroups(page), ["https://www.snapchat.com/@emily/obsession"]);
    expect(choice!.reason).toBe("container-id");
    expect(choice!.group.snaps).toHaveLength(3);
    expect(choice!.snap).toBeNull();
  });

  it("a link naming one snap narrows to that snap", () => {
    const choice = chooseSnapGroup(collectSnapGroups(page), ["https://www.snapchat.com/p/xyz/saved_b"]);
    expect(choice!.reason).toBe("snap-id");
    expect(choice!.snap!.snapId).toBe("saved_b");
  });

  it("returns the only list when a page has just one", () => {
    const single = { props: { pageProps: { story: { snapList: [snap("only")] } } } };
    const choice = chooseSnapGroup(collectSnapGroups(single), ["https://snapchat.com/t/abc"]);
    expect(choice!.reason).toBe("only-group");
    expect(choice!.group.snaps).toHaveLength(1);
  });

  it("finds a list under a key we have never seen", () => {
    const unknownShape = { props: { pageProps: { somethingNew: { items: [snap("x"), snap("y")] } } } };
    const groups = collectSnapGroups(unknownShape);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.snaps).toHaveLength(2);
  });

  it("falls back to the first list rather than merging", () => {
    const twoUnknown = {
      props: { pageProps: { a: { items: [snap("a1")] }, b: { items: [snap("b1")] } } },
    };
    const choice = chooseSnapGroup(collectSnapGroups(twoUnknown), ["https://snapchat.com/t/zzz"]);
    expect(choice!.reason).toBe("first");
    expect(choice!.group.snaps).toHaveLength(1);
  });

  it("de-duplicates within a list", () => {
    const dupes = { props: { pageProps: { story: { snapList: [snap("a"), snap("a"), snap("b")] } } } };
    expect(collectSnapGroups(dupes)[0]!.snaps).toHaveLength(2);
  });

  it("returns nothing for a page with no snaps", () => {
    expect(collectSnapGroups({ props: { pageProps: {} } })).toEqual([]);
    expect(chooseSnapGroup([], ["https://snapchat.com/t/abc"])).toBeNull();
  });

  it("survives junk and cycles", () => {
    expect(() => collectSnapGroups(null)).not.toThrow();
    const cyclic: Record<string, unknown> = { props: {} };
    cyclic.self = cyclic;
    expect(() => collectSnapGroups(cyclic)).not.toThrow();
  });
});
