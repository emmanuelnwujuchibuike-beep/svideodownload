import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner, 2026-10-25: "this TikTok link is failing to fetch … I have come across so many like that recently".
 * The link was a PHOTO post. TikTok's desktop page for a photo post stopped carrying the post (no
 * `webapp.video-detail`); the mobile page carries it in a separate `api-data` script. TikWM is rate-limited from the
 * worker, so the post failed on every route. Pinned:
 *   · findItemInPage reads either place, and still names the original reason when neither has it;
 *   · the native route asks once more as mobile Safari when the desktop page has no item — and ONLY then;
 *   · end to end, a photo post with TikWM refusing comes back with one image per slide.
 */
type Call = { url: string; ua: string; method: string };
const calls: Call[] = [];
let tikwm: { code: number; msg?: string } = { code: -1, msg: "Free Api Limit: 1 request/second." };
let desktopHtml = "";
let mobileHtml = "";

vi.mock("./http", () => ({
  extractorFetch: vi.fn(async (url: string, init: RequestInit) => {
    const ua = String((init.headers as Record<string, string> | undefined)?.["User-Agent"] ?? "");
    calls.push({ url, ua, method: init.method ?? "GET" });
    if (url.includes("tikwm.com")) return new Response(JSON.stringify(tikwm), { status: 200 });
    // `Response.url` is a read-only getter (Object.assign cannot set it) — define it, as fetch does after a redirect
    if (init.method === "HEAD") return Object.defineProperty(new Response(null, { status: 200 }), "url", { value: "https://www.tiktok.com/@someone/photo/7698056477365357857" });
    return new Response(/iPhone/.test(ua) ? mobileHtml : desktopHtml, { status: 200, headers: { "set-cookie": "tt_chain_token=abc; Path=/" } });
  }),
}));

const { findItemInPage, tiktokExtractor, tiktokPageAttempts } = await import("./tiktok");

/*
  Owner, 2026-10-27: vt.tiktok.com/ZSgVnvTD2 (a /photo/ post) failed on production after 23 s, while the same mobile
  page carried the post from a home connection — the datacenter IP gets a 200 page without it, which is not a
  "block", so the residential proxy never got a turn. Pinned: the page order per link type, and the proxy step.
*/
describe("tiktokPageAttempts — which pages native asks for, in order", () => {
  const kinds = (a: ReturnType<typeof tiktokPageAttempts>) => a.map((x) => `${/iPhone/.test(x.headers["User-Agent"] ?? "") ? "mobile" : "desktop"}${x.proxy ? "+proxy" : ""}`);
  it("a photo link: mobile first (the desktop page never has it), then mobile through the proxy", () => {
    expect(kinds(tiktokPageAttempts("https://www.tiktok.com/@a/photo/7701129264254455062", true))).toEqual(["mobile", "mobile+proxy"]);
  });
  it("a video link: desktop, mobile, then mobile through the proxy", () => {
    expect(kinds(tiktokPageAttempts("https://www.tiktok.com/@a/video/7701129264254455062", true))).toEqual(["desktop", "mobile", "mobile+proxy"]);
  });
  it("no proxy configured: no proxy step (it would only repeat the same direct fetch)", () => {
    expect(kinds(tiktokPageAttempts("https://www.tiktok.com/@a/photo/1", false))).toEqual(["mobile"]);
  });
  it("teeth: a photo link that still starts with the desktop page is caught", () => {
    const old = [{ headers: { "User-Agent": "Windows" }, proxy: false }, { headers: { "User-Agent": "iPhone" }, proxy: false }];
    expect(kinds(old)).not.toEqual(kinds(tiktokPageAttempts("https://www.tiktok.com/@a/photo/1", false)));
  });
});

const state = (scope: Record<string, unknown>) => `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({ __DEFAULT_SCOPE__: scope })}</script>`;
const apiData = (item: unknown) => `<script id="api-data" type="application/json">${JSON.stringify({ videoDetail: { itemInfo: { itemStruct: item } } })}</script>`;
const PHOTO_ITEM = {
  id: "7698056477365357857",
  desc: "seven photos",
  author: { nickname: "Someone", uniqueId: "someone" },
  imagePost: { images: Array.from({ length: 7 }, (_, i) => ({ imageURL: { urlList: [`https://p16-common-sign.tiktokcdn.com/photomode/${i}.jpeg`] }, imageWidth: 1080, imageHeight: 1440 })) },
};
// what TikTok's desktop page for a photo post looks like now: a real page, state present, no post in it
const DESKTOP_WITHOUT_POST = `<html>${state({ "webapp.app-context": {}, "seo.abtest": {} })}</html>`;
const MOBILE_WITH_POST = `<html>${state({ "webapp.app-context": {} })}${apiData(PHOTO_ITEM)}</html>`;

beforeEach(() => {
  calls.length = 0;
  tikwm = { code: -1, msg: "Free Api Limit: 1 request/second." };
  desktopHtml = DESKTOP_WITHOUT_POST;
  mobileHtml = MOBILE_WITH_POST;
});

describe("findItemInPage", () => {
  it("reads a photo post from the mobile page's api-data script", () => {
    expect(findItemInPage(MOBILE_WITH_POST).imagePost?.images).toHaveLength(7);
  });
  it("still reads a video post from the rehydration state (unchanged path)", () => {
    const html = state({ "webapp.video-detail": { itemInfo: { itemStruct: { id: "1", video: { playAddr: "https://v16.example/v.mp4" } } } } });
    expect(findItemInPage(html).video).toBeTruthy();
  });
  it("neither place has the post → the ORIGINAL reason is thrown (diagnostics keep working)", () => {
    expect(() => findItemInPage(DESKTOP_WITHOUT_POST)).toThrow("TikTok item missing");
    expect(() => findItemInPage("<html><title>Verify</title></html>")).toThrow(/TikTok state not found/);
  });
});

describe("the photo post end to end (TikWM rate-limited, as on the worker)", () => {
  it("comes back with one image per slide, via the mobile page", async () => {
    const m = await tiktokExtractor.extract("https://vt.tiktok.com/ZSgCj5asD/");
    expect(m.formats.filter((f) => /^Photo [0-9]/.test(f.label))).toHaveLength(7);
    expect(m.title).toBe("seven photos");
    // the slides carry the cookie the MOBILE page set (the CDN may need it — same rule as video, 2026-10-08)
    const photo = m.formats.find((f) => /Photo/i.test(f.label ?? "")) as { httpHeaders?: Record<string, string> } | undefined;
    expect(JSON.stringify(photo?.httpHeaders ?? {})).toContain("tt_chain_token=abc");
    // 2026-10-27: a /photo/ link goes straight to the mobile page — the desktop page never has a photo post now
    const pages = calls.filter((c) => c.method !== "HEAD" && !c.url.includes("tikwm"));
    expect(pages.map((c) => (/iPhone/.test(c.ua) ? "mobile" : "desktop"))).toEqual(["mobile"]);
  }, 20_000);

  it("a page that already has the post costs NO second request", async () => {
    await tiktokExtractor.extract("https://vt.tiktok.com/ZSgCj5asD/");
    const pageCalls = calls.filter((c) => c.method !== "HEAD" && !c.url.includes("tikwm"));
    expect(pageCalls).toHaveLength(1);
  }, 20_000);

  it("teeth: if the mobile page has no post either, the extraction still fails (no invented media)", async () => {
    mobileHtml = DESKTOP_WITHOUT_POST;
    await expect(tiktokExtractor.extract("https://vt.tiktok.com/ZSgCj5asD/")).rejects.toThrow(/TikTok extraction failed/);
  }, 20_000);
});
