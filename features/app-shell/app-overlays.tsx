"use client";

import dynamic from "next/dynamic";

/**
 * Heavy, always-mounted overlays — the create composer, block Story Studio, the
 * download/HLS player, and the iOS install nudge. They're hidden until triggered,
 * so we code-split them out of the initial bundle (ssr:false) and load their
 * chunks in the background after hydration. This trims the JS every app page ships
 * up front → faster Time-to-Interactive, no behavior change.
 */
const UploadModal = dynamic(() => import("@/features/create/upload-modal").then((m) => m.UploadModal), { ssr: false });
const StoryStudio = dynamic(() => import("@/features/create/studio/story-studio").then((m) => m.StoryStudio), { ssr: false });
const DownloadPlayer = dynamic(() => import("@/features/downloads/download-player").then((m) => m.DownloadPlayer), { ssr: false });
const IosInstallPrompt = dynamic(() => import("@/features/notifications/ios-install-prompt").then((m) => m.IosInstallPrompt), { ssr: false });
const PushNudge = dynamic(() => import("@/features/notifications/push-nudge").then((m) => m.PushNudge), { ssr: false });

export function AppOverlays() {
  return (
    <>
      <UploadModal />
      <StoryStudio />
      <DownloadPlayer />
      <IosInstallPrompt />
      <PushNudge />
    </>
  );
}
