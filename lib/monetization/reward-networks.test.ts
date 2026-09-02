import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REWARD_NETWORKS,
  REWARD_NETWORK_DEFS,
  REWARD_SURFACES,
  gptAdUnitFor,
  mergeRewardNetworks,
  networkDef,
  resolveRewardNetwork,
  type RewardNetworkMap,
} from "./reward-networks";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const CAPS = { offeriumConfigured: false };
const CONFIGURED = { offeriumConfigured: true };

describe("defaults describe what the product ACTUALLY does today", () => {
  /*
    The whole value of a routing table is that reading it tells you the truth.
    A default of `gpt_rewarded` on the HD gate would have been a lie: that flow
    is deliberately paused (no Google Ad Manager account — Google's public TEST
    unit doesn't fill in production, so every top-quality download dead-ended).
  */
  it("routes HD and preview unlocks to the reward_video gate, not GPT", () => {
    expect(DEFAULT_REWARD_NETWORKS.hd_download.network).toBe("rewarded_video");
    expect(DEFAULT_REWARD_NETWORKS.video_preview.network).toBe("rewarded_video");
  });

  it("routes every batch moment to the full-screen interstitial", () => {
    expect(DEFAULT_REWARD_NETWORKS.multilink_batch.network).toBe("interstitial");
    expect(DEFAULT_REWARD_NETWORKS.batch_download.network).toBe("interstitial");
    expect(DEFAULT_REWARD_NETWORKS.batch_complete.network).toBe("interstitial");
  });

  it("has a default for every declared surface, and no extras", () => {
    expect(Object.keys(DEFAULT_REWARD_NETWORKS).sort()).toEqual(
      REWARD_SURFACES.map((s) => s.id).sort(),
    );
  });

  it("every default is a network its own surface supports", () => {
    for (const def of REWARD_SURFACES) {
      expect(def.supports, def.id).toContain(DEFAULT_REWARD_NETWORKS[def.id].network);
      expect(def.supports, `${def.id} fallback`).toContain(def.fallback);
    }
  });
});

describe("post-event moments never offer a rewarded format", () => {
  /*
    A rewarded ad's contract is "watch this and I unlock that". These three
    run AFTER the thing already happened, so there is no "that" — offering GPT
    or an offerwall would be a control that cannot do what its label says.
  */
  it.each(["batch_complete", "multilink_fetch", "wallpaper", "history_video"] as const)("%s", (id) => {
    const def = REWARD_SURFACES.find((s) => s.id === id)!;
    expect(def.supports).not.toContain("gpt_rewarded");
    expect(def.supports).not.toContain("offerium");
    expect(def.supports).toEqual(["interstitial", "none"]);
    // …and it says WHY, so the absence reads as a decision, not an oversight.
    expect(def.note).toBeTruthy();
  });
});

