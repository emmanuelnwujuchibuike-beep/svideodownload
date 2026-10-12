/**
 * A device the member will recognise, from the browser's user-agent string
 * (Feature 20 Part 6, Device Manager). "iPhone · Safari", "Windows · Edge".
 * Pure; never shown to anyone but the device's owner. The member can rename it.
 */
export function deviceName(ua: string | null | undefined): { name: string; platform: "ios" | "android" | "windows" | "mac" | "linux" | "other" } {
  const u = ua ?? "";
  const platform = /iPhone|iPod/.test(u) ? "ios" : /iPad/.test(u) || (/Macintosh/.test(u) && /Mobile/.test(u)) ? "ios" : /Android/.test(u) ? "android" : /Windows/.test(u) ? "windows" : /Macintosh|Mac OS X/.test(u) ? "mac" : /Linux/.test(u) ? "linux" : "other";
  const kind = /iPhone|iPod/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? (/Mobile/.test(u) ? "Android phone" : "Android tablet") : platform === "windows" ? "Windows" : platform === "mac" ? "Mac" : platform === "linux" ? "Linux" : "Device";
  const browser = /EdgA?\//.test(u) ? "Edge" : /SamsungBrowser/.test(u) ? "Samsung Internet" : /OPR\//.test(u) ? "Opera" : /Firefox|FxiOS/.test(u) ? "Firefox" : /CriOS|Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
  return { name: browser ? `${kind} · ${browser}` : kind, platform };
}
