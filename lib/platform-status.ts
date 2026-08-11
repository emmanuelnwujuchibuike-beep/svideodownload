import type { PlatformId } from "@/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PLATFORM STATUS — is TikTok working right now?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-08-11: "put a small green and yellow and red tick at the top of
 * every support platform logo in all page … so i can set in admin dashboard
 * which platform is active or partial or fully down."
 *
 * ── 🔴 Why this is DECLARED and not derived ────────────────────────────────
 *
 * `lib/platform/availability.ts` exists and derives availability from the Product
 * Genome, on the stated principle that a declared field drifts from reality. That
 * principle is right there and wrong here, and the difference is worth being
 * explicit about so the two are never merged.
 *
 * That file answers "does this Frenzsave product EXIST" — a fact about our own
 * roadmap, which the codebase genuinely knows. This one answers "is a THIRD
 * PARTY's extractor working this afternoon" — a fact about someone else's
 * infrastructure that changes without warning and that nothing in this repo can
 * observe. There is no signal to derive it from: a download failing could be one
 * bad URL, a region block, a rate limit, or TikTok shipping a new player.
 *
 * So an operator declares it, because an operator is the only party who actually
 * knows. The honest cost is that a stale value is a lie, which is why the admin
 * panel shows when each was last changed.
 *
 * ── Fail-open to OPERATIONAL ───────────────────────────────────────────────
 *
 * An unset platform, an unreachable settings row and a malformed value all
 * resolve to `operational`. This is the opposite of the fail-CLOSED rule the ad
 * and availability layers use, deliberately: a badge is a claim about someone
 * else's service, and defaulting to "down" would paint every platform red the
 * first time the settings table hiccups — telling every visitor the product is
 * broken when it is not. Silence should read as "nothing to report".
 */

export type PlatformStatus = "operational" | "partial" | "down";

export const PLATFORM_STATUS_META: Record<
  PlatformStatus,
  { label: string; short: string; description: string; dot: string; ring: string; text: string }
> = {
  operational: {
    label: "Fully working",
    short: "Working",
    description: "Downloads from this platform are succeeding normally.",
    // Tailwind classes rather than raw hex so the badge follows the theme and
    // stays in one place — see PlatformStatusDot.
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/30",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  partial: {
    label: "Partly working",
    short: "Partial",
    description:
      "Some downloads succeed and some fail — a quality, a media type or a region may be affected.",
    dot: "bg-amber-500",
    ring: "ring-amber-500/30",
    text: "text-amber-600 dark:text-amber-400",
  },
  down: {
    label: "Not working",
    short: "Down",
    description: "Downloads from this platform are failing. Shown so people do not keep retrying.",
    dot: "bg-rose-500",
    ring: "ring-rose-500/30",
    text: "text-rose-600 dark:text-rose-400",
  },
};

export const DEFAULT_PLATFORM_STATUS: PlatformStatus = "operational";

export interface PlatformStatusEntry {
  status: PlatformStatus;
  /** ISO timestamp of the last change — surfaced so a stale badge is visible. */
  updatedAt: string;
  /** Optional operator note, e.g. "HD only, 4K failing". */
  note?: string;
}

export type PlatformStatusMap = Partial<Record<PlatformId, PlatformStatusEntry>>;

const VALID: readonly PlatformStatus[] = ["operational", "partial", "down"];

export function isPlatformStatus(v: unknown): v is PlatformStatus {
  return typeof v === "string" && (VALID as readonly string[]).includes(v);
}

/**
 * Read one platform's status out of a (possibly junk) stored map.
 *
 * Every unknown shape resolves to `operational` — see the fail-open note above.
 * Written as one function so no caller can invent its own default.
 */
export function statusOf(map: PlatformStatusMap | null | undefined, id: PlatformId): PlatformStatus {
  const entry = map?.[id];
  if (!entry || !isPlatformStatus(entry.status)) return DEFAULT_PLATFORM_STATUS;
  return entry.status;
}

/**
 * Drop anything that is not a valid entry.
 *
 * The stored value comes from a settings row an operator edits, so it is
 * untrusted: a bad status string must never reach a `Record` lookup and render
 * `undefined` classes onto a badge.
 */
export function normalizePlatformStatus(value: unknown): PlatformStatusMap {
  if (!value || typeof value !== "object") return {};
  const out: PlatformStatusMap = {};
  for (const [k, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as Partial<PlatformStatusEntry>;
    if (!isPlatformStatus(e.status)) continue;
    out[k as PlatformId] = {
      status: e.status,
      updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date(0).toISOString(),
      ...(typeof e.note === "string" && e.note.trim() ? { note: e.note.trim().slice(0, 140) } : {}),
    };
  }
  return out;
}

/** Platforms that are not fully working — for a summary banner. */
export function degradedPlatforms(map: PlatformStatusMap): PlatformId[] {
  return (Object.keys(map) as PlatformId[]).filter((id) => statusOf(map, id) !== "operational");
}
