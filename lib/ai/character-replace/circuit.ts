import "server-only";

import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { AiJobError } from "@/lib/ai/errors";
import { alertEmailHtml, sendAdminAlertOnce } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE PROVIDER CIRCUIT BREAKER (Part 8 §7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * One row per provider model in `ai_provider_health` (0158). Every submit
 * records an outcome through `ai_provider_health_record`, which counts
 * failures inside a rolling window and OPENS the circuit — `opened_until` in
 * the future — once the operator's threshold is reached. While it is open:
 *
 *   · /start refuses NEW jobs for a pipeline that needs that model, before
 *     anything is reserved, with an honest "temporarily unavailable";
 *   · a submit for a job already paid throws PROVIDER_UNAVAILABLE, which the
 *     advance service and the sweep treat as transient — the job waits, it is
 *     not refunded for a provider having a bad ten minutes;
 *   · the admin Providers panel shows the state and can close it by hand.
 *
 * After the cooldown the next submit goes through as a half-open probe; its
 * success closes the circuit, its failure re-opens it for another cooldown.
 *
 * The state lives in the database on purpose. Serverless instances share no
 * memory, so an in-process counter would be per-instance and see a fraction
 * of the failures; the row is the one place every instance reads.
 *
 * Never throws out of the recorders: a breaker that takes the product down
 * when its own table is unreachable would be the outage it exists to soften.
 */

export interface ProviderHealth {
  key: string;
  failures: number;
  successes: number;
  windowStarted: string | null;
  lastFailure: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  openedUntil: string | null;
  openedCount: number;
}

export type CircuitBreakerConfig = CharacterReplaceConfig["ops"]["circuitBreaker"];

export function isCircuitOpen(health: Pick<ProviderHealth, "openedUntil"> | null | undefined, now: number = Date.now()): boolean {
  if (!health?.openedUntil) return false;
  const until = Date.parse(health.openedUntil);
  return Number.isFinite(until) && until > now;
}

function rowToHealth(r: Record<string, unknown>): ProviderHealth {
  return {
    key: String(r.key ?? ""),
    failures: Number(r.failures ?? 0),
    successes: Number(r.successes ?? 0),
    windowStarted: (r.window_started as string | null) ?? null,
    lastFailure: (r.last_failure as string | null) ?? null,
    lastSuccess: (r.last_success as string | null) ?? null,
    lastError: (r.last_error as string | null) ?? null,
    openedUntil: (r.opened_until as string | null) ?? null,
    openedCount: Number(r.opened_count ?? 0),
  };
}

/** Every model's row — for the admin panel. Missing table (0158 not applied) reads as empty. */
export async function listProviderHealth(): Promise<ProviderHealth[]> {
  try {
    const { data, error } = await createAdminClient().from("ai_provider_health").select("*").order("key");
    if (error || !data) return [];
    return (data as Record<string, unknown>[]).map(rowToHealth);
  } catch {
    return [];
  }
}

/** The rows for these models — `open` lists the ones whose circuit is open right now. */
export async function providerHealthFor(keys: readonly string[], now: number = Date.now()): Promise<{ health: ProviderHealth[]; open: ProviderHealth[] }> {
  const wanted = Array.from(new Set(keys.filter((k) => k.length > 0)));
  if (wanted.length === 0) return { health: [], open: [] };
  try {
    const { data, error } = await createAdminClient().from("ai_provider_health").select("*").in("key", wanted);
    if (error || !data) return { health: [], open: [] };
    const health = (data as Record<string, unknown>[]).map(rowToHealth);
    return { health, open: health.filter((h) => isCircuitOpen(h, now)) };
  } catch {
    return { health: [], open: [] };
  }
}

/**
 * Record one outcome. Fire-and-forget from the submit path (`void`), awaited
 * by tests and the admin probe. Returns the state after the write, or null
 * when the write could not be made.
 */
export async function recordProviderOutcome(key: string, ok: boolean, detail: string | null, breaker: CircuitBreakerConfig): Promise<ProviderHealth | null> {
  if (!key || !breaker.enabled) return null;
  try {
    const { data, error } = await createAdminClient().rpc("ai_provider_health_record", {
      p_key: key,
      p_ok: ok,
      p_threshold: breaker.failureThreshold,
      p_window_seconds: breaker.windowSeconds,
      p_cooldown_seconds: breaker.cooldownSeconds,
      p_detail: detail ? detail.slice(0, 300) : null,
    });
    if (error || !data || typeof data !== "object") {
      if (error) console.warn("[cr/circuit] outcome not recorded", { key, ok, error: error.message });
      return null;
    }
    const d = data as Record<string, unknown>;
    const state: ProviderHealth = {
      key,
      failures: Number(d.failures ?? 0),
      successes: Number(d.successes ?? 0),
      windowStarted: (d.window_started as string | null) ?? null,
      lastFailure: null,
      lastSuccess: null,
      lastError: (d.last_error as string | null) ?? null,
      openedUntil: (d.opened_until as string | null) ?? null,
      openedCount: Number(d.opened_count ?? 0),
    };
    if (!ok && isCircuitOpen(state)) {
      console.error("[cr/circuit] OPEN", { key, failures: state.failures, openedUntil: state.openedUntil, openedCount: state.openedCount, lastError: state.lastError });
      /*
        Part 8 §24: the operator hears about it ONCE per opening (the dedupe key
        carries the opening count), through the same admin-alert door every
        other incident uses. Best-effort: an email that cannot be sent must
        not fail the submit that just failed.
      */
      void sendAdminAlertOnce(
        `cr-circuit-open:${key}:${state.openedCount}`,
        "ai_provider_circuit_open",
        `Character Replace paused a provider model: ${key}`,
        alertEmailHtml({
          heading: "A provider model was paused",
          intro: `The circuit breaker opened for ${key} after ${state.failures} failures. New Character Replace videos needing it are refused (nothing charged) and paid jobs wait until the pause passes. Admin → AI → Providers & changes can close it by hand.`,
          rows: [
            { label: "Model", value: key },
            { label: "Paused until", value: state.openedUntil ?? "—" },
            { label: "Times opened", value: String(state.openedCount) },
            { label: "Last error", value: state.lastError ?? "—" },
          ],
        }),
      ).catch(() => null);
    }
    return state;
  } catch (e) {
    console.warn("[cr/circuit] outcome not recorded", { key, ok, error: String(e).slice(0, 120) });
    return null;
  }
}

/** The operator's "Close now": zero the streak and clear the open window. */
export async function resetProviderHealth(key: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient()
      .from("ai_provider_health")
      .update({ failures: 0, successes: 0, opened_until: null, window_started: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("key", key);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Which failures count. A refused parameter, a throttle, an out-of-credit
 * answer, a 5xx, a network failure — all mean "our submits are not getting
 * through", which is exactly when new spend should pause. A member's own
 * input being refused by the model happens AFTER submission (a webhook
 * `failed`) and is not scored here.
 */
export function countsAsProviderFailure(e: unknown): boolean {
  if (e instanceof AiJobError) return e.code === "PROVIDER_UNAVAILABLE" || e.code === "PROVIDER_ERROR";
  // A thrown non-AiJobError from the HTTP layer (abort, DNS, TLS) is the provider being unreachable.
  return e instanceof Error && !(e instanceof AiJobError);
}

/**
 * Run a provider submit under the breaker: refuse while open, score the
 * outcome after. The refusal is PROVIDER_UNAVAILABLE, the same code a 429
 * carries, so every caller already treats it as transient.
 */
export async function withCircuit<T>(key: string, breaker: CircuitBreakerConfig, run: () => Promise<T>): Promise<T> {
  if (breaker.enabled) {
    const { open } = await providerHealthFor([key]);
    if (open.length > 0) {
      throw new AiJobError("PROVIDER_UNAVAILABLE", `circuit open for ${key} until ${open[0]!.openedUntil}`);
    }
  }
  try {
    const result = await run();
    void recordProviderOutcome(key, true, null, breaker);
    return result;
  } catch (e) {
    // The operator line (an AiJobError's detail), never the member-facing sentence.
    if (countsAsProviderFailure(e)) void recordProviderOutcome(key, false, e instanceof AiJobError ? (e.detail ?? e.message) : String((e as Error)?.message ?? e), breaker);
    throw e;
  }
}
