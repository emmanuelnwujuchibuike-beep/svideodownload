/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";

import { OG_ICON_BASE64 } from "@/components/og-icon-data";
import { OG_WORDMARK_FONT_BASE64 } from "@/components/og-font-data";

/**
 * The download watermark: the Frenzsave mark + the creator's @handle, as one
 * transparent PNG (owner, 2026-10-14). ONE renderer for both surfaces — the
 * browser stamps it onto photos (/api/watermark/mark → lib/media/watermark-image.ts)
 * and the worker burns it into videos (server/services/watermark-service.ts) —
 * so a photo and a video from the same creator carry the identical mark.
 *
 * The pill sits at the LEFT of a wide transparent canvas; both compositors
 * place the image at the bottom-left, so the spare width is just air.
 * Assets are inlined (no disk, no fetch), the OG image's rule.
 */

import { MARK_SIZE } from "@/lib/media/watermark-mark-geometry";

export { MARK_INSET, MARK_SHARE, MARK_SIZE } from "@/lib/media/watermark-mark-geometry";

const icon = `data:image/png;base64,${OG_ICON_BASE64}`;
const FONT = "Bricolage Grotesque";

export function watermarkMarkResponse(handle: string): ImageResponse {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "18px 40px 18px 18px",
            borderRadius: 999,
            background: "rgba(0,0,0,0.42)",
          }}
        >
          <img src={icon} width={150} height={150} style={{ borderRadius: 40 }} alt="" />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 26 }}>
            <span style={{ fontFamily: FONT, fontSize: 64, color: "#ffffff", lineHeight: 1 }}>Frenzsave</span>
            <span style={{ fontFamily: FONT, fontSize: 54, color: "rgba(255,255,255,0.88)", lineHeight: 1, marginTop: 10 }}>
              @{handle}
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...MARK_SIZE,
      fonts: [{ name: FONT, data: Buffer.from(OG_WORDMARK_FONT_BASE64, "base64"), style: "normal", weight: 800 }],
    },
  );
}
