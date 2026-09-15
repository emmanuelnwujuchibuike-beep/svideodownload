import { beforeEach, describe, expect, it, vi } from "vitest";

import { AiJobError } from "@/lib/ai/errors";

/**
 * Failure injection for the circuit breaker (Part 8 §7, §32): the database is
 * a fake with one row, so the tests drive the breaker through open / closed /
 * missing-table without a provider or a network.
 */
type Row = { key: string; failures: number; successes: number; opened_until: string | null; opened_count: number; last_error: string | null; window_started: string | null; last_failure: string | null; last_success: string | null };
const rows = new Map<string, Row>();
const rpc = vi.fn();
const alerts: string[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    from: (table: string) => {
      if (table !== "ai_provider_health") throw new Error(`unexpected table ${table}`);
      const chain = {
        select: () => chain,
        order: () => Promise.resolve({ data: [...rows.values()], error: null }),
        in: (_col: string, keys: string[]) => Promise.resolve({ data: keys.map((k) => rows.get(k)).filter(Boolean), error: null }),
        update: (patch: Partial<Row>) => ({
          eq: (_c: string, key: string) => {
            const r = rows.get(key);
            if (r) Object.assign(r, patch);
            return Promise.resolve({ error: null });
          },
        }),
      };
      return chain;
    },
  }),
}));
vi.mock("@/lib/notify", () => ({
  sendAdminAlertOnce: async (key: string) => {
    alerts.push(key);
    return "sent";
  },
  alertEmailHtml: () => "<p/>",
}));

const { withCircuit, recordProviderOutcome, providerHealthFor, resetProviderHealth } = await import("./circuit");

const breaker = { enabled: true, failureThreshold: 3, windowSeconds: 600, cooldownSeconds: 300 };
const inFuture = new Date(Date.now() + 60_000).toISOString();
const inPast = new Date(Date.now() - 60_000).toISOString();

beforeEach(() => {
  rows.clear();
  rpc.mockReset();
  alerts.length = 0;
});

describe("withCircuit", () => {
  it("runs the submit and records a success when the circuit is closed", async () => {
    rpc.mockResolvedValue({ data: { failures: 0, successes: 1, opened_until: null, opened_count: 0, last_error: null }, error: null });
    const out = await withCircuit("acme/model", breaker, async () => "created");
    expect(out).toBe("created");
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledWith("ai_provider_health_record", expect.objectContaining({ p_key: "acme/model", p_ok: true, p_threshold: 3, p_window_seconds: 600, p_cooldown_seconds: 300 }));
  });

  it("refuses with PROVIDER_UNAVAILABLE while the circuit is open, without calling the provider", async () => {
    rows.set("acme/model", { key: "acme/model", failures: 3, successes: 0, opened_until: inFuture, opened_count: 1, last_error: "429", window_started: null, last_failure: null, last_success: null });
    const run = vi.fn(async () => "created");
    await expect(withCircuit("acme/model", breaker, run)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(run).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets the half-open probe through once the cooldown has passed", async () => {
    rows.set("acme/model", { key: "acme/model", failures: 3, successes: 0, opened_until: inPast, opened_count: 1, last_error: "429", window_started: null, last_failure: null, last_success: null });
    rpc.mockResolvedValue({ data: { failures: 0, successes: 1, opened_until: null, opened_count: 1, last_error: null }, error: null });
    await expect(withCircuit("acme/model", breaker, async () => "probe ok")).resolves.toBe("probe ok");
  });

  it("scores a provider failure and re-throws it unchanged; a member's input error is re-thrown and NOT scored", async () => {
    rpc.mockResolvedValue({ data: { failures: 1, successes: 0, opened_until: null, opened_count: 0, last_error: "502" }, error: null });
    const providerDown = new AiJobError("PROVIDER_ERROR", "replicate 502");
    await expect(withCircuit("acme/model", breaker, async () => Promise.reject(providerDown))).rejects.toBe(providerDown);
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_ok: false, p_detail: "replicate 502" });

    rpc.mockClear();
    const badInput = new AiJobError("INVALID_INPUT", "language not spoken");
    await expect(withCircuit("acme/model", breaker, async () => Promise.reject(badInput))).rejects.toBe(badInput);
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("with the breaker off it neither reads nor writes the table", async () => {
    rows.set("acme/model", { key: "acme/model", failures: 9, successes: 0, opened_until: inFuture, opened_count: 3, last_error: "x", window_started: null, last_failure: null, last_success: null });
    await expect(withCircuit("acme/model", { ...breaker, enabled: false }, async () => "ran")).resolves.toBe("ran");
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordProviderOutcome", () => {
  it("alerts the operator ONCE per opening, keyed by the opening count", async () => {
    rpc.mockResolvedValue({ data: { failures: 3, successes: 0, opened_until: inFuture, opened_count: 2, last_error: "429" }, error: null });
    const state = await recordProviderOutcome("acme/model", false, "429", breaker);
    expect(state?.openedUntil).toBe(inFuture);
    await new Promise((r) => setTimeout(r, 0));
    expect(alerts).toEqual(["cr-circuit-open:acme/model:2"]);
    // a success never alerts
    rpc.mockResolvedValue({ data: { failures: 0, successes: 1, opened_until: null, opened_count: 2, last_error: null }, error: null });
    await recordProviderOutcome("acme/model", true, null, breaker);
    await new Promise((r) => setTimeout(r, 0));
    expect(alerts).toHaveLength(1);
  });

  it("a missing table (0158 not applied) or a thrown client is a null, never a throw", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "relation ai_provider_health does not exist" } });
    await expect(recordProviderOutcome("acme/model", false, "x", breaker)).resolves.toBeNull();
    rpc.mockRejectedValue(new Error("network"));
    await expect(recordProviderOutcome("acme/model", false, "x", breaker)).resolves.toBeNull();
  });
});

describe("providerHealthFor / resetProviderHealth", () => {
  it("lists only the open ones as open; the operator's close clears the row", async () => {
    rows.set("a/open", { key: "a/open", failures: 3, successes: 0, opened_until: inFuture, opened_count: 1, last_error: "429", window_started: null, last_failure: null, last_success: null });
    rows.set("b/closed", { key: "b/closed", failures: 1, successes: 4, opened_until: null, opened_count: 0, last_error: null, window_started: null, last_failure: null, last_success: null });
    const { health, open } = await providerHealthFor(["a/open", "b/closed", "c/never"]);
    expect(health.map((h) => h.key).sort()).toEqual(["a/open", "b/closed"]);
    expect(open.map((h) => h.key)).toEqual(["a/open"]);
    expect(await resetProviderHealth("a/open")).toBe(true);
    const after = await providerHealthFor(["a/open"]);
    expect(after.open).toEqual([]);
    expect(after.health[0]?.failures).toBe(0);
  });
});
