/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";

import { OG_ICON_BASE64 } from "@/components/og-icon-data";

/**
 * Shared artwork for the social-share / OpenGraph image, rendered to PNG by
 * `next/og` (Satori). Satori supports a constrained subset of CSS — every box
 * with multiple children must be `display: flex`.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT =
  "FrenzSave — Download and meet new friends with the latest news and reels";

// The real brand mark, inlined as a data URI — Satori renders synchronously, so
// a data URI (no network fetch) is the reliable way to embed it.
const iconDataUri = `data:image/png;base64,${OG_ICON_BASE64}`;

export function OgImage({
  headline = "Download & meet new friends with the latest news and reels",
  sub = "Fast · Watermark-free · HD · No login",
}: {
  headline?: string;
  sub?: string;
} = {}): ReactElement {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a14",
        position: "relative",
        fontFamily: "sans-serif",
      }}
    >
      {/* Ambient glow */}
      <div
        style={{
          position: "absolute",
          top: -160,
          width: 1000,
          height: 600,
          display: "flex",
          background:
            "radial-gradient(circle, rgba(236,72,153,0.40), rgba(34,211,238,0.16), transparent 70%)",
        }}
      />

      {/* Logo lockup */}
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        <img src={iconDataUri} width={92} height={92} alt="" style={{ borderRadius: 20 }} />
        <div style={{ display: "flex", fontSize: 54, fontWeight: 800, color: "white" }}>
          <span style={{ color: "white" }}>Frenz</span>
          <span style={{ color: "#60a5fa" }}>Save</span>
        </div>
      </div>

      {/* Headline */}
      <div
        style={{
          display: "flex",
          marginTop: 44,
          fontSize: 66,
          fontWeight: 800,
          color: "white",
          maxWidth: 980,
          textAlign: "center",
          lineHeight: 1.1,
        }}
      >
        {headline}
      </div>

      {/* Sub */}
      <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: "#94a3b8" }}>
        {sub}
      </div>
    </div>
  );
}
