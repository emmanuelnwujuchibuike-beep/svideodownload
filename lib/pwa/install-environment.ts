/**
 * Smart Install — what browser is this, and how does a person install here?
 *
 * ── Pure, and parameterised on the UA string ──────────────────────────────────
 * Every function here takes the user-agent as an argument instead of reading
 * `navigator` itself, matching the convention `classifyInstallPlatform`
 * (lib/pwa/platform.ts) and `parseDevice` (lib/auth/device-label.ts) already set
 * in this codebase. That is what makes the whole matrix testable without a DOM —
 * a browser table nobody can test is a browser table that quietly rots.
 *
 * ── Capability first, UA second ───────────────────────────────────────────────
 * The flow is decided by whether a real `beforeinstallprompt` was captured
 * (lib/pwa/install-store.ts), NOT by this file. UA detection only decides which
 * WORDS to show when there is no native prompt to fire — i.e. it names the
 * browser's own menu items. That ordering matters: a new Chromium browser
 * nobody has heard of still gets the one-tap native install, and only the
 * fallback copy has to guess.
 *
 * ── No dependency ─────────────────────────────────────────────────────────────
 * Deliberately hand-rolled rather than a UA-parsing package: the full libraries
 * are 20-40 kB to answer a question this file answers in a few hundred bytes,
 * and this ships to a 275 kB-budgeted origin. Detection is also strictly local —
 * nothing here is transmitted, stored, or used to fingerprint anyone.
 */

export type BrowserId =
  | "safari"
  | "chrome"
  | "firefox"
  | "edge"
  | "opera"
  | "samsung"
  | "brave"
  | "chromium"
  | "inapp"
  | "unknown";

export type OsId = "ios" | "android" | "macos" | "windows" | "linux" | "unknown";
export type FormFactor = "mobile" | "tablet" | "desktop";

export interface InstallEnvironment {
  browser: BrowserId;
  os: OsId;
  form: FormFactor;
  /** Which app's in-app webview this is, when we can name it. */
  inAppName: string | null;
  /** Human label for the modal's subtitle: "Safari on iPhone". */
  label: string;
}

/**
 * Embedded webviews. A link opened inside Instagram/Facebook/TikTok renders in
 * the host app's own browser, which exposes neither `beforeinstallprompt` nor
 * iOS's share sheet — so installation is genuinely impossible there and the
 * honest answer is "open this in your real browser", not a set of steps that
 * cannot work.
 */
const IN_APP: [RegExp, string][] = [
  [/FBAN|FBAV|FB_IAB/i, "Facebook"],
  [/Instagram/i, "Instagram"],
  [/TikTok|musical_ly|BytedanceWebview/i, "TikTok"],
  [/Messenger/i, "Messenger"],
  [/Twitter/i, "X"],
  [/Snapchat/i, "Snapchat"],
  [/LinkedInApp/i, "LinkedIn"],
  [/Pinterest/i, "Pinterest"],
  [/MicroMessenger/i, "WeChat"],
  [/Line\//i, "Line"],
  [/WhatsApp/i, "WhatsApp"],
];

export function detectInApp(ua: string): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  return null;
}

