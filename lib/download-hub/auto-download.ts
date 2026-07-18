/**
 * "Auto Download" preference — skip the quality picker and take the best
 * available rendition immediately.
 *
 * `localStorage` rather than the database because it is a device preference, not
 * an account one: the right default on a phone with limited storage differs from
 * the right default on a desktop, and syncing it across them would be wrong.
 *
 * Guarded for SSR and for blocked storage (private mode, embedded webviews),
 * where the honest fallback is "off" — never auto-start a download because a
 * preference read failed.
 */

const KEY = "frenz:downloads:auto";

export function getAutoDownload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoDownload(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "1" : "0");
    // Same-tab listeners: the `storage` event only fires in OTHER tabs, so the
    // rail toggle and the download box would otherwise disagree until reload.
    window.dispatchEvent(new CustomEvent(AUTO_DOWNLOAD_EVENT, { detail: on }));
  } catch {
    /* storage blocked — the toggle still works for this session */
  }
}

export const AUTO_DOWNLOAD_EVENT = "frenz:auto-download-changed";

/* ---------------------------- preferred quality --------------------------- */

/**
 * Default rendition to take when Auto Download skips the picker.
 *
 * The rail advertised a "Download Quality — choose default quality" control that
 * linked to `/account`, which has no such setting. Rather than delete the
 * control, this makes the promise true — and it is what Auto Download needs
 * anyway, since "always best" is the wrong default on a metered connection.
 */
export type PreferredQuality = "best" | "1080" | "720" | "480" | "audio";

export const QUALITY_OPTIONS: { value: PreferredQuality; label: string }[] = [
  { value: "best", label: "Best available" },
  { value: "1080", label: "1080p" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
  { value: "audio", label: "Audio only" },
];

const QUALITY_KEY = "frenz:downloads:quality";

export function getPreferredQuality(): PreferredQuality {
  if (typeof window === "undefined") return "best";
  try {
    const raw = window.localStorage.getItem(QUALITY_KEY);
    return QUALITY_OPTIONS.some((o) => o.value === raw) ? (raw as PreferredQuality) : "best";
  } catch {
    return "best";
  }
}

export function setPreferredQuality(q: PreferredQuality): void {
  try {
    window.localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* storage blocked — session-only */
  }
}
