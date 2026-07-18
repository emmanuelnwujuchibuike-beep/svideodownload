import { statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GATEWAY_ACTIONS, getAction } from "./actions";
import { recommend, recommendAll, resolveAvailability, scoreAction } from "./recommend";
import type { DownloadContext } from "./types";
import { getModule } from "@/lib/platform/modules";

/**
 * Discovery Gateway™ tests. See `docs/DOWNLOAD_HUB_RFC.md` §3.
 *
 * The first block is the important one. The Gateway declares ten destinations and
 * eight of them do not exist, which is only safe because availability is derived
 * and tense follows availability. These tests are what make that structural rather
 * than a thing someone has to remember.
 */

const ROOT = path.resolve(__dirname, "../..");

function routeExists(href: string): boolean {
  const clean = href.replace(/^\//, "").split("?")[0]!;
  if (!clean) return true; // "/" is the marketing root
  return ["app/(app)", "app/(marketing)", "app"].some((base) => {
    try {
      return statSync(path.join(ROOT, base, clean)).isDirectory();
    } catch {
      return false;
    }
  });
}

const base: DownloadContext = {
  platformId: "tiktok",
  kind: "video",
  durationSec: 30,
  height: 1080,
  hasAudio: true,
  signedIn: true,
  plan: "free",
  downloadCount: 1,
};

const ctx = (over: Partial<DownloadContext> = {}): DownloadContext => ({ ...base, ...over });

/* ------------------------------------------------------------------ */

describe("Discovery Gateway — truthfulness", () => {
  it("resolves an unknown product to `planned` (fail-closed)", () => {
    // The default must be safe. An action for a product nobody has built should
    // never be promoted by accident.
    const unknown = { ...GATEWAY_ACTIONS[0]!, productId: "does-not-exist" };
    expect(resolveAvailability(unknown)).toBe("planned");
  });

  it("derives `live` only for products the genome marks claimable", () => {
    for (const action of GATEWAY_ACTIONS) {
      if (resolveAvailability(action) !== "live") continue;
      const product = getModule(action.productId);
      // Either a claimable genome product, or a test-verified core content surface.
      if (product) {
        expect(product.veracity.claimable, `${action.id} → ${action.productId}`).toBe(true);
      }
    }
  });

  it("never routes to a page that does not exist", () => {
    // The hole this closes: `CORE_LIVE_PRODUCTS` bypasses the genome, so a typo'd
    // id there would silently mark a nonexistent destination live.
    const broken = GATEWAY_ACTIONS.filter(
      (a) => a.target.type === "route" && !routeExists((a.target as { href: string }).href),
    ).map((a) => `${a.id} → ${(a.target as { href: string }).href}`);
    expect(broken, `Actions pointing at missing routes:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("gives every `planned` action a waitlist target, never a fake CTA", () => {
    for (const action of GATEWAY_ACTIONS) {
      if (resolveAvailability(action) !== "planned") continue;
      expect(
        action.target.type,
        `${action.id} is planned but targets a ${action.target.type}`,
      ).toBe("waitlist");
    }
  });

  it("labels every `planned` recommendation in future tense", () => {
    // This is the assertion that makes declaring eight unbuilt destinations safe.
    const recs = recommendAll(ctx({ downloadCount: 30 }));
    const planned = recs.filter((r) => r.availability === "planned");
    expect(planned.length).toBeGreaterThan(0); // guard: no vacuous pass
    for (const r of planned) {
      expect(r.label, `${r.action.id}`).toBe(r.action.plannedLabel);
      expect(r.label.toLowerCase(), `${r.action.id} reads as available`).toMatch(/coming soon/);
    }
  });

  it("ranks a live destination above a planned one at equal fit", () => {
    const live = getAction("send-to-chat")!;
    const planned = getAction("edit-video")!;
    const c = ctx({ durationSec: 20 });
    // Both fit a short clip perfectly; availability is what should separate them.
    expect(live.fit(c)).toBe(1);
    expect(planned.fit(c)).toBe(1);
    expect(scoreAction(live, c)).toBeGreaterThan(scoreAction(planned, c));
  });

  it("declares every destination the brief asks for", () => {
    // Scope guard. The temptation is to quietly drop the unbuilt eight; this fails
    // if that happens.
    const ids = GATEWAY_ACTIONS.map((a) => a.id);
    for (const required of [
      "edit-video",
      "enhance-quality",
      "generate-subtitles",
      "translate-subtitles",
      "make-thumbnail",
      "voice-over",
      "save-to-cloud",
      "organize-project",
      "send-to-chat",
      "publish-post",
      "marketplace",
      "learn",
    ]) {
      expect(ids, `${required} was dropped from the catalogue`).toContain(required);
    }
  });
});

describe("Discovery Gateway — contextual ranking", () => {
  it("recommends subtitles for long spoken video, not for a silent clip", () => {
    const subs = getAction("generate-subtitles")!;
    expect(subs.fit(ctx({ durationSec: 600, hasAudio: true }))).toBe(1);
    expect(subs.fit(ctx({ hasAudio: false }))).toBe(0);
  });

  it("does not recommend an upscaler for high-resolution media", () => {
    const enhance = getAction("enhance-quality")!;
    expect(enhance.fit(ctx({ height: 1080 }))).toBe(0);
    expect(enhance.fit(ctx({ height: 360 }))).toBeGreaterThan(0.5);
  });

  it("does not offer audio extraction on an audio-only download", () => {
    expect(getAction("extract-audio")!.fit(ctx({ kind: "audio" }))).toBe(0);
  });

  it("surfaces Explore to a first-time visitor over a returning one", () => {
    const explore = getAction("explore-community")!;
    expect(explore.fit(ctx({ downloadCount: 1 }))).toBeGreaterThan(
      explore.fit(ctx({ downloadCount: 20 })),
    );
  });

  it("values cloud sync more as a library grows", () => {
    const cloud = getAction("save-to-cloud")!;
    expect(cloud.fit(ctx({ downloadCount: 20 }))).toBeGreaterThan(
      cloud.fit(ctx({ downloadCount: 1 })),
    );
  });

  it("caps fit at 1 however large the library gets", () => {
    expect(getAction("save-to-cloud")!.fit(ctx({ downloadCount: 10_000 }))).toBe(1);
  });
});

describe("Discovery Gateway — the panel", () => {
  it("returns three recommendations by default", () => {
    expect(recommend(ctx())).toHaveLength(3);
  });

  it("does not show three variations of the same idea", () => {
    const groups = recommend(ctx()).map((r) => r.action.group);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("is deterministic across calls", () => {
    const a = recommend(ctx()).map((r) => r.action.id);
    const b = recommend(ctx()).map((r) => r.action.id);
    expect(a).toEqual(b);
  });

  it("never returns a dismissed action", () => {
    const first = recommend(ctx())[0]!.action.id;
    const after = recommend(ctx(), { memory: { dismissed: [first], taken: [] } });
    expect(after.map((r) => r.action.id)).not.toContain(first);
  });

  it("demotes but does not erase an action already taken", () => {
    const id = "publish-reel";
    const taken = recommendAll(ctx({ durationSec: 20 }), { dismissed: [], taken: [id] });
    expect(taken.map((r) => r.action.id)).toContain(id);
    const fresh = recommendAll(ctx({ durationSec: 20 }));
    const rank = (list: typeof fresh) => list.findIndex((r) => r.action.id === id);
    expect(rank(taken)).toBeGreaterThan(rank(fresh));
  });

  it("still recommends to a signed-out visitor", () => {
    // The download is the acquisition event — an empty panel wastes it.
    expect(recommend(ctx({ signedIn: false })).length).toBeGreaterThan(0);
  });

  it("discounts auth-gated actions for signed-out visitors", () => {
    const action = getAction("publish-reel")!;
    const c = ctx({ durationSec: 20 });
    expect(scoreAction(action, { ...c, signedIn: false })).toBeLessThan(
      scoreAction(action, { ...c, signedIn: true }),
    );
  });

  it("gives every recommendation a reason", () => {
    for (const r of recommendAll(ctx())) {
      expect(r.reason.length, r.action.id).toBeGreaterThan(0);
    }
  });

  it("handles an image download without crashing or recommending video tools", () => {
    const ids = recommendAll(ctx({ kind: "image", durationSec: 0, hasAudio: false })).map(
      (r) => r.action.id,
    );
    expect(ids).not.toContain("extract-audio");
    expect(ids).not.toContain("generate-subtitles");
    expect(ids.length).toBeGreaterThan(0);
  });
});
