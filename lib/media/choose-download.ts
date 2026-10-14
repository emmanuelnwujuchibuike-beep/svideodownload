"use client";

import { createElement } from "react";

import type { DownloadVersion } from "@/features/media/download-choice";

/**
 * Opens the watermark chooser and resolves with the pick, or null when it was
 * dismissed. Imperative, because `downloadPost` is a plain function called
 * from five surfaces; the sheet's code loads only when someone taps Download.
 */
export async function chooseDownloadVersion(opts: { isOwner?: boolean } = {}): Promise<DownloadVersion | null> {
  const [{ createRoot }, { DownloadChoiceSheet }] = await Promise.all([
    import("react-dom/client"),
    import("@/features/media/download-choice"),
  ]);
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    const onDone = (v: DownloadVersion | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
      // after the sheet's exit animation
      setTimeout(() => {
        root.unmount();
        host.remove();
      }, 450);
    };
    root.render(createElement(DownloadChoiceSheet, { isOwner: !!opts.isOwner, onDone }));
  });
}
