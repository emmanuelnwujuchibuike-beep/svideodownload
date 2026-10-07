import { klingAuthMode, klingBaseUrl, klingCall, klingConfigured } from "@/lib/ai/kling/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING CONNECTION TEST + UNIT BALANCE (Part 8 §46 / §8, 2026-10-07)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two reads, neither of which can create (or bill) a task:
 *
 *   · the CONNECTION probe — `POST /v1/videos/video-extend` with an out-of-range
 *     `cfg_scale`. Kling validates the field before anything else and answers
 *     `400 code 1201` for a good key, `401 code 1002` for a bad one. Probed
 *     live 2026-10-07: no task appears either way (a VALID body would submit —
 *     see the "probe with an invalid field" hard law).
 *   · the BALANCE — `GET /account/costs?start_time&end_time` answers the
 *     account's resource packs with `remaining_quantity` per pack. Running out
 *     of units (2026-10-06) is what made videos fail; this shows it first.
 *
 * Only ever called from an admin route, on a tap. Nothing polls it.
 */

export interface KlingPack {
  name: string;
  type: string;
  status: string;
  total: number;
  remaining: number;
  /** ms since epoch; null when Kling did not say */
  expiresAt: number | null;
}

export interface KlingStatus {
  configured: boolean;
  /** "ok" key accepted · "bad_key" refused · "unreachable" no answer · "unknown" an answer we cannot read */
  connection: "ok" | "bad_key" | "unreachable" | "unknown" | "not_configured";
  /** Packs still usable (online, not expired), largest remaining first. */
  packs: KlingPack[];
  /** Sum over usable packs; null when the balance could not be read. */
  remainingUnits: number | null;
  /** Packs that ran out or expired — shown so the operator sees why units vanished. */
  spentPacks: KlingPack[];
  /** "api_key" | "jwt" — the scheme, never the credential */
  authMode: string | null;
  /** The API host the deployment talks to (Kling's own; never a secret). */
  host: string | null;
  /** When the verdict is not "ok": Kling's HTTP status and envelope code, for the operator. */
  lastError: string | null;
  checkedAt: number;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);

/** Pure: read Kling's `/account/costs` body. Exported for the tests. */
export function parseKlingPacks(body: unknown, now: number): { usable: KlingPack[]; spent: KlingPack[] } | null {
  const data = (body as { data?: { resource_pack_subscribe_infos?: unknown } } | null)?.data;
  const list = data?.resource_pack_subscribe_infos;
  if (!Array.isArray(list)) return null;
  const usable: KlingPack[] = [];
  const spent: KlingPack[] = [];
  for (const raw of list) {
    const p = raw as Record<string, unknown>;
    const expires = num(p.invalid_time);
    const pack: KlingPack = {
      name: typeof p.resource_pack_name === "string" ? p.resource_pack_name : "Resource pack",
      type: typeof p.resource_pack_type === "string" ? p.resource_pack_type : "",
      status: typeof p.status === "string" ? p.status : "",
      total: num(p.total_quantity),
      remaining: num(p.remaining_quantity),
      expiresAt: expires > 0 ? expires : null,
    };
    const live = pack.status === "online" && pack.remaining > 0 && (pack.expiresAt === null || pack.expiresAt > now);
    (live ? usable : spent).push(pack);
  }
  usable.sort((a, b) => b.remaining - a.remaining);
  return { usable, spent };
}

/** Pure: what the connection probe's answer means. Exported for the tests. */
export function classifyProbe(status: number | null, body: unknown): KlingStatus["connection"] {
  if (status === null) return "unreachable";
  const code = num((body as { code?: unknown } | null)?.code);
  if (status === 401 || status === 403 || code === 1002 || code === 1003 || code === 1004) return "bad_key";
  // the probe's field is invalid on purpose — a validation refusal IS an authenticated answer
  if (status === 400 || status === 422 || code === 1201) return "ok";
  // a 2xx here would mean Kling accepted the invalid field; never call that "ok"
  return "unknown";
}

const TIMEOUT_MS = 10_000;

async function timed<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), TIMEOUT_MS);
  try {
    return await work(c.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function klingStatus(now = Date.now()): Promise<KlingStatus> {
  const empty: KlingStatus = { configured: false, connection: "not_configured", packs: [], spentPacks: [], remainingUnits: null, authMode: null, host: null, lastError: null, checkedAt: now };
  if (!klingConfigured()) return empty;

  const [probe, costs] = await Promise.all([
    timed((signal) => klingCall("/v1/videos/video-extend", { method: "POST", body: JSON.stringify({ video_id: "1", cfg_scale: 5 }), signal })),
    // a year back covers every pack still able to be live
    timed((signal) => klingCall(`/account/costs?start_time=${now - 365 * 86_400_000}&end_time=${now}`, { method: "GET", signal })),
  ]);
  let host: string | null = null;
  try {
    host = new URL(klingBaseUrl()).host;
  } catch {
    host = null;
  }
  const connection = classifyProbe(probe?.status ?? null, probe?.json ?? null);
  const code = (probe?.json as { code?: unknown } | null)?.code;
  const lastError =
    connection === "ok"
      ? costs && !costs.ok ? `balance read refused (HTTP ${costs.status})` : null
      : probe ? `HTTP ${probe.status}${typeof code === "number" ? ` · code ${code}` : ""}` : "no answer within 10 s";
  const parsed = costs?.ok ? parseKlingPacks(costs.json, now) : null;
  return {
    configured: true,
    connection,
    authMode: klingAuthMode(),
    host,
    lastError,
    packs: parsed?.usable ?? [],
    spentPacks: parsed?.spent ?? [],
    remainingUnits: parsed ? Math.round(parsed.usable.reduce((s, p) => s + p.remaining, 0) * 100) / 100 : null,
    checkedAt: now,
  };
}
