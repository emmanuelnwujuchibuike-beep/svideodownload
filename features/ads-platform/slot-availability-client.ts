"use client";

/**
 * Free ad slots per placement (0241 `rpc/ad_slot_availability`), read straight
 * from Postgres with the public key — counts and a date only, never who holds a
 * slot. Once per visit, kept in memory for two minutes; a failure (or a
 * database without 0241) answers null and the wizard behaves as before — the
 * server still refuses a full placement before payment.
 */

export interface SlotAvailability {
  code: string;
  capacity: number;
  taken: number;
  /** the earliest a held slot is due to end */
  next_free_at: string | null;
  /** a views campaign holds a slot: it may free sooner (target reached) or later (free extension) */
  next_free_is_estimate: boolean;
}

const TTL_MS = 2 * 60_000;
const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
let memo: { at: number; p: Promise<Map<string, SlotAvailability> | null> } | null = null;

export function loadSlotAvailability(now: number = Date.now(), { fresh = false } = {}): Promise<Map<string, SlotAvailability> | null> {
  if (!fresh && memo && now - memo.at < TTL_MS) return memo.p;
  const p =
    !URL_BASE || !ANON
      ? Promise.resolve(null)
      : fetch(`${URL_BASE}/rest/v1/rpc/ad_slot_availability`, {
          method: "POST",
          headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
          body: "{}",
        })
          .then((r) => (r.ok ? (r.json() as Promise<{ placements?: SlotAvailability[] }>) : null))
          .then((d) => (d?.placements ? new Map(d.placements.map((x) => [x.code, x])) : null))
          .catch(() => null);
  memo = { at: now, p };
  void p.then((m) => {
    if (!m) memo = null; // a failure is not remembered
  });
  return p;
}

export const isFull = (a: SlotAvailability | undefined): boolean => !!a && a.capacity > 0 && a.taken >= a.capacity;

/** "About 14 Oct" / "14 Oct" — or null when no held slot has an end. */
export function nextFreeLabel(a: SlotAvailability | undefined): string | null {
  if (!a?.next_free_at) return null;
  const d = new Date(a.next_free_at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return a.next_free_is_estimate ? `about ${d}` : d;
}

/** Other placements of the same format with room now — the suggestion when one is full. */
export function freeAlternatives(avail: Map<string, SlotAvailability> | null, candidates: readonly string[], exclude: readonly string[]): string[] {
  if (!avail) return [];
  return candidates.filter((c) => !exclude.includes(c) && !isFull(avail.get(c)));
}
