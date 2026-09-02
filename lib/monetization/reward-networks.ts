/**
 * Which ad network pays for which reward moment — the PURE half.
 *
 * Owner, 2026-08-25: "I want to be able to decide in admin dashboard which
 * reward ad network for a particular feature … so I can use google adsense
 * offerwall with GPT for multilink reward ads or offerium, and use offerium or
 * google adsense offerwall with GPT for event trigger for batch download,
 * wallpaper and any other place."
 *
 * ── What this is, and what it deliberately is not ─────────────────────────
 * Before this, the network was a property of an AD ROW (`ads.network`) chosen
 * per ZONE. That answers "what creative fills this box", not "which reward
 * MECHANISM does this feature use" — and those are different questions. A
 * rewarded GPT slot, a full-screen interstitial and an offerwall are not three
 * creatives in one box; they are three different flows with different consent,
 * different grant signals and different server verification.
 *
 * So this is a per-SURFACE routing table, and the zone/ad-row system stays
 * exactly as it is underneath — it is what the `interstitial` network resolves
 * to.
 *
 * No server imports here (see `./reward-networks-store.ts` for those): the
 * admin editor and every gate that reads this are `"use client"`.
 */

/** Every moment in the product where an ad can gate an action. */
export type RewardSurface =
  | "multilink_batch"
  | "multilink_fetch"
  | "batch_download"
  | "batch_complete"
  | "hd_download"
  | "video_preview"
  | "wallpaper"
  | "history_video";

export type RewardNetwork =
  | "gpt_rewarded"
  | "rewarded_video"
  | "interstitial"
  | "offerium"
  | "none";

export interface SurfaceConfig {
  network: RewardNetwork;
  /**
   * GPT ad unit path for THIS surface (`/networkCode/adUnitName`).
   *
   * Per-surface rather than one global path because that is the only way to
   * read a report and know whether the multi-link gate or the HD gate earned
   * the money. Empty falls back to the global default in `use-reward-flow.ts`.
   */
  gptAdUnitPath: string;
}

export type RewardNetworkMap = Record<RewardSurface, SurfaceConfig>;

export interface RewardSurfaceDef {
  id: RewardSurface;
  label: string;
  description: string;
  /** Networks that make sense here. Anything else is refused at save time. */
  supports: readonly RewardNetwork[];
  /** Where an unsupported or unavailable choice lands. */
  fallback: RewardNetwork;
  note?: string;
}

/** Batch gates: the full-screen zone interstitial is what they run today. */
const BATCH_NETWORKS: readonly RewardNetwork[] = ["gpt_rewarded", "interstitial", "offerium", "none"];
/** Download/preview unlocks: the reward_video gate is what they run today. */
const UNLOCK_NETWORKS: readonly RewardNetwork[] = ["gpt_rewarded", "rewarded_video", "offerium", "none"];

