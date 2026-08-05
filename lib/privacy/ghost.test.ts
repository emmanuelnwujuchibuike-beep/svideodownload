import { describe, expect, it } from "vitest";

import {
  allSignals,
  GHOST_SIGNALS,
  ghostSignal,
  ghostedCount,
  isFullyGhosted,
  readGhostState,
  reciprocalSignals,
  writesFor,
  type GhostState,
} from "@/lib/privacy/ghost";

const visible: GhostState = allSignals(false);
const hidden: GhostState = allSignals(true);

describe("ghost signal registry", () => {
  it("has no duplicate keys and every one resolves", () => {
    const keys = GHOST_SIGNALS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(ghostSignal(k)).toBeDefined();
  });

  // The whole point: this module introduces no storage of its own.
  it("maps every signal onto storage that already exists", () => {
    for (const s of GHOST_SIGNALS) {
      expect(["privacy_settings", "user_presence_status"]).toContain(s.source);
    }
  });

  it("names the reciprocal signals so the UI can warn before the switch", () => {
    expect(reciprocalSignals().map((s) => s.key).sort()).toEqual(["last_seen", "read_receipts", "typing"]);
  });

  it("describes each signal from the other person's side", () => {
    for (const s of GHOST_SIGNALS) expect(s.blurb.length).toBeGreaterThan(20);
  });
});

describe("readGhostState", () => {
  it("reads nothing as visible — the platform defaults", () => {
    expect(readGhostState({})).toEqual(visible);
  });

  it("reads each hidden value correctly", () => {
    expect(
      readGhostState({
        presenceStatus: "invisible",
        lastSeenVisibility: "nobody",
        typingEnabled: false,
        readReceiptsEnabled: false,
        activityVisibility: "private",
        showViews: false,
      }),
    ).toEqual(hidden);
  });

  // A partial value must never read as hidden — "friends" is still visible to
  // someone, and reporting it as hidden would be the summary lying.
  it("treats a partial visibility as NOT hidden", () => {
    const state = readGhostState({ lastSeenVisibility: "friends", activityVisibility: "followers" });
    expect(state.last_seen).toBe(false);
    expect(state.activity).toBe(false);
  });

  it("treats a busy or away presence as NOT hidden", () => {
    expect(readGhostState({ presenceStatus: "busy" }).online_status).toBe(false);
    expect(readGhostState({ presenceStatus: "away" }).online_status).toBe(false);
  });

  it("treats a missing column as visible rather than hidden", () => {
    expect(readGhostState({ showViews: null }).profile_views).toBe(false);
    expect(readGhostState({ typingEnabled: undefined }).typing).toBe(false);
  });
});

describe("composite state", () => {
  it("is only fully ghosted when every signal is off", () => {
    expect(isFullyGhosted(hidden)).toBe(true);
    expect(isFullyGhosted(visible)).toBe(false);
    expect(isFullyGhosted({ ...hidden, typing: false })).toBe(false);
  });

  it("counts what is hidden", () => {
    expect(ghostedCount(visible)).toBe(0);
    expect(ghostedCount(hidden)).toBe(GHOST_SIGNALS.length);
    expect(ghostedCount({ ...visible, typing: true, activity: true })).toBe(2);
  });
});

describe("writesFor", () => {
  it("writes nothing when nothing changed", () => {
    expect(writesFor(visible, visible)).toEqual({ privacy: {}, presence: null });
  });

  it("only writes what actually differs", () => {
    const writes = writesFor({ typing: true }, visible);
    expect(writes.privacy).toEqual({ typing_indicators_enabled: false });
    expect(writes.presence).toBeNull();
  });

  it("maps the master switch onto every existing column", () => {
    const writes = writesFor(hidden, visible);
    expect(writes.privacy).toEqual({
      last_seen_visibility: "nobody",
      typing_indicators_enabled: false,
      read_receipts_enabled: false,
      activity_visibility: "private",
      show_views: false,
    });
    expect(writes.presence).toBe("invisible");
  });

  it("reverses cleanly", () => {
    const writes = writesFor(visible, hidden);
    expect(writes.privacy).toEqual({
      last_seen_visibility: "everyone",
      typing_indicators_enabled: true,
      read_receipts_enabled: true,
      activity_visibility: "public",
      show_views: true,
    });
    expect(writes.presence).toBe("available");
  });

  // We do not store the previous status, so restoring "busy" would be
  // inventing an intent the member never expressed.
  it("restores presence to available, not to a guessed previous status", () => {
    expect(writesFor({ online_status: false }, { ...visible, online_status: true }).presence).toBe("available");
  });

  it("separates the two stores so one request cannot half-succeed", () => {
    const writes = writesFor(hidden, visible);
    expect(Object.keys(writes.privacy)).not.toContain("presence");
    expect(writes.presence).not.toBeNull();
  });
});