describe("resolution falls back rather than dead-ending", () => {
  const map = (over: Partial<RewardNetworkMap>): RewardNetworkMap => ({
    ...DEFAULT_REWARD_NETWORKS,
    ...over,
  });

  it("passes a supported, available choice straight through", () => {
    const r = resolveRewardNetwork(
      "multilink_batch",
      map({ multilink_batch: { network: "gpt_rewarded", gptAdUnitPath: "" } }),
      CAPS,
    );
    expect(r).toMatchObject({ network: "gpt_rewarded", fellBackFrom: null });
  });

  it("falls back when a stored value isn't supported on that surface", () => {
    // e.g. an older build, or a hand-edited settings row.
    const r = resolveRewardNetwork(
      "wallpaper",
      map({ wallpaper: { network: "gpt_rewarded", gptAdUnitPath: "" } }),
      CAPS,
    );
    expect(r.network).toBe("interstitial");
    expect(r.fellBackFrom).toBe("gpt_rewarded");
    expect(r.reason).toMatch(/isn't supported/);
  });

  it("falls back for Offerium when it isn't configured", () => {
    const r = resolveRewardNetwork(
      "batch_download",
      map({ batch_download: { network: "offerium", gptAdUnitPath: "" } }),
      CAPS,
    );
    expect(r.network).toBe("interstitial");
    expect(r.reason).toMatch(/configured/);
  });

  it("STILL falls back for Offerium even when fully configured", () => {
    /*
      The integration itself doesn't exist — `verifyOfferiumPostback` throws on
      purpose. Credentials being present doesn't change that, and a visitor must
      never be shown a gate nothing can satisfy.
    */
    const r = resolveRewardNetwork(
      "batch_download",
      map({ batch_download: { network: "offerium", gptAdUnitPath: "" } }),
      CONFIGURED,
    );
    expect(r.network).toBe("interstitial");
    expect(r.fellBackFrom).toBe("offerium");
    expect(r.reason).toMatch(/not built/);
  });

  it("uses the surface default when nothing is stored at all", () => {
    expect(resolveRewardNetwork("hd_download", null, CAPS).network).toBe("rewarded_video");
    expect(resolveRewardNetwork("multilink_batch", undefined, CAPS).network).toBe("interstitial");
  });

  it("marks Offerium unavailable with a reason, so the admin isn't left guessing", () => {
    const off = networkDef("offerium");
    expect(off.available).toBe(false);
    expect(off.unavailableReason).toMatch(/postback|docs/i);
    // Every other listed network really is servable.
    for (const n of REWARD_NETWORK_DEFS.filter((d) => d.id !== "offerium")) {
      expect(n.available, n.id).toBe(true);
    }
  });
});

describe("merging a stored map", () => {
  it("fills gaps from the defaults", () => {
    const merged = mergeRewardNetworks({ multilink_batch: { network: "none", gptAdUnitPath: "" } });
    expect(merged.multilink_batch.network).toBe("none");
    expect(merged.hd_download.network).toBe("rewarded_video");
  });

  it("discards a value the surface doesn't support instead of storing it", () => {
    const merged = mergeRewardNetworks({ wallpaper: { network: "gpt_rewarded", gptAdUnitPath: "" } });
    expect(merged.wallpaper.network).toBe("interstitial");
  });

  it("survives junk without throwing", () => {
    expect(mergeRewardNetworks(null)).toEqual(DEFAULT_REWARD_NETWORKS);
    expect(mergeRewardNetworks("nonsense")).toEqual(DEFAULT_REWARD_NETWORKS);
    expect(mergeRewardNetworks({ multilink_batch: 42 })).toEqual(DEFAULT_REWARD_NETWORKS);
  });

  it("keeps a per-surface GPT ad unit", () => {
    const merged = mergeRewardNetworks({
      multilink_batch: { network: "gpt_rewarded", gptAdUnitPath: "/123/multilink" },
    });
    expect(gptAdUnitFor("multilink_batch", merged)).toBe("/123/multilink");
    expect(gptAdUnitFor("hd_download", merged)).toBe("");
  });
});

/** Every surface must actually be consulted somewhere, or the row is decoration. */
describe("each surface is wired at a real call site", () => {
  const panel = read("features/downloader/multi-link/multi-link-panel.tsx");
  const gate = read("features/downloader/batch-ad-gate.tsx");
  const preview = read("features/downloader/preview-card.tsx");
  const wallpaper = read("features/wallpapers/use-wallpaper-interstitial.ts");
  const history = read("features/monetization/download-interstitial.tsx");

  it("multilink_batch — the multi-link panel declares its own surface", () => {
    expect(panel).toMatch(/surface="multilink_batch"/);
  });

  it("batch_download — the gate's default, so preview-card keeps its behaviour", () => {
    expect(gate).toMatch(/surface = "batch_download"/);
  });

  it("batch_complete — checked before the closing ad opens", () => {
    expect(gate).toMatch(/useRewardNetwork\("batch_complete"\)/);
    expect(gate).toMatch(/completeNetwork === "none"/);
  });

  it("hd_download — routes the quality gate, GPT included", () => {
    expect(preview).toMatch(/useRewardNetwork\("hd_download"\)/);
    expect(preview).toMatch(/hdNetwork\.network === "gpt_rewarded"/);
    expect(preview).toMatch(/hdNetwork\.network === "none"/);
  });

  it("multilink_fetch — the post-fetch vignette honours it", () => {
    const fetchGate = read("features/downloader/multi-link/fetch-ad-gate.tsx");
    expect(fetchGate).toMatch(/useRewardNetwork\("multilink_fetch"\)/);
    expect(fetchGate).toMatch(/network === "none"/);
  });

  it("wallpaper and history_video — honoured at their triggers", () => {
    expect(wallpaper).toMatch(/useRewardNetwork\("wallpaper"\)/);
    expect(wallpaper).toMatch(/network === "none"/);
    expect(history).toMatch(/useRewardNetwork\("history_video"\)/);
    expect(history).toMatch(/historyNetwork === "none"/);
  });

  it("video_preview — declared, and honestly noted as dormant", () => {
    // The GPT preview flow is wired but never opened (no Ad Manager account).
    // The routing row exists so it becomes a switch the day one does.
    const dl = read("features/downloads/floating-progress.tsx");
    expect(dl).toMatch(/useRewardFlow\("VIDEO_PREVIEW"/);
  });
});

describe("premium always wins over any routing choice", () => {
  it("the gate checks showAds before it ever looks at the network", () => {
    const gate = read("features/downloader/batch-ad-gate.tsx");
    const openEffect = gate.slice(gate.indexOf("// ── Open the gate"), gate.indexOf("Ceiling for a slot"));
    const showAdsAt = openEffect.indexOf("!showAds");
    const networkAt = openEffect.indexOf('network === "none"');
    expect(showAdsAt).toBeGreaterThan(-1);
    expect(networkAt).toBeGreaterThan(-1);
    // An ad shown to someone who paid not to see ads is the worst outcome
    // available here, so no routing branch may precede that check.
    expect(showAdsAt).toBeLessThan(networkAt);
  });
});

describe("🔴 the Hilltop VAST as the stand-in reward gate (owner, 2026-09-02)", () => {
  /*
    "i want hiltop vast to be the acting reward ad in place of offerium untill
    offerium approved, so the batch download, top 2 quality download started
    should show hiltop ad."

    Hilltop genuinely has no REWARDED product, and that fact is why this list
    was not simply widened. The gate is OURS: an ordinary VAST plays and our
    own code grants the unlock when it finishes. Nothing is claimed to the
    network as a rewarded impression.
  */
  it("offers the interstitial on the top-quality unlock", () => {
    const hd = REWARD_SURFACES.find((s) => s.id === "hd_download")!;
    expect(hd.supports).toContain("interstitial");
  });

  it("keeps the batch gates on it too, so both download-started moments match", () => {
    for (const id of ["batch_download", "multilink_batch"] as const) {
      const surface = REWARD_SURFACES.find((s) => s.id === id)!;
      expect(surface.supports, id).toContain("interstitial");
    }
  });

  it("🔴 does NOT offer it where there is nothing left to unlock", () => {
    /*
      A gate must front a locked thing. `batch_complete` runs AFTER the files
      are saved, so a reward there would be granting something already given —
      the same reasoning that keeps rewarded formats off that row.
    */
    const done = REWARD_SURFACES.find((s) => s.id === "batch_complete")!;
    expect(done.supports).not.toContain("gpt_rewarded");
    expect(done.supports).not.toContain("rewarded_video");
  });

  it("🔴 leaves Offerium available everywhere it already was", () => {
    // This is a STAND-IN, not a replacement. Switching back when Offerium is
    // approved must be one dropdown, not a deploy.
    // Only the surfaces that ever offered it — `wallpaper` and the post-event
    // rows are interstitial-or-nothing by design and always were.
    for (const id of ["hd_download", "batch_download", "multilink_batch", "video_preview"] as const) {
      const surface = REWARD_SURFACES.find((s) => s.id === id)!;
      expect(surface.supports, id).toContain("offerium");
    }
  });
});
