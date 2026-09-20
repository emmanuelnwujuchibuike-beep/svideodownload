import "server-only";

import type { CharacterReplaceConfig } from "@/lib/ai/character-replace/config";
import { LIVE_RATE_TTL_MS, minorPerUsdFrom, parseErApiAnswer, parseFawazAnswer, STORED_RATE_MAX_AGE_MS, type RateAnswer, type ResolvedRate } from "@/lib/ai/character-replace/fx-rate";
import { conversionApplies } from "@/lib/ai/character-replace/topup-fx";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LIVE RATE — fetched, cached, remembered, with a manual floor
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `resolveCheckoutRate` is what the recharge initializer and the balance
 * route call. In order:
 *
 *   1. the in-process cache (an hour) — most checkouts pay nothing for this;
 *   2. a live fetch: open.er-api.com, then the jsDelivr currency CDN — 4 s
 *      each, keyless, both updated daily. A good answer is written to the
 *      `settings` table (key `fx_rates`) as the last-good rate;
 *   3. the stored last-good rate, if under a week old;
 *   4. the operator's manual rate (`localMinorUnitsPerUsd`), if set;
 *   5. null — the initializer answers 503 "Payments aren't set up for this
 *      currency yet", never a guessed number.
 *
 * The markup (`recharge.fxMarkupPercent`) is applied to a MARKET rate only;
 * a manual rate is taken as typed. Whatever this returns is pinned in the
 * Paystack metadata at initialize (topup-fx.ts), so the credit at verify is
 * exact regardless of how the rate moves afterwards.
 */

const SETTINGS_KEY = "fx_rates";
const FETCH_TIMEOUT_MS = 4_000;

interface StoredRate {
  perUsd: number;
  provider: string;
  fetchedAt: string;
  asOf: string | null;
}

/** Per currency, per process. */
const memory = new Map<string, { rate: StoredRate; at: number }>();

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store", headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const PROVIDERS: { name: string; url: (cur: string) => string; parse: (json: unknown, cur: string) => RateAnswer | null }[] = [
  { name: "er-api", url: () => "https://open.er-api.com/v6/latest/USD", parse: parseErApiAnswer },
  { name: "fawaz", url: () => "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", parse: parseFawazAnswer },
];

/** Ask the providers in order; the first sane answer wins. Null when none answered. */
export async function fetchLiveRate(currency: string): Promise<StoredRate | null> {
  for (const p of PROVIDERS) {
    try {
      const answer = p.parse(await fetchJson(p.url(currency)), currency);
      if (answer) return { perUsd: answer.perUsd, provider: p.name, fetchedAt: new Date().toISOString(), asOf: answer.asOf };
      console.warn("[cr/fx] provider answered without a usable rate", { provider: p.name, currency });
    } catch (e) {
      console.warn("[cr/fx] provider failed", { provider: p.name, currency, error: String(e).slice(0, 120) });
    }
  }
  return null;
}

async function readStored(currency: string): Promise<StoredRate | null> {
  try {
    const { data } = await createAdminClient().from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const all = (data?.value ?? {}) as Record<string, unknown>;
    const row = all[currency.toUpperCase()];
    if (!row || typeof row !== "object") return null;
    const r = row as Partial<StoredRate>;
    if (typeof r.perUsd !== "number" || !Number.isFinite(r.perUsd) || typeof r.fetchedAt !== "string") return null;
    return { perUsd: r.perUsd, provider: typeof r.provider === "string" ? r.provider : "stored", fetchedAt: r.fetchedAt, asOf: typeof r.asOf === "string" ? r.asOf : null };
  } catch {
    return null;
  }
}

async function writeStored(currency: string, rate: StoredRate): Promise<void> {
  try {
    const db = createAdminClient();
    const { data } = await db.from("settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
    const all = (data?.value ?? {}) as Record<string, unknown>;
    await db.from("settings").upsert({ key: SETTINGS_KEY, value: { ...all, [currency.toUpperCase()]: rate } }, { onConflict: "key" });
  } catch (e) {
    console.warn("[cr/fx] could not store the rate", { currency, error: String(e).slice(0, 120) });
  }
}

/**
 * The market rate for USD → `currency`, cached an hour; a stored last-good
 * rate under a week old when every provider is down. Null when nothing is
 * known. Exposed for the admin readout.
 */
export async function marketRate(currency: string): Promise<{ rate: StoredRate; source: "live" | "stored" } | null> {
  const cur = currency.toUpperCase();
  const cached = memory.get(cur);
  if (cached && Date.now() - cached.at < LIVE_RATE_TTL_MS) return { rate: cached.rate, source: "live" };
  const live = await fetchLiveRate(cur);
  if (live) {
    memory.set(cur, { rate: live, at: Date.now() });
    await writeStored(cur, live);
    return { rate: live, source: "live" };
  }
  const stored = await readStored(cur);
  if (stored && Date.now() - Date.parse(stored.fetchedAt) < STORED_RATE_MAX_AGE_MS) return { rate: stored, source: "stored" };
  return null;
}

/**
 * The rate the checkout charges at, or null when no conversion applies.
 * `{ error: "rate-missing" }` when one applies and nothing — live, stored
 * or manual — can name it.
 */
export async function resolveCheckoutRate(config: CharacterReplaceConfig, walletCurrency: string): Promise<ResolvedRate | null | { error: "rate-missing" }> {
  const checkout = config.recharge.checkoutCurrency;
  if (!conversionApplies(walletCurrency, checkout)) return null;
  const markup = config.recharge.fxMarkupPercent;
  const market = await marketRate(checkout);
  if (market) {
    return {
      minorPerUsd: minorPerUsdFrom(market.rate.perUsd, markup),
      marketPerUsd: market.rate.perUsd,
      markupPercent: markup,
      source: market.source,
      fetchedAt: market.rate.fetchedAt,
      provider: market.rate.provider,
    };
  }
  if (config.localMinorUnitsPerUsd > 0) {
    console.warn("[cr/fx] no live or stored rate — using the operator's manual rate", { checkout, minorPerUsd: config.localMinorUnitsPerUsd });
    return { minorPerUsd: config.localMinorUnitsPerUsd, marketPerUsd: null, markupPercent: 0, source: "manual", fetchedAt: null, provider: null };
  }
  return { error: "rate-missing" };
}
