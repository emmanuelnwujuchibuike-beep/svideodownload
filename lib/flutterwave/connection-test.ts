import "server-only";

import { randomUUID } from "node:crypto";

import { FlutterwaveHttpError, verifyFlutterwaveByReference } from "@/lib/flutterwave/client";
import { flutterwaveConfigured, getFlutterwaveConfig, type FlutterwaveConfig } from "@/lib/flutterwave/config";

/**
 * Part 5 — the admin's "Test connection": does Flutterwave accept the saved secret key?
 *
 * One READ-ONLY call: verify a reference that cannot exist (`frenz_conntest_<uuid>`). A key Flutterwave accepts answers
 * "no transaction found" (or, impossibly, a transaction) — either way the key works and nothing was created or charged.
 * A rejected key answers 401/403. Anything else (a timeout, a 5xx, an unreadable body) is "unreachable".
 *
 * The answer is a fixed code plus the key's MODE (test/live) — never the provider's message, the key, or the response
 * body, which can echo the request. The webhook hash is not exercised here: only a delivery from Flutterwave proves it.
 */
export type ConnectionTestResult =
  | { ok: true; code: "connected"; mode: "test" | "live" }
  | { ok: false; code: "not_configured" | "key_rejected" | "unreachable"; mode: "test" | "live" | null };

export async function testFlutterwaveConnection(deps: { cfg?: FlutterwaveConfig; fetch?: typeof fetch } = {}): Promise<ConnectionTestResult> {
  const cfg = deps.cfg ?? (await getFlutterwaveConfig());
  if (!flutterwaveConfigured(cfg) || !cfg.secretKey) return { ok: false, code: "not_configured", mode: null };
  const mode = cfg.mode;
  try {
    await verifyFlutterwaveByReference(`frenz_conntest_${randomUUID().replace(/-/g, "")}`, { cfg, fetch: deps.fetch });
    return { ok: true, code: "connected", mode };
  } catch (e) {
    if (e instanceof FlutterwaveHttpError && (e.httpStatus === 401 || e.httpStatus === 403)) return { ok: false, code: "key_rejected", mode };
    return { ok: false, code: "unreachable", mode };
  }
}

/** What the admin reads for each code — fixed copy, nothing from the provider. */
export const CONNECTION_TEST_COPY: Record<ConnectionTestResult["code"], string> = {
  connected: "Connected — Flutterwave accepted the secret key. Nothing was charged or created.",
  not_configured: "No Flutterwave secret key saved yet (dashboard or environment).",
  key_rejected: "Flutterwave rejected the secret key. Check it is the right key for this mode (test or live) and save it again.",
  unreachable: "Couldn't reach Flutterwave just now (timeout or a server error on their side). Try again in a minute.",
};