export const REWARD_SURFACES: readonly RewardSurfaceDef[] = [
  {
    id: "multilink_batch",
    label: "Multi-Link batch download",
    description: "Before a multi-source batch starts downloading.",
    supports: BATCH_NETWORKS,
    fallback: "interstitial",
  },
  {
    id: "multilink_fetch",
    label: "Multi-Link — after fetching sources",
    description: "The skippable vignette once a fetch finishes and the results appear.",
    /*
      Interstitial or nothing. The visitor has already GOT their results by the
      time this runs — it is an interruption placed after a completed action,
      not a gate in front of a locked one, so there is nothing a rewarded
      format could unlock. Same reasoning as the other post-event rows below.
    */
    supports: ["interstitial", "none"],
    fallback: "interstitial",
    note: "Fires once per fetch action, however many sources it covered — never one ad per source.",
  },
  {
    id: "batch_download",
    label: "Batch download (single link)",
    description: "Before a story's snaps or a slideshow's photos download together.",
    supports: BATCH_NETWORKS,
    fallback: "interstitial",
  },
  {
    id: "batch_complete",
    label: "After a batch finishes",
    description: "The short closing ad once the files are already saved.",
    /*
      No rewarded formats here, on purpose. This ad runs AFTER the files are
      saved, so there is nothing left to grant — a rewarded slot's whole
      contract is "watch this and I unlock that", and there is no "that".
      Offering GPT here would be a control that cannot do what it says.
    */
    supports: ["interstitial", "none"],
    fallback: "interstitial",
    note: "Rewarded formats don't apply — the download has already completed, so there is nothing left to unlock.",
  },
  {
    id: "hd_download",
    label: "HD / top-quality download unlock",
    description: "Gating the best-quality options and large files.",
    /*
      🔴 `interstitial` IS OFFERED HERE NOW (owner, 2026-09-02: "i want hiltop
      vast to be the acting reward ad in place of offerium until offerium
      approved, so the batch download, top 2 quality download started should
      show hiltop ad").

      It used to be `UNLOCK_NETWORKS`, which excluded the interstitial on the
      reasoning that Hilltop has no REWARDED product — true, and it is why this
      list is not simply widened. What changed is the reading: the gate is OURS.
      We play an ordinary VAST and OUR code grants the unlock when it finishes.
      Nothing is claimed to the network as a rewarded impression, no rewarded
      callback is faked, and the honesty note that kept this off the list is
      preserved by that distinction rather than by the omission.

      Batch already worked this way (`batch_download_gate` is `vast` by default);
      this is the same arrangement for the top-quality moment, on the same admin
      timer, so the two "download started" gates behave alike.
    */
    supports: [...UNLOCK_NETWORKS, "interstitial"],
    fallback: "rewarded_video",
    note: "“Full-screen interstitial” plays the Hilltop VAST and unlocks when it finishes — the stand-in while Offerium is pending.",
  },
  {
    id: "video_preview",
    label: "Video preview (“Review video”)",
    description: "Before playing back an already-downloaded video.",
    supports: UNLOCK_NETWORKS,
    fallback: "rewarded_video",
  },
  /*
    ── The two POST-EVENT triggers ──────────────────────────────────────────
    Both fire AFTER the thing already happened: the wallpaper ad runs on every
    2nd COMPLETED download (`use-wallpaper-interstitial.ts` — "call after each
    completed wallpaper download"), and the history ad runs when a clip ends
    NATURALLY (`download-interstitial.tsx` — deliberately never mid-watch).

    So, exactly like `batch_complete`, there is nothing left to unlock, and a
    rewarded format's entire contract — "watch this and I'll grant you that" —
    has no "that". Listing GPT or an offerwall here would be a control that
    cannot do what its label says.

    Turning them into real reward GATES (watch first, then download the
    wallpaper) is a genuine product option, not a limitation of this table —
    but it is a different feature: it needs its own reward-session type, which
    means a migration to widen `reward_sessions.type`'s CHECK constraint beyond
    hd/batch/preview. Not done here rather than faked.
  */
  {
    id: "wallpaper",
    label: "Wallpaper download",
    description: "The ad after every 2nd completed wallpaper download.",
    supports: ["interstitial", "none"],
    fallback: "interstitial",
    note: "Runs AFTER the wallpaper has already saved, so there is nothing left to unlock — rewarded formats don't apply. Making it a watch-first gate is a separate change (it needs its own reward-session type).",
  },
  {
    id: "history_video",
    label: "History video watch",
    description: "The ad when a replayed clip finishes.",
    supports: ["interstitial", "none"],
    fallback: "interstitial",
    note: "Fires on a natural end, never mid-watch, so it gates nothing — rewarded formats don't apply.",
  },
];

export interface RewardNetworkDef {
  id: RewardNetwork;
  label: string;
  description: string;
  /** False = selectable in the type but not yet servable. See `unavailableReason`. */
  available: boolean;
  unavailableReason?: string;
}

export const REWARD_NETWORK_DEFS: readonly RewardNetworkDef[] = [
  {
    id: "gpt_rewarded",
    label: "Google rewarded ad (GPT)",
    description:
      "A Google Publisher Tag rewarded slot — AdSense / Ad Manager demand. The reward is granted only on Google's own rewardedSlotGranted event, then confirmed server-side.",
    available: true,
  },
  {
    /*
      What the HD and preview unlocks ACTUALLY run today, so it is named rather
      than hidden behind one of the others.

      The real GPT flow was deliberately paused on those surfaces (owner,
      2026-08-16: "top quality video still doesnt click… reduced my visitor")
      because no Google Ad Manager account is configured, which meant the gate
      was requesting Google's PUBLIC TEST rewarded unit in production — it does
      not reliably fill, so every top-quality download dead-ended. They fell
      back to this gate, which works today.

      Listing it as its own network is what lets the routing table tell the
      truth about the current state AND gives the admin the switch to GPT the
      moment a real ad unit exists — without a deploy.
    */
    id: "rewarded_video",
    label: "Rewarded video / timer gate",
    description:
      "The admin-configured `reward_video` zone — your uploaded video or a timed gate. Self-grants immediately when no creative is configured, so it never dead-ends a download.",
    available: true,
  },
  {
    id: "interstitial",
    label: "Full-screen interstitial",
    description:
      "The ad rows you configure per zone (AdSense unit, Monetag, Adsterra or a house ad), shown full-screen with a countdown that must run out.",
    available: true,
  },
  {
    id: "offerium",
    label: "Offerium offerwall",
    description: "Offerium's rewarded offerwall.",
    available: false,
    /*
      🔴 Honest, not hidden. `lib/monetization/offerium.ts` holds the admin
      surface and the readiness checks, and its `verifyOfferiumPostback` is an
      explicit, unimplemented seam — writing it needs Offerium's publisher docs
      (their SDK shape, callback parameters and above all the signature scheme
      that proves a postback is genuine). Guessing produces something that looks
      finished and either silently fails or accepts forged rewards.

      So this stays listed and typed — the routing table, the resolver and the
      admin row are all ready for it — but not selectable, and `resolveRewardNetwork`
      falls the surface back rather than showing a gate nothing can satisfy.
    */
    unavailableReason:
      "Not yet integrated — needs Offerium's publisher docs for the postback signature scheme. Credentials can already be stored under Monetization; the code seam is verifyOfferiumPostback().",
  },
  {
    id: "none",
    label: "No ad",
    description: "The action runs immediately, with no gate.",
    available: true,
  },
];

