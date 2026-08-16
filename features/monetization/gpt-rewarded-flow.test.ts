import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Real GPT rewarded ads (owner, 2026-08-16 spec) — the whole point is that
 * Frenzsave never fakes a reward and never touches Google's ad UI. These
 * assertions pin the specific rules the spec calls "absolute" (§2/§24)
 * against the actual source, the same source-level approach used by
 * `lib/monetization/reward-sessions.test.ts` and `lib/api/batch-quota.test.ts`
 * for code that can't be meaningfully unit-tested without mocking the thing
 * being tested.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const gpt = read("features/monetization/use-gpt-rewarded-ad.ts");
const flow = read("features/monetization/use-reward-flow.ts");
const previewCard = read("features/downloader/preview-card.tsx");
const floatingProgress = read("features/downloads/floating-progress.tsx");

describe("makeRewardedVisible is called from exactly one place", () => {
  it("rewardedSlotReady only CAPTURES it as a closure, never invokes it", () => {
    const onReady = gpt.slice(gpt.indexOf("const onReady ="), gpt.indexOf("const onGranted ="));
    // Assigned behind `() =>`, i.e. deferred — not called on the spot.
    expect(onReady).toMatch(/makeVisibleRef\.current = \(\) => event\.makeRewardedVisible\(\);/);
  });

  it("show() is the only function that invokes the captured callback", () => {
    const matches = [...gpt.matchAll(/makeVisibleRef\.current\(\)/g)];
    expect(matches).toHaveLength(1);
    const show = gpt.slice(gpt.indexOf("const show = useCallback"));
    expect(show).toMatch(/makeVisibleRef\.current\(\)/);
  });

  it("show() refuses to run unless the slot already reported ready", () => {
    const show = gpt.slice(gpt.indexOf("const show = useCallback"), gpt.indexOf("const reset ="));
    expect(show).toMatch(/if \(state !== "reward_ready" \|\| !makeVisibleRef\.current\) return;/);
  });
});

describe("rewardedSlotGranted is the only event that grants a reward", () => {
  it("onGranted is the only place state becomes reward_granted", () => {
    const matches = [...gpt.matchAll(/setState\("reward_granted"\)/g)];
    expect(matches).toHaveLength(1);
    const onGranted = gpt.slice(gpt.indexOf("const onGranted ="), gpt.indexOf("const onClosed ="));
    expect(onGranted).toMatch(/setState\("reward_granted"\)/);
  });

  it("onGranted is guarded against firing twice (idempotent, §5)", () => {
    const onGranted = gpt.slice(gpt.indexOf("const onGranted ="), gpt.indexOf("const onClosed ="));
    expect(onGranted).toMatch(/grantedRef\.current\) return/);
    expect(onGranted).toMatch(/grantedRef\.current = true/);
  });

  it("rewardedSlotClosed never grants — a prior grant is preserved, not re-decided", () => {
    const onClosed = gpt.slice(gpt.indexOf("const onClosed ="), gpt.indexOf("const onRenderEnded ="));
    expect(onClosed).not.toMatch(/reward_granted/);
    // Only downgrades to "closed" when nothing was granted; otherwise leaves
    // state untouched via the functional updater.
    expect(onClosed).toMatch(/grantedRef\.current \? s : "reward_closed"/);
  });

  it("the flow orchestrator only ever unlocks from gpt.state === \"reward_granted\"", () => {
    const grantEffect = flow.slice(flow.indexOf('if (gpt.state !== "reward_granted"'));
    expect(grantEffect).toMatch(/complete\(meta\.type, session\.rewardSessionId\)/);
    expect(grantEffect).toMatch(/onGranted\(result\.items, session\.rewardSessionId\)/);
  });
});

describe("no ad is requested before explicit consent (§7)", () => {
  it("opening the sheet only sets phase to \"prompt\" — it does not call gpt.request", () => {
    const openFn = flow.slice(flow.indexOf("const open = useCallback"), flow.indexOf("const cancel = useCallback"));
    expect(openFn).not.toMatch(/gpt\.request/);
    expect(openFn).toMatch(/setPhase\("prompt"\)/);
  });

  it("gpt.request is called only from watch(), itself only reachable from a button tap", () => {
    const matches = [...flow.matchAll(/gpt\.request\(/g)];
    expect(matches).toHaveLength(1);
    const watchFn = flow.slice(flow.indexOf("const watch = useCallback"), flow.indexOf("// GPT slot ready"));
    expect(watchFn).toMatch(/gpt\.request\(/);
  });
});

describe("no automatic ad chaining (§16)", () => {
  it("DOWNLOAD_UNLOCK and VIDEO_PREVIEW are opened from different files, never from each other's grant handler", () => {
    expect(previewCard).toMatch(/useRewardFlow\("DOWNLOAD_UNLOCK"/);
    expect(previewCard).not.toMatch(/useRewardFlow\("VIDEO_PREVIEW"/);
    expect(floatingProgress).toMatch(/useRewardFlow\("VIDEO_PREVIEW"/);
    expect(floatingProgress).not.toMatch(/useRewardFlow\("DOWNLOAD_UNLOCK"/);
  });

  it("the download-unlock grant handler never opens the preview flow, and vice versa", () => {
    expect(previewCard).not.toMatch(/videoPreview\.open|VIDEO_PREVIEW/);
    expect(floatingProgress).not.toMatch(/downloadUnlock\.open|DOWNLOAD_UNLOCK/);
  });

  it("\"Review video\" opens the preview flow only from the button's own onClick", () => {
    const idx = floatingProgress.indexOf("videoPreview.open([");
    expect(idx).toBeGreaterThan(-1);
    const before = floatingProgress.slice(Math.max(0, idx - 60), idx);
    expect(before).toMatch(/onClick={\(\) =>/);
  });
});

describe("nothing Frenzsave-owned overlays Google's ad UI (§18/§24)", () => {
  it("the consent sheet is closed the instant the GPT ad becomes visible", () => {
    expect(flow).toMatch(/gpt\.state !== "reward_showing"/);
  });
});

describe("no invented duration claims (§2)", () => {
  it("neither consent sheet's copy promises a specific ad duration", () => {
    for (const bad of [/\d+\s*second/i, /\d+s\s*ad/i]) {
      expect(flow).not.toMatch(bad);
    }
  });
});
