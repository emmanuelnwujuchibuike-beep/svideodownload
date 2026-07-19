import { getModule } from "@/lib/platform/modules";

/**
 * Shared availability derivation — the one place that answers "is this thing real
 * today?" for every surface that needs to know.
 *
 * ── Why this is shared rather than per-surface ────────────────────────────────
 *
 * This logic was written first for the Discovery Gateway (`lib/download-hub`),
 * where it decides whether a destination renders as a working link or a "SOON"
 * chip. The Academy needs exactly the same question answered about a school, and
 * the Discovery Platform needs it before emitting a schema.org entity.
 *
 * Three copies of "is it real?" would drift, and the failure mode of drift here is
 * not cosmetic: one surface would claim a product exists while another says it is
 * coming. So the derivation lives here once and every caller delegates.
 *
 * ── The rule ──────────────────────────────────────────────────────────────────
 *
 * Availability is DERIVED from the Product Genome, never declared alongside the
 * thing being described. A declared field drifts from reality the moment someone
 * forgets to update it; a derived one cannot. When a product's `veracity.claimable`
 * flips in `lib/platform/modules.ts`, every surface in the app updates at once with
 * no other code change.
 *
 * Fail-closed: an unknown product id resolves to `planned`. Declaring a destination,
 * school or entity for something nobody has built is therefore safe by default
 * rather than dangerous by default.
 */

/**
 * Whether a thing genuinely exists today.
 *
 * - `live`    — exists, may be described in the present tense and linked to.
 * - `preview` — exists in alpha/beta; real, but hedged.
 * - `planned` — does not exist. Future tense only. Never a working link, never a
 *               schema.org entity, never a lesson body.
 */
export type Availability = "live" | "preview" | "planned";

/**
 * Derives availability for a product id.
 *
 * `coreLive` is an escape hatch for surfaces that are genuinely built but are
 * CONTENT rather than platform modules, so they have no Genome entry at all — the
 * Learning Academy itself is the original example. It is an allowlist, and each
 * caller is responsible for a test proving every id in its own allowlist resolves
 * to something that actually exists on disk. Without that proof this would be a
 * hole in the fail-closed rule above: a typo'd id would silently promote a
 * nonexistent thing to "live".
 */
export function availabilityOfProduct(
  productId: string,
  coreLive: ReadonlySet<string> = EMPTY_SET,
): Availability {
  if (coreLive.has(productId)) return "live";

  const product = getModule(productId);
  if (!product) return "planned";

  if (product.veracity.claimable) return "live";
  return product.veracity.stage === "beta" || product.veracity.stage === "alpha"
    ? "preview"
    : "planned";
}

const EMPTY_SET: ReadonlySet<string> = new Set();

/** Convenience: may this be described in the present tense and linked to? */
export function isAvailable(availability: Availability): boolean {
  return availability !== "planned";
}
