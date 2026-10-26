/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";

import { OG_ICON_BASE64 } from "@/components/og-icon-data";

/**
 * Shared artwork for every social-share / OpenGraph image, rendered to PNG
 * by `next/og` (Satori). Satori supports a constrained subset of CSS —
 * every box with multiple children must be `display: flex`.
 *
 * v4 (owner, 2026-10-25, with a WhatsApp screenshot of the old card): "remove the Frenz text on the og image … it
 * should be only the f logo on the white circle background bold in the centre of the gradient blue and make the
 * gradient blue background more premium and light, use the brand blue purple gradient and not this dark blue".
 * So: no wordmark, no dark navy, no darkening vignette — the F mark alone on a bold white disc, centred on a LIGHT
 * brand gradient (Electric Blue #3D5AFE → Royal Violet #7B3FE4, a touch of Magenta #C23FD1 — the app's own
 * `bg-frenz-gradient`), lifted with soft white light rather than shadowed into the dark.
 * No headline or description on the image — that lives in the page's own `<meta name="description">`.
 * Every share (homepage, every [downloader] SEO page, X/Twitter) uses this exact card. No font is needed any more.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT =
  "FrenzSave — Download and meet new friends with the latest news and reels";

// The real brand mark, inlined as a data URI — Satori renders synchronously, so
// a data URI (no network fetch) is the reliable way to embed it.
const iconDataUri = `data:image/png;base64,${OG_ICON_BASE64}`;

export function OgImage(): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        // the brand gradient, kept LIGHT: a bright electric blue into royal violet, a magenta breath at the far corner
        background: "linear-gradient(135deg, #6E8BFF 0%, #3D5AFE 34%, #7B3FE4 74%, #B05CEB 100%)",
      }}
    >
      {/* Soft white light from the top-left — the "premium, light" lift (no dark corners). */}
      <div
        style={{
          position: "absolute",
          left: -180,
          top: -260,
          width: 760,
          height: 760,
          display: "flex",
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(255,255,255,0.42), rgba(255,255,255,0) 68%)",
        }}
      />
      {/* A pale violet glow bottom-right, so the purple end stays luminous rather than heavy. */}
      <div
        style={{
          position: "absolute",
          right: -220,
          bottom: -280,
          width: 720,
          height: 720,
          display: "flex",
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(232,214,255,0.40), rgba(232,214,255,0) 70%)",
        }}
      />
      {/* A gentle glass sheen across the card. */}
      <div
        style={{
          position: "absolute",
          left: -200,
          top: -330,
          width: 1600,
          height: 460,
          display: "flex",
          transform: "rotate(-9deg)",
          background: "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.14) 48%, rgba(255,255,255,0) 100%)",
        }}
      />

      {/* The halo behind the disc — white light, so the badge glows instead of casting a dark shadow. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          marginLeft: -260,
          marginTop: -260,
          width: 520,
          height: 520,
          display: "flex",
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(255,255,255,0.55), rgba(255,255,255,0) 66%)",
        }}
      />

      {/* The F mark on a bold white disc, centred. A thin bright rim gives the disc a crisp, premium edge. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 316,
          height: 316,
          borderRadius: 9999,
          background: "linear-gradient(160deg, #FFFFFF 0%, #F1ECFF 100%)",
          boxShadow: "0 30px 80px -24px rgba(48,30,140,0.45)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 298,
            height: 298,
            borderRadius: 9999,
            background: "#FFFFFF",
          }}
        >
          <img src={iconDataUri} width={196} height={196} alt="" style={{ display: "flex" }} />
        </div>
      </div>
    </div>
  );
}
