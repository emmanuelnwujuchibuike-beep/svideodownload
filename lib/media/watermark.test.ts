import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildWatermarkArgs, displayedSize, markPlacement } from "./watermark-args";
import { MARK_SHARE, WATERMARK_CORNER_SECONDS, WATERMARK_CORNERS } from "./watermark-mark-geometry";
import { cleanHandle, mintWatermarkTicket, verifyWatermarkTicket, WATERMARK_TICKET_TTL_MS } from "./watermark-ticket";

/* Owner, 2026-10-14: feed/Reels downloads carry the creator's @handle and the
   Frenzsave mark; only Pro and up may take the clean file; everyone is asked. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

describe("the watermark ticket", () => {
  const ticket = mintWatermarkTicket({ src: "https://media.frenzsave.com/a.mp4", handle: "@chris", name: "clip.mp4" }, SECRET, NOW);

  it("round-trips, with the handle cleaned", () => {
    const p = verifyWatermarkTicket(ticket, SECRET, NOW + 1000);
    expect(p?.src).toBe("https://media.frenzsave.com/a.mp4");
    expect(p?.handle).toBe("chris");
    expect(p?.name).toBe("clip.mp4");
  });

  it("teeth: a tampered, expired, wrong-secret or non-https ticket is refused", () => {
    const [body, sig] = ticket.split(".");
    const forged = Buffer.from(JSON.stringify({ src: "https://evil.example/x.mp4", handle: "x", name: "x", exp: NOW + 60_000, n: "1" })).toString("base64url");
    expect(verifyWatermarkTicket(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyWatermarkTicket(`${body}.${sig}x`, SECRET, NOW)).toBeNull();
    expect(verifyWatermarkTicket(ticket, SECRET, NOW + WATERMARK_TICKET_TTL_MS + 1)).toBeNull();
    expect(verifyWatermarkTicket(ticket, "other", NOW)).toBeNull();
    expect(verifyWatermarkTicket(mintWatermarkTicket({ src: "http://plain/a.mp4", handle: "c", name: "a.mp4" }, SECRET, NOW), SECRET, NOW)).toBeNull();
    expect(verifyWatermarkTicket(null, SECRET, NOW)).toBeNull();
  });

  it("a handle can only carry handle characters", () => {
    expect(cleanHandle("@a<b>c d_e.f")).toBe("abcd_e.f");
    expect(cleanHandle("x".repeat(50))).toHaveLength(30);
  });
});

describe("where the mark goes", () => {
  it("a 90° phone clip is placed on its upright frame", () => {
    expect(displayedSize({ width: 1280, height: 720, rotation: 90 })).toEqual({ width: 720, height: 1280 });
    expect(displayedSize({ width: 1280, height: 720, rotation: -90 })).toEqual({ width: 720, height: 1280 });
    expect(displayedSize({ width: 1920, height: 1080, rotation: 180 })).toEqual({ width: 1920, height: 1080 });
    expect(displayedSize({ width: 0, height: 720 })).toBeNull();
  });

  it("sized off the shorter side, so portrait and landscape carry the same mark", () => {
    const portrait = markPlacement({ width: 720, height: 1280 });
    const landscape = markPlacement({ width: 1280, height: 720 });
    expect(portrait.width).toBe(landscape.width);
    expect(portrait.width).toBe(Math.round((720 * MARK_SHARE) / 2) * 2);
    expect(portrait.width % 2).toBe(0);
  });

  it("ffmpeg gets exact pixels — no scale2ref, whose variables differ by version", () => {
    const args = buildWatermarkArgs("in", "mark.png", "out.mp4", { width: 720, height: 1280 });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    expect(filter).toContain(`scale=${markPlacement({ width: 720, height: 1280 }).width}:-2`);
    expect(filter).not.toContain("scale2ref");
    // a silent video must not fail on a missing audio track
    expect(args.join(" ")).toContain("-map 0:a?");
    expect(args).toContain("+faststart");
  });
});

describe("the watermark hops corners every 3 seconds (owner, 2026-10-14)", () => {
  it("starts at the bottom, then top, bottom, top — left side first", () => {
    // the ffmpeg expression and the private-post badge both depend on this exact order
    expect(WATERMARK_CORNERS).toEqual(["bottom-left", "top-left", "bottom-right", "top-right"]);
    expect(WATERMARK_CORNER_SECONDS).toBe(3);
  });

  it("the video's overlay follows that order, driven by the frame time", () => {
    const args = buildWatermarkArgs("in", "mark.png", "out.mp4", { width: 720, height: 1280 });
    const filter = args[args.indexOf("-filter_complex") + 1]!;
    const p = markPlacement({ width: 720, height: 1280 });
    expect(filter).toContain(`x='if(lt(mod(floor(t/3),4),2),${p.x},main_w-overlay_w-${p.x})'`);
    expect(filter).toContain(`y='if(eq(mod(mod(floor(t/3),4),2),0),main_h-overlay_h-${p.inset},${p.inset})'`);
  });

  it("the same expression, evaluated, lands on the listed corner at each step", () => {
    const k = (t: number) => Math.floor(t / 3) % 4;
    const side = (t: number) => (k(t) < 2 ? "left" : "right");
    const edge = (t: number) => (k(t) % 2 === 0 ? "bottom" : "top");
    for (const t of [0, 1, 4, 7, 10, 12.5]) expect(`${edge(t)}-${side(t)}`).toBe(WATERMARK_CORNERS[k(t)]);
  });

  it("a private post shows one roving badge, not a pattern scattered over the media", () => {
    const g = src("features/sub/sub-gallery.tsx");
    expect(g).not.toContain("Array.from({ length: 40 }");
    expect(g).not.toContain("rotate-[-24deg]");
    expect(g).toContain("{data?.creatorHandle ? <RovingWatermark creatorHandle={data.creatorHandle} /> : null}");
    // the moving badge is the ONLY mark — no second, fixed creator address on the media
    expect(g).not.toContain("frenzsave.com/u/{data.creatorHandle}");
    // owner 2026-10-17: only the domain and the creator's username, linking to their /:handle profile
    expect(g).toContain("const text = `frenzsave.com${profilePath(creatorHandle)}`;");
    expect(g).toContain("<a href={profilePath(creatorHandle)}");
    expect(g).toContain("(v + 1) % WATERMARK_CORNERS.length), WATERMARK_CORNER_SECONDS * 1000)");
  });
});

describe("the server decides, not the button", () => {
  const route = src("app/api/posts/[id]/download/route.ts");

  it("a free member asking for the clean file is refused, before the daily cap is spent", () => {
    expect(route).toContain("const mayGoClean = isOwner || plan !== \"free\";");
    expect(route).toContain("if (!watermark && !mayGoClean) {");
    expect(route.indexOf("if (!watermark && !mayGoClean) {")).toBeLessThan(route.indexOf("consumeDaily("));
  });

  it("a request with no choice gets the plan's default (the SDK and native apps)", () => {
    expect(route).toContain("const watermark = asked ?? !mayGoClean;");
  });

  it("videos go to the worker with a ticket; photos are stamped in the browser", () => {
    expect(route).toContain('watermark: "burned"');
    expect(route).toContain('watermark: "draw"');
    const post = src("lib/media/download-post.ts");
    expect(post).toContain('direct: item.watermark === "burned",');
    expect(post).toContain('item.watermark === "draw" && handle');
  });

  it("only a role with ffmpeg runs the encode", () => {
    expect(src("app/api/posts/watermark/route.ts")).toContain("if (hasWorker || !WORKER_SECRET) return new Response(\"Not found\", { status: 404 });");
  });
});

describe("everyone is asked", () => {
  it("every Download in the feed, Reels and the viewers goes through the chooser, and says whose post it is", () => {
    expect(src("lib/media/download-post.ts")).toContain("const choice = await chooseDownloadVersion({ isOwner: item.isOwner });");
    expect(src("features/social/use-social-download.ts")).toContain("const choice = await chooseDownloadVersion({ isOwner: opts.isOwner });");
    for (const f of ["features/feed/feed-post-card.tsx", "features/feed/reel-viewer.tsx", "features/feed/post-viewer.tsx", "features/feed/image-viewer.tsx"]) {
      expect(src(f), f).toMatch(/downloadPost\(\{[^}]*isOwner: !!item\.isOwner/);
    }
  });

  it("a free member sees Upgrade to Pro on the clean option", () => {
    const c = src("features/media/download-choice.tsx");
    expect(c).toContain('value={mayGoClean ? "Pro" : "Upgrade to Pro"}');
    expect(c).toContain('window.location.href = "/pricing";');
  });
});

describe("the feed card and the options sheet (owner, 2026-10-14)", () => {
  it("the engagement tray sits below the media, never on it", () => {
    const card = src("features/feed/feed-post-card.tsx");
    expect(card).not.toContain("engagementRow(true)");
    expect(card).toContain("{engagementRow(false)}");
  });

  it("scrolling the sheet back up never drags it shut", () => {
    const sheet = src("features/feed/media-action-sheet.tsx");
    // framer's drag starts only from the grabber
    expect(sheet).toContain("dragListener={false}");
    expect(sheet).toContain("onPointerDown={(e) => dragControls.start(e)}");
    // the list's own pull only starts for a touch that began at the top
    expect(sheet).toContain("startedAtTop = el.scrollTop <= 0;");
    expect(sheet).toContain("if (!startedAtTop || el.scrollTop > 0 || dy <= 6) return;");
  });
});
