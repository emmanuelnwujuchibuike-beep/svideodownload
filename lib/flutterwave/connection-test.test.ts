import { describe, expect, it, vi } from "vitest";

/**
 * Part 5 — Admin → Flutterwave → "Test connection" (lib/flutterwave/connection-test.ts). Scripted fetch only, no
 * network: what each Flutterwave answer becomes, that the call is a read (GET, a reference that can't exist), and that
 * the result never carries the key or anything Flutterwave said.
 */
vi.mock("server-only", () => ({}));
const { resolveFlutterwaveConfig } = await import("./config");
const { CONNECTION_TEST_COPY, testFlutterwaveConnection } = await import("./connection-test");

const KEY = "FLWSECK_TEST-abcdef0123456789abcdef-X";
const cfg = resolveFlutterwaveConfig({ FLUTTERWAVE_SECRET_KEY: KEY, FLUTTERWAVE_SECRET_HASH: "hash-0123456789abcdef" });
const answer = (status: number, body: unknown) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("Flutterwave connection test", () => {
  it("a key Flutterwave accepts: 'no transaction found' for our impossible reference → connected (nothing created)", async () => {
    const f = answer(400, { status: "error", message: "No transaction was found for this id", data: null });
    expect(await testFlutterwaveConnection({ cfg, fetch: f as unknown as typeof fetch })).toEqual({ ok: true, code: "connected", mode: "test" });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toMatch(/\/transactions\/verify_by_reference\?tx_ref=frenz_conntest_[0-9a-f]{32}$/);
    expect(init?.method ?? "GET").toBe("GET");
  });

  it("a rejected key (401 / 403) → key_rejected", async () => {
    for (const s of [401, 403]) {
      const f = answer(s, { status: "error", message: `Invalid authorization key ${KEY}` });
      expect(await testFlutterwaveConnection({ cfg, fetch: f as unknown as typeof fetch })).toEqual({ ok: false, code: "key_rejected", mode: "test" });
    }
  });

  it("a 5xx, an HTML error page or a network failure → unreachable (never 'rejected')", async () => {
    for (const f of [answer(500, { status: "error", message: "internal" }), answer(502, "<html>Bad gateway</html>"), vi.fn(async () => Promise.reject(new TypeError("fetch failed")))]) {
      expect(await testFlutterwaveConnection({ cfg, fetch: f as unknown as typeof fetch })).toMatchObject({ ok: false, code: "unreachable" });
    }
  });

  it("no key → not_configured, and no request is made", async () => {
    const f = answer(200, {});
    expect(await testFlutterwaveConnection({ cfg: resolveFlutterwaveConfig({}), fetch: f as unknown as typeof fetch })).toEqual({ ok: false, code: "not_configured", mode: null });
    expect(f).not.toHaveBeenCalled();
  });

  it("🔴 the result and its copy never contain the key or the provider's own message", async () => {
    const f = answer(401, { status: "error", message: `Invalid authorization key ${KEY}` });
    const out = await testFlutterwaveConnection({ cfg, fetch: f as unknown as typeof fetch });
    const text = JSON.stringify({ ...out, message: CONNECTION_TEST_COPY[out.code] });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("Invalid authorization key");
  });
});
