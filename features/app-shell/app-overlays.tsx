"use client";

import dynamic from "next/dynamic";

/**
 * Heavy, always-mounted overlays — the block Story Studio, the download/HLS
 * player, and the iOS install nudge. They're hidden until triggered, so we
 * code-split them out of the initial bundle (ssr:false) and load their chunks
 * in the background after hydration. This trims the JS every app page ships
 * up front → faster Time-to-Interactive, no behavior change.
 *
 * The create composer used to live here as a single global modal. It's gone
 * (2026-07-16): Post, Reel and Story are now three separate routes under
 * /create, each with its own surface — so the composer is no longer an overlay
 * every app page has to carry, and its chunk only loads when someone actually
 * navigates to a create page.
 */
const StoryStudio = dynamic(() => import("@/features/create/studio/story-studio").then((m) => m.StoryStudio), { ssr: false });
const DownloadPlayer = dynamic(() => import("@/features/downloads/download-player").then((m) => m.DownloadPlayer), { ssr: false });
const IosInstallPrompt = dynamic(() => import("@/features/notifications/ios-install-prompt").then((m) => m.IosInstallPrompt), { ssr: false });
const PushNudge = dynamic(() => import("@/features/notifications/push-nudge").then((m) => m.PushNudge), { ssr: false });
const FloatingDownloadProgress = dynamic(() => import("@/features/downloads/floating-progress").then((m) => m.FloatingDownloadProgress), { ssr: false });

export function AppOverlays() {
  return (
    <>
      <StoryStudio />
      <DownloadPlayer />
      <IosInstallPrompt />
      <PushNudge />
      <FloatingDownloadProgress />
    </>
  );
}
