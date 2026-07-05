/**
 * Device- and network-aware playback conditions. The spec is explicit: never
 * default to the highest resolution — pick the most appropriate stream for the
 * viewer's connection, battery, and data preference. This reads the (progressively
 * available) Network Information + Battery APIs and turns them into a simple
 * playback profile the HLS layer can act on. Everything degrades gracefully: on a
 * browser without these APIs the profile is "unconstrained" and ABR runs as before.
 */

export interface PlaybackConditions {
  /** User asked the OS/browser to save data (Data Saver). */
  saveData: boolean;
  /** Coarse connection class: 'slow-2g' | '2g' | '3g' | '4g' | undefined. */
  effectiveType?: string;
  /** Estimated downlink in Mbps, when exposed. */
  downlinkMbps?: number;
  /** Device is on battery and low / in power-save (best-effort, may be undefined). */
  batterySaver?: boolean;
  /**
   * Suggested max height cap for adaptive levels (px), or null for no cap beyond
   * the player-size cap. Keeps a phone on a weak connection off 4K, saving data,
   * battery and decode heat without ever downloading the original.
   */
  maxHeight: number | null;
}

interface NavigatorConnection {
  saveData?: boolean;
  effectiveType?: string;
  downlink?: number;
}

interface BatteryLike {
  charging: boolean;
  level: number;
}

function readConnection(): NavigatorConnection | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: NavigatorConnection;
    mozConnection?: NavigatorConnection;
    webkitConnection?: NavigatorConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

/** Best-effort battery read; resolves undefined when the API is unavailable. */
async function readBatterySaver(): Promise<boolean | undefined> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
    if (typeof nav.getBattery !== "function") return undefined;
    const b = await nav.getBattery();
    // On battery and low → save power: cap quality, shorten buffers.
    return !b.charging && b.level <= 0.2;
  } catch {
    return undefined;
  }
}

function heightCap(saveData: boolean, effectiveType: string | undefined, batterySaver: boolean | undefined): number | null {
  if (saveData) return 480; // explicit user data-saver → cap to 480p
  if (effectiveType === "slow-2g" || effectiveType === "2g") return 360;
  if (effectiveType === "3g") return 720;
  if (batterySaver) return 720; // low battery, unplugged → avoid 1080p+ decode heat
  return null; // 4g / unknown → let ABR + player-size cap decide (may go 4K on a 4K screen)
}

/**
 * The one manual override the spec asks for ("allow users to manually select
 * quality if desired"). Kept deliberately simple — a reels feed has no room for
 * a per-rendition picker, so this is the same three-way choice as every major
 * short-video app: let the automatic heuristics decide, force data-saver
 * regardless of network, or force the ceiling off entirely (their call to spend
 * the battery/data). Persisted locally; read synchronously so it never delays
 * stream attach.
 */
export type QualityPreference = "auto" | "data-saver" | "high";
const QUALITY_PREF_KEY = "frenz:video-quality-pref";

export function getQualityPreference(): QualityPreference {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(QUALITY_PREF_KEY) : null;
    return v === "data-saver" || v === "high" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setQualityPreference(pref: QualityPreference): void {
  try {
    localStorage.setItem(QUALITY_PREF_KEY, pref);
  } catch {
    /* storage unavailable (private mode) — preference just won't persist */
  }
}

function resolveMaxHeight(
  pref: QualityPreference,
  saveData: boolean,
  effectiveType: string | undefined,
  batterySaver: boolean | undefined,
): number | null {
  if (pref === "high") return null; // explicit user override — never cap
  if (pref === "data-saver") return 480;
  return heightCap(saveData, effectiveType, batterySaver);
}

/**
 * Synchronous read (connection info only, no battery — that API is
 * promise-based). Used at stream-attach time so instant playback never waits
 * on a battery read: we'd rather start immediately at a network-appropriate cap
 * and refine to a battery-appropriate cap a moment later via
 * {@link getPlaybackConditions}.
 */
export function getSyncConditions(): PlaybackConditions {
  const conn = readConnection();
  const saveData = !!conn?.saveData;
  const effectiveType = conn?.effectiveType;
  const downlinkMbps = typeof conn?.downlink === "number" ? conn.downlink : undefined;
  const pref = getQualityPreference();
  return {
    saveData,
    effectiveType,
    downlinkMbps,
    maxHeight: resolveMaxHeight(pref, saveData, effectiveType, undefined),
  };
}

/**
 * Full snapshot including the (async) Battery API. Pass `{ battery: false }` to
 * skip it. Never throws.
 */
export async function getPlaybackConditions(opts: { battery?: boolean } = {}): Promise<PlaybackConditions> {
  const conn = readConnection();
  const saveData = !!conn?.saveData;
  const effectiveType = conn?.effectiveType;
  const downlinkMbps = typeof conn?.downlink === "number" ? conn.downlink : undefined;
  const batterySaver = opts.battery === false ? undefined : await readBatterySaver();
  const pref = getQualityPreference();
  return {
    saveData,
    effectiveType,
    downlinkMbps,
    batterySaver,
    maxHeight: resolveMaxHeight(pref, saveData, effectiveType, batterySaver),
  };
}
