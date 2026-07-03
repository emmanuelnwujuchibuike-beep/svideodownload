"use client";

/**
 * Capture a JPEG cover image from the first frame of a video File, entirely in
 * the browser. Used so every uploaded video/reel has a real poster — the cover
 * shows on the profile grid, the feed and the reel viewer instead of a blank
 * placeholder. Best-effort: resolves null if the frame can't be grabbed (the
 * post is still created, just without a captured cover).
 */
export function captureVideoPoster(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (blob: Blob | null, url?: string) => {
      if (settled) return;
      settled = true;
      if (url) URL.revokeObjectURL(url);
      resolve(blob);
    };
    try {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = url;

      const grab = () => {
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (!w || !h) return finish(null, url);
          const scale = Math.min(1, 720 / w);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish(null, url);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => finish(b, url), "image/jpeg", 0.82);
        } catch {
          finish(null, url);
        }
      };

      video.onerror = () => finish(null, url);
      video.onloadeddata = () => {
        video.onseeked = grab;
        // Seek slightly in so we don't grab a black leading frame.
        try {
          video.currentTime = Math.min(0.1, (video.duration || 1) * 0.1);
        } catch {
          grab();
        }
      };
      // Safety net if events never fire.
      setTimeout(() => finish(null, url), 4000);
    } catch {
      finish(null);
    }
  });
}
