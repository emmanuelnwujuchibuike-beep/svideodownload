import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The tutorial's memory.
 *
 * This suite runs in the project's default node environment (no jsdom — see
 * vitest.config.ts), so `window` is undefined until a test installs one. That is
 * useful rather than awkward: the two branches worth pinning are exactly
 * "storage works" and "storage does not", and both are reachable by choosing
 * what `window` is.
 *
 * The module holds a session fallback in a module-level variable, so every test
 * re-imports it fresh — the same discipline `inpage-push-cap.test.ts` keeps, for
 * the same reason.
 */

type TutorialModule = typeof import("./clean-tutorial");

async function freshModule(): Promise<TutorialModule> {
  vi.resetModules();
  return import("./clean-tutorial");
}

/** A localStorage that behaves. */
function workingStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    /** Test-only view of what was actually written. */
    _map: map,
  };
}

/** A locked-down private window: every access throws, as Safari's does. */
function throwingStorage() {
  return {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("SecurityError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
}

function installWindow(localStorage: unknown) {
  (globalThis as { window?: unknown }).window = { localStorage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("parseAICleanTutorialState", () => {
  it("reads the three states it wrote", async () => {
    const { parseAICleanTutorialState } = await freshModule();
    expect(parseAICleanTutorialState("unseen")).toBe("unseen");
    expect(parseAICleanTutorialState("skipped")).toBe("skipped");
    expect(parseAICleanTutorialState("completed")).toBe("completed");
  });

  it("falls back to unseen for anything it does not recognise", async () => {
    const { parseAICleanTutorialState } = await freshModule();
    // A truncated write, a value from a later release, another script's key.
    for (const raw of [null, undefined, "", "COMPLETED", "complete", "{}", "true"]) {
      expect(parseAICleanTutorialState(raw), `"${String(raw)}" leaked through`).toBe("unseen");
    }
  });
});

describe("on a device with working storage", () => {
  it("starts unseen, so the tutorial opens on a first visit", async () => {
    installWindow(workingStorage());
    const { getAICleanTutorialState, hasSeenAICleanTutorial } = await freshModule();
    expect(getAICleanTutorialState()).toBe("unseen");
    expect(hasSeenAICleanTutorial()).toBe(false);
  });

  it("🔴 remembers a skip, under the owner's exact key", async () => {
    const storage = workingStorage();
    installWindow(storage);
    const { setAICleanTutorialState, hasSeenAICleanTutorial, AI_CLEAN_TUTORIAL_KEY } = await freshModule();

    setAICleanTutorialState("skipped");

    // The key is a released contract: changing it re-shows the tutorial to
    // everyone who already dismissed it. Pinned deliberately.
    expect(AI_CLEAN_TUTORIAL_KEY).toBe("frenzsave_frenz_ai_clean_tutorial_v1");
    expect(storage._map.get("frenzsave_frenz_ai_clean_tutorial_v1")).toBe("skipped");
    expect(hasSeenAICleanTutorial()).toBe(true);
  });

  it("remembers a completion", async () => {
    installWindow(workingStorage());
    const { setAICleanTutorialState, getAICleanTutorialState, hasSeenAICleanTutorial } = await freshModule();
    setAICleanTutorialState("completed");
    expect(getAICleanTutorialState()).toBe("completed");
    expect(hasSeenAICleanTutorial()).toBe(true);
  });

  it("survives a value another script corrupted", async () => {
    installWindow(workingStorage({ frenzsave_frenz_ai_clean_tutorial_v1: "yes" }));
    const { getAICleanTutorialState } = await freshModule();
    expect(getAICleanTutorialState()).toBe("unseen");
  });

  it("resets back to first-visit behaviour", async () => {
    installWindow(workingStorage());
    const { setAICleanTutorialState, resetAICleanTutorial, hasSeenAICleanTutorial } = await freshModule();
    setAICleanTutorialState("completed");
    resetAICleanTutorial();
    expect(hasSeenAICleanTutorial()).toBe(false);
  });
});

describe("on a device where storage is blocked", () => {
  it("does not throw, and still holds the dismissal for the session", async () => {
    installWindow(throwingStorage());
    const { setAICleanTutorialState, hasSeenAICleanTutorial } = await freshModule();

    expect(hasSeenAICleanTutorial()).toBe(false);
    expect(() => setAICleanTutorialState("skipped")).not.toThrow();
    // Nothing was written to disk, so the promise is only "for this session" —
    // but reopening the tutorial on the next navigation of the same visit is
    // exactly the behaviour the owner asked to prevent.
    expect(hasSeenAICleanTutorial()).toBe(true);
  });
});

describe("on the server", () => {
  it("reports unseen without touching storage", async () => {
    // No `window` installed — this is the SSR pass.
    const { getAICleanTutorialState, hasSeenAICleanTutorial, setAICleanTutorialState } = await freshModule();
    expect(getAICleanTutorialState()).toBe("unseen");
    expect(hasSeenAICleanTutorial()).toBe(false);
    expect(() => setAICleanTutorialState("completed")).not.toThrow();
  });
});
