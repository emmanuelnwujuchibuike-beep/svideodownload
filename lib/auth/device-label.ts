export type DeviceIcon = "phone" | "tablet" | "laptop" | "desktop";

/** Best-effort, dependency-free device/browser label parsed from a User-Agent. */
export function parseDevice(ua: string | null): { label: string; icon: DeviceIcon } {
  if (!ua) return { label: "Unknown device", icon: "desktop" };

  const isTablet = /iPad|Tablet/i.test(ua);
  const isMobile = !isTablet && /iPhone|Android.*Mobile|Mobile/i.test(ua);

  const os = /iPhone|iPad|iPod/i.test(ua)
    ? "iOS"
    : /Android/i.test(ua)
      ? "Android"
      : /Macintosh|Mac OS X/i.test(ua)
        ? "Mac"
        : /Windows/i.test(ua)
          ? "Windows"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Unknown";

  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//i.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//i.test(ua)
        ? "Firefox"
        : /Safari\//i.test(ua)
          ? "Safari"
          : "Browser";

  const icon: DeviceIcon = isTablet
    ? "tablet"
    : isMobile
      ? "phone"
      : os === "Mac" || os === "Windows" || os === "Linux"
        ? "laptop"
        : "desktop";

  const label = os === "Unknown" ? browser : `${browser} on ${os}`;
  return { label, icon };
}