export const DEFAULT_REWARD_NETWORKS: RewardNetworkMap = {
  // Defaults reproduce EXACTLY what each surface did before this table existed,
  // so an unconfigured site behaves identically to how it did yesterday.
  multilink_batch: { network: "interstitial", gptAdUnitPath: "" },
  multilink_fetch: { network: "interstitial", gptAdUnitPath: "" },
  batch_download: { network: "interstitial", gptAdUnitPath: "" },
  batch_complete: { network: "interstitial", gptAdUnitPath: "" },
  // NOT gpt_rewarded: the real GPT flow is paused on these two surfaces until a
  // Google Ad Manager account exists (see `rewarded_video` above). Defaulting
  // them to GPT would make this table describe a flow that isn't running.
  hd_download: { network: "rewarded_video", gptAdUnitPath: "" },
  video_preview: { network: "rewarded_video", gptAdUnitPath: "" },
  wallpaper: { network: "interstitial", gptAdUnitPath: "" },
  history_video: { network: "interstitial", gptAdUnitPath: "" },
};

export function surfaceDef(surface: RewardSurface): RewardSurfaceDef {
  return REWARD_SURFACES.find((s) => s.id === surface) ?? REWARD_SURFACES[0]!;
}

export function networkDef(network: RewardNetwork): RewardNetworkDef {
  return REWARD_NETWORK_DEFS.find((n) => n.id === network) ?? REWARD_NETWORK_DEFS[1]!;
}

/** Runtime facts the table cannot know on its own. */
export interface NetworkCapabilities {
  /** `offeriumConfigured(settings)` — credentials AND server secrets present. */
  offeriumConfigured: boolean;
}

export interface ResolvedNetwork {
  network: RewardNetwork;
  /** Set when the configured choice could not be served, for logging/admin. */
  fellBackFrom: RewardNetwork | null;
  reason: string | null;
}

/**
 * The one place a surface's effective network is decided.
 *
 * Falls back rather than failing: a stored value that is unsupported for its
 * surface (an older build, a hand-edited row) or a network that is not
 * currently servable must never leave a visitor staring at a gate nothing can
 * satisfy. The surface's own `fallback` is what it did before this table
 * existed.
 */
export function resolveRewardNetwork(
  surface: RewardSurface,
  map: Partial<RewardNetworkMap> | null | undefined,
  caps: NetworkCapabilities,
): ResolvedNetwork {
  const def = surfaceDef(surface);
  const configured = map?.[surface]?.network ?? DEFAULT_REWARD_NETWORKS[surface].network;

  if (!def.supports.includes(configured)) {
    return {
      network: def.fallback,
      fellBackFrom: configured,
      reason: `${configured} isn't supported on ${def.label}`,
    };
  }

  if (configured === "offerium" && !caps.offeriumConfigured) {
    return {
      network: def.fallback,
      fellBackFrom: "offerium",
      reason: "Offerium isn't fully configured",
    };
  }

  // Offerium passes the config check but still has no live integration — see
  // REWARD_NETWORK_DEFS above. Kept as a separate branch from the one directly
  // above so that wiring the integration is a single-line deletion here.
  if (configured === "offerium") {
    return {
      network: def.fallback,
      fellBackFrom: "offerium",
      reason: "Offerium integration is not built yet",
    };
  }

  return { network: configured, fellBackFrom: null, reason: null };
}

/** The GPT ad unit path for a surface, or "" to use the global default. */
export function gptAdUnitFor(
  surface: RewardSurface,
  map: Partial<RewardNetworkMap> | null | undefined,
): string {
  return (map?.[surface]?.gptAdUnitPath ?? "").trim();
}

/** Merge a stored (possibly partial or stale) map onto the defaults. */
export function mergeRewardNetworks(stored: unknown): RewardNetworkMap {
  const out = { ...DEFAULT_REWARD_NETWORKS };
  if (!stored || typeof stored !== "object") return out;
  for (const def of REWARD_SURFACES) {
    const raw = (stored as Record<string, unknown>)[def.id];
    if (!raw || typeof raw !== "object") continue;
    const { network, gptAdUnitPath } = raw as Partial<SurfaceConfig>;
    out[def.id] = {
      network:
        typeof network === "string" && def.supports.includes(network as RewardNetwork)
          ? (network as RewardNetwork)
          : DEFAULT_REWARD_NETWORKS[def.id].network,
      gptAdUnitPath: typeof gptAdUnitPath === "string" ? gptAdUnitPath.slice(0, 200) : "",
    };
  }
  return out;
}
