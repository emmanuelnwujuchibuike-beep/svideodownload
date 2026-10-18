import { ImageResponse } from "next/og";

import { OG_WORDMARK_FONT_BASE64 } from "@/components/og-font-data";
import { MARK_SIZE } from "@/lib/media/watermark-mark-geometry";
import { isReservedHandle, profilePath } from "@/lib/social/profile-url";

/**
 * The download watermark, as one transparent PNG. ONE renderer for both surfaces — the
 * browser stamps it onto photos (/api/watermark/mark → lib/media/watermark-image.ts) and
 * the worker burns it into videos (server/services/watermark-service.ts) — so a photo and
 * a video from the same creator carry the identical mark.
 *
 * Owner, 2026-10-17: "In all watermarks, no Frenz and Frenzsave, only domain and username"
 * — the mark is exactly the creator's profile address, `frenzsave.com/<handle>` (the
 * /:handle form, lib/social/profile-url.ts). No logo, no wordmark, no @.
 *
 * The pill sits at the LEFT of a wide transparent canvas; both compositors place the image
 * at the bottom-left, so the spare width is just air. The font is inlined (no disk, no
 * fetch), the OG image's rule.
 */

export { MARK_INSET, MARK_SHARE, MARK_SIZE } from "@/lib/media/watermark-mark-geometry";

const FONT = "Bricolage Grotesque";

/**
 * The words on the mark: the creator's profile address. A creator with no handle reaches here
 * as the route's "frenzsave" fallback (app/api/posts/[id]/download) — that, or any reserved
 * name, is just the domain: never a made-up profile link.
 */
export function watermarkText(handle: string): string {
  const h = handle.replace(/^@/, "");
  return h && !isReservedHandle(h) ? `frenzsave.com${profilePath(h)}` : "frenzsave.com";
}

/** Fits the longest address (a 20-character handle) inside the canvas at one line. */
export function watermarkFontSize(text: string): number {
  // ~0.56 em per character in Bricolage ExtraBold; the pill's padding takes 80 px of the 1000
  return Math.max(36, Math.min(76, Math.floor((MARK_SIZE.width - 80) / (text.length * 0.56))));
}

export function watermarkMarkResponse(handle: string): ImageResponse {
  const text = watermarkText(handle);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "22px 40px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.42)",
          }}
        >
          <span style={{ fontFamily: FONT, fontSize: watermarkFontSize(text), color: "#ffffff", lineHeight: 1 }}>{text}</span>
        </div>
      </div>
    ),
    {
      ...MARK_SIZE,
      fonts: [{ name: FONT, data: Buffer.from(OG_WORDMARK_FONT_BASE64, "base64"), style: "normal", weight: 800 }],
    },
  );
}
