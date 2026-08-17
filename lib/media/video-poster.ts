"use client";

export interface VideoPosterResult {
  blob: Blob | null;
  /** The clip's own natural pixel size, read from the SAME `<video>` element
   *  this function already loads to grab the poster frame — no separate pass.
   *  Null whenever `blob` is (metadata never loaded, or grabbing failed). */
  width: number | null;
  height: number | null;
}

/**
 * Capture a JPEG cover image from the first frame of a video File, entirely in
 * the browser. Used so every uploaded video/reel has a real poster — the cover
 * shows on the profile grid, the feed and the reel viewer instead of a blank
 * placeholder. Best-effort: resolves `blob: null` if the frame can't be
 * grabbed (the post is still created, just without a captured cover).
 *
 * 🔴 Also returns the clip's natural width/height (owner, 2026-08-17: "it
 * still glitches and show a wrong size... whenever i enter" — the feed's
 * media box was falling back to a generic aspect-ratio guess for every
 * native upload because nothing captured the real dimensions client-side,
 * despite this function already reading `video.videoWidth`/`videoHeight`
 * internally to size the poster canvas). Every existing call site only ever
 * used the return value as a `Blob | null` — see `composer-core.ts`/
 * `story-studio.tsx` for the updated destructuring.
 */
export function captureVideoPoster(file: File): Promise<VideoPosterResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: VideoPosterResult, url?: string) => {
      if (settled) return;
      settled = true;
      if (url) URL.revokeObjectURL(url);
      resolve(result);
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
          if (!w || !h) return finish({ blob: null, width: null, height: null }, url);
          const scale = Math.min(1, 720 / w);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(w * scale);
          canvas.height = Math.round(h * scale);
          const ctx = canvas.getContext("2d");
          if (!ctx) return finish({ blob: null, width: w, height: h }, url);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((b) => finish({ blob: b, width: w, height: h }, url), "image/jpeg", 0.82);
        } catch {
          finish({ blob: null, width: null, height: null }, url);
        }
      };

      video.onerror = () => finish({ blob: null, width: null, height: null }, url);
      video.onloadeddata = () => {
        // Seek ~0.5s+ in (never the very first frame) so we don't capture the
        // black leading frame that made covers look corrupted.
        const d = video.duration || 0;
        const t = d > 0.6 ? Math.min(Math.max(0.5, d * 0.1), d - 0.1) : 0.2;
        // Double rAF ensures the seeked frame has actually painted before we draw.
        video.onseeked = () => requestAnimationFrame(() => requestAnimationFrame(grab));
        try {
          video.currentTime = t;
        } catch {
          grab();
        }
      };
      // Safety net if events never fire.
      setTimeout(() => finish({ blob: null, width: null, height: null }, url), 5000);
    } catch {
      finish({ blob: null, width: null, height: null });
    }
  });
}
