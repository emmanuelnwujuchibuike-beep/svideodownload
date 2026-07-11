"use client";

type InstallEvent = "pwa_install_prompt_shown" | "pwa_install_accepted" | "pwa_install_dismissed" | "pwa_installed";
type Platform = "android" | "ios" | "ios-inapp" | "desktop";

/** Fire-and-forget install-funnel beacon — never blocks or throws; a failed
 * send just means one missing analytics row, never a broken install flow. */
export function reportInstallEvent(event: InstallEvent, platform?: Platform): void {
  try {
    fetch("/api/pwa/install-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, platform }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
