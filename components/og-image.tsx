/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";

/**
 * Shared artwork for the social-share / OpenGraph image, rendered to PNG by
 * `next/og` (Satori). Satori supports a constrained subset of CSS — every box
 * with multiple children must be `display: flex`.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT =
  "SVideoDownload — Download TikTok & 1000+ platform videos, watermark-free";

/** The download-arrow logo glyph (used in the badge). */
function LogoMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth={2.3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v9" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function OgImage(): ReactElement {
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 92,
            height: 92,
            borderRadius: 24,
            background: "linear-gradient(135deg, #ec4899, #22d3ee)",
          }}
        >
          <LogoMark size={52} />
        </div>
        <div style={{ display: "flex", fontSize: 54, fontWeight: 800, color: "white" }}>
          <span style={{ color: "white" }}>S</span>
          <span style={{ color: "#f472b6" }}>Video</span>
          <span style={{ color: "white" }}>Download</span>
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
        Download TikTok &amp; 1000+ Platforms
      </div>

      {/* Sub */}
      <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: "#94a3b8" }}>
        Fast · Watermark-free · HD · No login
      </div>
    </div>
  );
}
