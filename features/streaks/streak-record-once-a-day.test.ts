import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `recordStreakActivity` used to POST /api/streak on EVERY page open, because
 * `streak-tracker.tsx` mounts on every page. One Vercel function invocation per
 * pageview, all day, to re-assert a fact that changes once a day.
 *
 * These tests pin the two halves of the fix that matter:
 *   · it stops asking once the server has confirmed today, and
 *   · it FAILS OPEN — every uncertain case still sends the POST, so the guard
 *     can save a request but can never lose a streak.
 *
 * There is no DOM environment in this project, so the module's own
 * `typeof window === "undefined"` check is satisfied with a minimal stub —
 * which is also the honest way to exercise the private-mode branch.
 */

const TODAY = new Date().toLocaleDateString("en-CA");

function fakeStorage(seed: Record<string, string> = {}, opts: { throws?: boolean } = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem(k: string) {
      if (opts.throws) throw new Error("private mode");
      return map.get(k) ?? null;
    },
    setItem(k: string, v: string) {
      if (opts.throws) throw new Error("private mode");
      map.set(k, v);
    },
    removeItem(k: string) {
      map.delete(k);
    },
  };
}

function install(storage: ReturnType<typeof fakeStorage>) {
  (globalThis as Record<string, unknown>).window = { localStorage: storage };
}

/** A fresh module per test — the guard reads storage at call time, but the
 *  SWR cache inside the module must not leak between cases. */
async function loadModule() {
  vi.resetModules();
  return import("./use-streak");
}

const OK_STATE = { currentStreak: 3, today: TODAY, shouldCelebrate: false };

function mockFetch(response: { ok: boolean; body?: unknown }) {
  const spy = vi.fn().mockResolvedValue({
    ok: response.ok,
    json: async () => response.body ?? OK_STATE,
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.stubGlobal("Intl", { DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "UTC" }) }) } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>).window;
});

describe("recordStreakActivity — once a day per device", () => {
  it("POSTs when nothing has been recorded yet", async () => {
    install(fakeStorage());
    const fetchSpy = mockFetch({ ok: true });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("THE FIX: does not POST again once today is confirmed", async () => {
    const storage = fakeStorage();
    install(storage);
    const fetchSpy = mockFetch({ ok: true });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity(); // page 1 — records
    await recordStreakActivity(); // page 2 — must not ask again
    await recordStreakActivity(); // page 3

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(storage.map.get("frenz:streak-recorded")).toBe(TODAY);
  });

  it("records again on a NEW day — the marker is a date, not a boolean", async () => {
    install(fakeStorage({ "frenz:streak-recorded": "2020-01-01" }));
    const fetchSpy = mockFetch({ ok: true });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  /* ── FAILS OPEN: every uncertain case must still send the POST ─────────── */

  it("does NOT mark the day when the server refuses, so the next open retries", async () => {
    const storage = fakeStorage();
    install(storage);
    const fetchSpy = mockFetch({ ok: false });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();
    await recordStreakActivity();

    // A non-ok answer recorded nothing, so suppressing the retry would lose
    // the day entirely.
    expect(storage.map.has("frenz:streak-recorded")).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does NOT mark the day when the request throws", async () => {
    const storage = fakeStorage();
    install(storage);
    const fetchSpy = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchSpy);
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();
    await recordStreakActivity();

    expect(storage.map.has("frenz:streak-recorded")).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("still POSTs every time when localStorage throws (private mode)", async () => {
    install(fakeStorage({}, { throws: true }));
    const fetchSpy = mockFetch({ ok: true });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();
    await recordStreakActivity();

    // Unreadable storage must degrade to the OLD behaviour, never to silence.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("TEETH: a marker for today is the ONLY thing that suppresses the POST", async () => {
    // If the guard were keyed on mere presence rather than on today's date,
    // this stale marker would wrongly suppress the request — which is how a
    // streak would silently stop being recorded.
    install(fakeStorage({ "frenz:streak-recorded": "not-a-date" }));
    const fetchSpy = mockFetch({ ok: true });
    const { recordStreakActivity } = await loadModule();

    await recordStreakActivity();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