export function detectOs(ua: string, platform?: string, maxTouchPoints = 0): OsId {
  // iPadOS 13+ reports itself as "MacIntel" with a real touch screen — the one
  // case where the platform string alone is actively wrong.
  if (/iphone|ipad|ipod/i.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1)) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/win/i.test(platform ?? "") || /windows/i.test(ua)) return "windows";
  if (/mac/i.test(platform ?? "") || /mac os x/i.test(ua)) return "macos";
  if (/linux|x11|cros/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Browser identity. ORDER IS THE WHOLE ALGORITHM: every Chromium browser also
 * says "Chrome" and most say "Safari" too, so the specific tokens have to be
 * ruled out before the generic ones. Getting this backwards is why so many
 * sites tell an Edge user to open the Chrome menu.
 */
export function detectBrowser(ua: string, hasBrave = false): BrowserId {
  if (detectInApp(ua)) return "inapp";
  if (hasBrave) return "brave";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/EdgA?|Edg\//i.test(ua)) return "edge";
  if (/OPR\/|Opera|OPiOS/i.test(ua)) return "opera";
  if (/Firefox\/|FxiOS/i.test(ua)) return "firefox";
  // iOS Chrome is CriOS; desktop/Android Chrome is Chrome but NOT Chromium-only
  // forks, which were all excluded above.
  if (/CriOS|Chrome\//i.test(ua)) return "chrome";
  // Real Safari is the one that says Safari without saying Chrome.
  if (/Safari\//i.test(ua)) return "safari";
  if (/Chromium/i.test(ua)) return "chromium";
  return "unknown";
}

export function detectForm(ua: string, os: OsId, maxTouchPoints = 0): FormFactor {
  if (/ipad/i.test(ua) || (os === "ios" && maxTouchPoints > 1 && !/iphone|ipod/i.test(ua))) return "tablet";
  if (os === "ios") return "mobile";
  if (os === "android") return /mobile/i.test(ua) ? "mobile" : "tablet";
  return "desktop";
}

const BROWSER_NAME: Record<BrowserId, string> = {
  safari: "Safari",
  chrome: "Chrome",
  firefox: "Firefox",
  edge: "Edge",
  opera: "Opera",
  samsung: "Samsung Internet",
  brave: "Brave",
  chromium: "your browser",
  inapp: "this app",
  unknown: "your browser",
};

function deviceName(os: OsId, form: FormFactor): string {
  if (os === "ios") return form === "tablet" ? "iPad" : "iPhone";
  if (os === "android") return "Android";
  if (os === "macos") return "Mac";
  if (os === "windows") return "Windows";
  if (os === "linux") return "Linux";
  return form === "desktop" ? "desktop" : "your device";
}

export function describeEnvironment(
  ua: string,
  platform?: string,
  maxTouchPoints = 0,
  hasBrave = false,
): InstallEnvironment {
  const os = detectOs(ua, platform, maxTouchPoints);
  const browser = detectBrowser(ua, hasBrave);
  const form = detectForm(ua, os, maxTouchPoints);
  const inAppName = detectInApp(ua);
  const label = inAppName
    ? `${inAppName}'s in-app browser`
    : `${BROWSER_NAME[browser]} on ${deviceName(os, form)}`;
  return { browser, os, form, inAppName, label };
}

/** Read the live environment. Called ONCE, when the modal opens. */
export function readEnvironment(): InstallEnvironment {
  if (typeof navigator === "undefined") {
    return { browser: "unknown", os: "unknown", form: "desktop", inAppName: null, label: "your browser" };
  }
  const nav = navigator as Navigator & { brave?: unknown };
  return describeEnvironment(nav.userAgent, nav.platform, nav.maxTouchPoints ?? 0, Boolean(nav.brave));
}

/**
 * The manual steps, as plain strings.
 *
 * Kept as text rather than illustrations on purpose: screenshots of eight
 * browsers would be the single heaviest thing this feature could ship, they go
 * stale the moment a browser redraws its menu, and they cannot be translated or
 * read aloud. Each step names a control the person can actually see in their
 * own chrome.
 *
 * `null` means "this environment cannot install at all" — only true for
 * embedded webviews, and the modal shows the open-in-browser path instead.
 */
export interface InstallGuide {
  title: string;
  steps: string[];
  /** Shown when the browser genuinely cannot install a web app. */
  note?: string;
}

export function installGuide(env: InstallEnvironment): InstallGuide {
  const { browser, os, form } = env;

  if (env.inAppName) {
    return {
      title: "Open Frenz in your browser",
      steps: [
        `Tap the ${env.inAppName === "Instagram" || env.inAppName === "Facebook" ? "•••" : "menu"} button in this app.`,
        os === "ios" ? "Choose Open in Safari." : "Choose Open in browser.",
        "Then use Install from there.",
      ],
      note: `${env.inAppName} opens links in its own viewer, which can't add apps to your home screen.`,
    };
  }

  // Every iOS browser is WebKit under Apple's rules and reaches Add to Home
  // Screen through the same OS share sheet — Chrome and Firefox for iOS
  // included. Only the browser's NAME changes, never the steps.
  if (os === "ios") {
    const where = browser === "safari" ? "Safari" : BROWSER_NAME[browser];
    return {
      title: `Install Frenz on your ${form === "tablet" ? "iPad" : "iPhone"}`,
      steps: [
        `Tap the Share button in ${where}.`,
        "Scroll down and tap Add to Home Screen.",
        "Turn on Open as Web App if shown.",
        "Tap Add.",
      ],
      note: "The Share button is in your browser's toolbar, not on this page.",
    };
  }

  if (browser === "firefox") {
    return os === "android"
      ? {
          title: "Install Frenz on Android",
          steps: ["Tap the ⋮ menu in Firefox.", "Tap Add to Home screen.", "Confirm to add it."],
        }
      : {
          title: "Add Frenz to your desktop",
          steps: [
            "Firefox on desktop doesn't install web apps.",
            "Open frenzsave.com in Chrome, Edge or Brave to install it.",
            "Or press Ctrl/Cmd + D to bookmark it here.",
          ],
          note: "This is a Firefox limitation, not something Frenz can work around.",
        };
  }

  if (browser === "samsung") {
    return {
      title: "Install Frenz on Android",
      steps: ["Tap the ☰ menu in Samsung Internet.", "Tap Add page to, then Home screen.", "Confirm to add it."],
    };
  }

  if (os === "android") {
    return {
      title: "Install Frenz on Android",
      steps: [`Tap the ⋮ menu in ${BROWSER_NAME[browser]}.`, "Tap Install app or Add to Home screen.", "Confirm to install."],
    };
  }

  if (browser === "safari" && os === "macos") {
    return {
      title: "Install Frenz on your Mac",
      steps: ["Open the File menu in Safari.", "Choose Add to Dock.", "Click Add."],
      note: "Add to Dock needs macOS Sonoma or newer.",
    };
  }

  if (browser === "edge" || browser === "chrome" || browser === "brave" || browser === "opera" || browser === "chromium") {
    return {
      title: "Install Frenz on your desktop",
      steps: [
        "Look for the install icon in the address bar.",
        `Or open the ${BROWSER_NAME[browser]} menu and choose Install Frenz.`,
        "Confirm to install.",
      ],
    };
  }

  return {
    title: "Install Frenz",
    steps: ["Open your browser's menu.", "Look for Install app or Add to Home Screen.", "Confirm to add it."],
    note: "Your browser doesn't provide an automatic installation prompt.",
  };
}

/** The browser-picker list, for "Using a different browser?". */
export const BROWSER_CHOICES: { id: BrowserId; name: string }[] = [
  { id: "chrome", name: "Chrome" },
  { id: "safari", name: "Safari" },
  { id: "firefox", name: "Firefox" },
  { id: "edge", name: "Edge" },
  { id: "samsung", name: "Samsung Internet" },
  { id: "opera", name: "Opera" },
];
