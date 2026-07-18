import { getModule } from "@/lib/platform/modules";

import { GATEWAY_ACTIONS } from "./actions";
import {
  EMPTY_MEMORY,
  type Availability,
  type DownloadContext,
  type GatewayAction,
  type GatewayMemory,
  type Recommendation,
} from "./types";

/**
 * The Discovery Gateway™ ranker. See `docs/DOWNLOAD_HUB_RFC.md` §3.3.
 *
 * Runs on the client, from a static catalogue, after the download has completed —
 * so it costs no request, never blocks the file, and cannot un-static `/downloads`.
 */

/* ------------------------------ availability ------------------------------ */

/**
 * Surfaces that are genuinely built but are content rather than platform modules,
 * so they have no entry in the Product Genome.
 *
 * This is an allowlist, and `download-hub.test.ts` verifies every route reachable
 * through it actually exists on disk. Without that check this would be a hole in
 * the fail-closed rule below — a typo'd id would silently promote a nonexistent
 * destination to "live".
 */
const CORE_LIVE_PRODUCTS = new Set(["learning"]);

/**
 * Derives whether a destination is real. Never declared by hand — a declared field
 * drifts from reality the moment someone forgets to update it.
 *
 * Fail-closed: an unknown product id resolves to `planned`, so adding an action for
 * a product nobody has built yet is safe by default rather than dangerous by
 * default.
 */
export function resolveAvailability(action: GatewayAction): Availability {
  if (CORE_LIVE_PRODUCTS.has(action.productId)) return "live";

  const product = getModule(action.productId);
  if (!product) return "planned";

  if (product.veracity.claimable) return "live";
  return product.veracity.stage === "beta" || product.veracity.stage === "alpha"
    ? "preview"
    : "planned";
}

/** Real things outrank aspirational ones, always, by construction. */
const AVAILABILITY_WEIGHT: Record<Availability, number> = {
  live: 1,
  preview: 0.6,
  planned: 0.25,
};

/* --------------------------------- reasons -------------------------------- */

/**
 * Why this was recommended, in the user's terms. A recommendation that cannot
 * explain itself reads as an advert, and gets dismissed like one.
 */
function reasonFor(action: GatewayAction, ctx: DownloadContext): string {
  switch (action.id) {
    case "generate-subtitles":
    case "translate-subtitles":
      return "This one has speech in it";
    case "enhance-quality":
      return ctx.height > 0 ? `Saved at ${ctx.height}p` : "Lower-resolution source";
    case "publish-reel":
      return "Short vertical video";
    case "explore-community":
      return ctx.downloadCount <= 1 ? "New here" : "Popular right now";
    case "save-to-cloud":
    case "organize-project":
      return ctx.downloadCount > 5 ? "You've saved a few of these" : "Keep it safe";
    case "extract-audio":
      return "Has an audio track";
    default:
      return action.group === "create" ? "Ready to share" : "Works with what you saved";
  }
}

/* --------------------------------- ranking -------------------------------- */

/**
 * An action a signed-out visitor cannot take yet is still worth showing — the
 * download is the moment the account ask becomes credible, because value has
 * already been delivered. It routes through login rather than failing at the door.
 */
function targetHref(action: GatewayAction, ctx: DownloadContext): string | null {
  if (action.target.type !== "route") return null;
  const { href } = action.target;
  if (action.requiresAuth && !ctx.signedIn) {
    return `/login?next=${encodeURIComponent(href)}`;
  }
  return href;
}

export function scoreAction(
  action: GatewayAction,
  ctx: DownloadContext,
  memory: GatewayMemory = EMPTY_MEMORY,
): number {
  const fit = action.fit(ctx);
  if (fit <= 0) return 0;

  const availability = resolveAvailability(action);

  // Dismissed means dismissed. Taken decays but does not vanish — someone who
  // published one clip may well publish another.
  let novelty = 1;
  if (memory.dismissed.includes(action.id)) return 0;
  if (memory.taken.includes(action.id)) novelty = 0.35;

  // Asking a signed-out visitor to sign in is a real cost, so it is discounted
  // rather than free.
  const authPenalty = action.requiresAuth && !ctx.signedIn ? 0.7 : 1;

  return (action.base / 100) * fit * AVAILABILITY_WEIGHT[availability] * novelty * authPenalty;
}

/** Every scorable action, resolved and sorted best-first. */
function rankAll(ctx: DownloadContext, memory: GatewayMemory): Recommendation[] {
  return GATEWAY_ACTIONS.map((action) => {
    const availability = resolveAvailability(action);
    return {
      action,
      availability,
      score: scoreAction(action, ctx, memory),
      // Tense follows availability. This is the single line that keeps the Gateway
      // honest about the eight destinations that do not exist yet.
      label: availability === "planned" ? action.plannedLabel : action.label,
      reason: reasonFor(action, ctx),
    } satisfies Recommendation;
  })
    .filter((r) => r.score > 0)
    // Ties break on id so the panel is deterministic across renders — a list that
    // reshuffles on every re-render is unusable.
    .sort((a, b) => b.score - a.score || a.action.id.localeCompare(b.action.id));
}

export interface RecommendOptions {
  /** Primary recommendations to return. Three by default — see RFC §3.3. */
  limit?: number;
  memory?: GatewayMemory;
}

/**
 * Ranks the whole catalogue for one completed download.
 *
 * Returns at most `limit` primary recommendations. The brief asks for ten
 * destinations; all ten are ranked, but showing ten is a directory, not a
 * recommendation, and directories get skipped.
 */
export function recommend(
  ctx: DownloadContext,
  { limit = 3, memory = EMPTY_MEMORY }: RecommendOptions = {},
): Recommendation[] {
  const scored = rankAll(ctx, memory);
  // Avoid three variations of the same idea. One per group keeps the panel
  // genuinely useful rather than three flavours of "publish this".
  const seenGroups = new Set<string>();
  const primary: Recommendation[] = [];
  for (const rec of scored) {
    if (primary.length >= limit) break;
    if (seenGroups.has(rec.action.group)) continue;
    seenGroups.add(rec.action.group);
    primary.push(rec);
  }

  // If group-diversity starved the list, backfill by score.
  if (primary.length < limit) {
    for (const rec of scored) {
      if (primary.length >= limit) break;
      if (!primary.includes(rec)) primary.push(rec);
    }
  }

  return primary;
}

/**
 * Everything ranked in pure score order — used by the "all next steps" drawer,
 * where group diversity is unwanted because the user asked to see the full list.
 */
export function recommendAll(
  ctx: DownloadContext,
  memory: GatewayMemory = EMPTY_MEMORY,
): Recommendation[] {
  return rankAll(ctx, memory);
}

/** Resolved href for a route-targeted recommendation, or null. */
export function hrefFor(rec: Recommendation, ctx: DownloadContext): string | null {
  return targetHref(rec.action, ctx);
}
