/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  WHO THIS DEVICE IS — for banning abusive raters, signed in or not (2026-10-22)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner: "take every detail needed from the anonymous user's browser and device so the banning works
 * perfectly for anonymous users too". A ban (app_bans, 0267) is matched against three things a guest
 * cannot easily shed together:
 *
 *   deviceId     a random id kept on this device (localStorage) for abuse protection only — NOT the
 *                analytics visitor id, which exists only for people who accepted analytics;
 *   fingerprint  a SHA-256 of traits that survive clearing storage and a new tab: platform and model,
 *                screen, pixel ratio, colour depth, time zone, languages, CPU cores, memory, touch
 *                points, the GPU's renderer string and a canvas drawing;
 *   (server)     the network address and the browser string, read from the request itself.
 *
 * Client-only, dependency-free, computed once per page and cached. Nothing here is sent anywhere by
 * itself: the rating and the fetch requests carry it.
 */

export interface DeviceDetails {
  platform: string | null;
  model: string | null;
  platformVersion: string | null;
  mobile: boolean | null;
  languages: string[];
  timeZone: string | null;
  screen: string | null;
  pixelRatio: number | null;
  colorDepth: number | null;
  cores: number | null;
  memoryGb: number | null;
  touchPoints: number | null;
  gpu: string | null;
  standalone: boolean;
}

export interface DeviceSignals {
  deviceId: string | null;
  fingerprint: string | null;
  details: DeviceDetails;
}

const KEY = "frenz_did";

/** This device's abuse-protection id — created on first use, kept in localStorage. Null where storage is blocked. */
export function deviceId(): string | null {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[0-9a-f-]{16,64}$/i.test(id)) {
      id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

function gpu(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") || c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof r === "string" ? r.slice(0, 160) : null;
  } catch {
    return null;
  }
}

function canvasMark(): string {
  try {
    const c = document.createElement("canvas");
    c.width = 220;
    c.height = 30;
    const g = c.getContext("2d");
    if (!g) return "";
    g.textBaseline = "top";
    g.font = "14px 'Arial'";
    g.fillStyle = "#f60";
    g.fillRect(100, 1, 62, 20);
    g.fillStyle = "#069";
    g.fillText("Frenz,🎬 device 1.0", 2, 15);
    return c.toDataURL().slice(-160);
  } catch {
    return "";
  }
}

async function sha256(text: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

async function collect(): Promise<DeviceSignals> {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: { platform?: string; mobile?: boolean; getHighEntropyValues?: (h: string[]) => Promise<{ model?: string; platformVersion?: string }> };
  };
  let model: string | null = null;
  let platformVersion: string | null = null;
  try {
    // Chromium's client hints name the phone model ("SM-A515F") — the most specific device trait a browser offers
    const hi = await nav.userAgentData?.getHighEntropyValues?.(["model", "platformVersion"]);
    model = hi?.model || null;
    platformVersion = hi?.platformVersion || null;
  } catch {
    /* not offered */
  }
  const details: DeviceDetails = {
    platform: nav.userAgentData?.platform || nav.platform || null,
    model,
    platformVersion,
    mobile: typeof nav.userAgentData?.mobile === "boolean" ? nav.userAgentData.mobile : null,
    languages: [...(nav.languages ?? [nav.language])].filter(Boolean).slice(0, 5),
    timeZone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
      } catch {
        return null;
      }
    })(),
    screen: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : null,
    pixelRatio: typeof devicePixelRatio === "number" ? devicePixelRatio : null,
    colorDepth: typeof screen !== "undefined" ? screen.colorDepth : null,
    cores: nav.hardwareConcurrency ?? null,
    memoryGb: nav.deviceMemory ?? null,
    touchPoints: nav.maxTouchPoints ?? null,
    gpu: gpu(),
    standalone: typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches,
  };
  // the browser's VERSION is left out on purpose: an update must not make the same phone a new device
  const stable = [details.platform, details.model, details.platformVersion, details.screen, details.pixelRatio, details.colorDepth, details.timeZone, details.languages.join(","), details.cores, details.memoryGb, details.touchPoints, details.gpu, canvasMark()].join("|");
  return { deviceId: deviceId(), fingerprint: await sha256(stable), details };
}

let cached: Promise<DeviceSignals> | null = null;

/** This device's signals — computed once per page (a few ms), then shared. */
export function deviceSignals(): Promise<DeviceSignals> {
  cached ??= collect().catch(() => ({ deviceId: deviceId(), fingerprint: null, details: emptyDetails() }));
  return cached;
}

function emptyDetails(): DeviceDetails {
  return { platform: null, model: null, platformVersion: null, mobile: null, languages: [], timeZone: null, screen: null, pixelRatio: null, colorDepth: null, cores: null, memoryGb: null, touchPoints: null, gpu: null, standalone: false };
}
