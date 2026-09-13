/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MONEY AS A PERSON TYPES IT ⇄ MONEY AS THE SYSTEM STORES IT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure. No imports, no environment, nothing async — so it can be used from the
 * admin form, the member's top-up field and any test without dragging a
 * database client into a browser bundle. It used to live in
 * lib/landing/settings.ts, which imports the service-role Supabase client; the
 * first client component outside admin that needed it is why it moved.
 *
 * Owner, 2026-09-09: "i set 500 naira per video and 2000 naira minimum deposit
 * and is showing 50 naira, i dont really understand." The whole file exists so
 * that there is ONE conversion between what an operator or member types and
 * the integer minor units everything else runs on.
 */

/**
 * Minor units per major unit.
 *
 * 🔴 100 for every currency Paystack settles in (see `AI_CURRENCIES`), which is
 * why one integer works across all of them. Named rather than written as a bare
 * `100` at each call site, so the day a zero-decimal currency is added the
 * conversion has one place to change instead of six.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/** `50000` → `"500"`, `1999` → `"19.99"` — for a field a person types money into. */
export function minorToMajorInput(minor: number): string {
  if (!Number.isFinite(minor)) return "";
  const whole = Math.floor(Math.abs(minor) / MINOR_UNITS_PER_MAJOR);
  const rest = Math.abs(minor) % MINOR_UNITS_PER_MAJOR;
  // Whole amounts render without decimals: an operator who set ₦500 should see
  // "500", not "500.00" they have to read twice.
  return rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0")}`;
}

/**
 * `"500"` → `50000`. What a form sends.
 *
 * 🔴 `Math.round`, because `500.5 * 100` is `50050.000000000007` in binary
 * floating point. This is the ONE place a major-unit decimal becomes an
 * integer, and it is the only place in this system where money touches a float
 * at all — everything downstream is integer minor units.
 */
export function majorInputToMinor(value: string | number): number | null {
  /*
    🔴 AN EMPTY FIELD IS NOT ZERO. `Number("")` is 0 — finite, non-negative, and
    indistinguishable from a deliberate 0 to the check below. An operator who
    clears the price box means "leave it alone", and the caller reads null as
    exactly that; returning 0 would make clearing the field the way to set a
    price of nothing, which the schema then refuses with an error about a value
    they never typed.
  */
  const raw = typeof value === "number" ? value : String(value).trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * MINOR_UNITS_PER_MAJOR);
}
