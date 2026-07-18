import type { LucideIcon } from "lucide-react";

import type { MediaKind, PlatformId } from "@/types";

/**
 * Discovery Gateway™ types. See `docs/DOWNLOAD_HUB_RFC.md` §3.
 *
 * The load-bearing idea in this file is `Availability`: whether a recommended
 * destination is real is DERIVED from the Product Genome, never declared by hand.
 * Eight of the ten destinations the Download Hub brief asks for do not exist yet,
 * and this is what lets the whole engine be built anyway without shipping a single
 * false claim.
 */

/* --------------------------------- context -------------------------------- */

/**
 * Everything the ranker knows about a completed download. Deliberately small and
 * JSON-serializable: it is assembled on the client from data already in hand, so
 * producing it costs no request.
 *
 * Note what is NOT here: the URL and the title. Ranking has no use for either, and
 * the URL is the most sensitive field in this product — it identifies exactly what
 * a person watched. Keeping it out of this shape means it cannot leak into an
 * analytics payload by accident later.
 */
export interface DownloadContext {
  platformId: PlatformId;
  kind: MediaKind;
  /** Seconds. 0 when unknown (images, or metadata that omitted it). */
  durationSec: number;
  /** Vertical pixel count of the chosen rendition; 0 when unknown or audio. */
  height: number;
  hasAudio: boolean;
  signedIn: boolean;
  plan: "free" | "pro" | "business";
  /** How many downloads this person has completed, ever. Drives first-run copy. */
  downloadCount: number;
}

/* -------------------------------- actions --------------------------------- */

/**
 * Where a recommendation sends someone.
 *
 * - `route` — a real in-app navigation.
 * - `intent` — a client-side behaviour on the current page (open the send-to-chat
 *   sheet, copy a link). Not every next step is a page.
 * - `waitlist` — a `planned` destination. Writes a real waitlist row; never
 *   pretends to open a product that does not exist.
 */
export type ActionTarget =
  | { type: "route"; href: string }
  | { type: "intent"; intent: GatewayIntent }
  | { type: "waitlist"; product: string };

export type GatewayIntent = "send-to-chat" | "save-to-device" | "copy-link";

/**
 * Derived from the genome + the filesystem. See `resolveAvailability`.
 *
 * `planned` is not a lesser tier to be hidden — it is a first-class state with its
 * own honest presentation (future tense, notify-me). That is what makes declaring
 * all ten destinations safe.
 */
export type Availability = "live" | "preview" | "planned";

export type ActionGroup = "create" | "enhance" | "store" | "share" | "learn";

export interface GatewayAction {
  id: string;
  /** Present-tense label. Only ever rendered for `live`/`preview` actions. */
  label: string;
  /** Future-tense label, used when availability is `planned`. */
  plannedLabel: string;
  description: string;
  icon: LucideIcon;
  group: ActionGroup;
  /** Genome module this action belongs to — the source of its availability. */
  productId: string;
  target: ActionTarget;
  /** Editorial priority, 0-100. Admin-configurable via `gateway_config`. */
  base: number;
  requiresAuth: boolean;
  /**
   * Contextual relevance, 0 (irrelevant) to 1 (perfect fit). Pure and total:
   * given the same context it must always return the same number, because the
   * ranker's output is asserted in tests.
   */
  fit: (ctx: DownloadContext) => number;
}

/* ----------------------------- recommendations ---------------------------- */

export interface Recommendation {
  action: GatewayAction;
  availability: Availability;
  score: number;
  /** The label to actually render — tense-correct for the availability. */
  label: string;
  /**
   * Why this was recommended, in the user's terms. Shown in the UI: a
   * recommendation that cannot explain itself reads as an advert.
   */
  reason: string;
}

/** Actions the user has dismissed or already taken, by id. */
export interface GatewayMemory {
  dismissed: string[];
  taken: string[];
}

export const EMPTY_MEMORY: GatewayMemory = { dismissed: [], taken: [] };
