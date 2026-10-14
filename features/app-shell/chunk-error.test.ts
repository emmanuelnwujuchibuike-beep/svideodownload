import { describe, expect, it } from "vitest";

import { CHUNK_RELOAD_COOLDOWN_MS, isChunkLoadError, isNewDeploy, shouldAutoReload } from "./chunk-error";

describe("chunk-error decisions", () => {
  it("recognises Safari's and webpack's chunk-load errors", () => {
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("🔴 a network blip with no deploy is NOT called a new version", () => {
    expect(isNewDeploy("build-a", "build-a")).toBe(false);
    expect(isNewDeploy("build-a", undefined)).toBe(false); // offline / timed out
    expect(isNewDeploy("", "build-b")).toBe(false); // no baked stamp: can't tell
    expect(isNewDeploy("build-a", "build-b")).toBe(true);
  });

  it("🔴 an earlier auto-reload in the session does not block recovery forever", () => {
    const now = 10_000_000;
    // The old guard: one flag per session, never cleared. A resumed iOS PWA keeps
    // its session for days, so the second blip always showed the screen.
    expect(shouldAutoReload("1", now)).toBe(true);
    expect(shouldAutoReload(String(now - CHUNK_RELOAD_COOLDOWN_MS - 1), now)).toBe(true);
    expect(shouldAutoReload(null, now)).toBe(true);
  });

  it("still stops a reload loop when the reload didn't help", () => {
    const now = 10_000_000;
    expect(shouldAutoReload(String(now - 5_000), now)).toBe(false);
  });
});
