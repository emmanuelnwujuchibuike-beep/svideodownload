/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";

import { OG_ICON_BASE64 } from "@/components/og-icon-data";

/**
 * Shared artwork for every social-share / OpenGraph image, rendered to PNG
 * by `next/og` (Satori). Satori supports a constrained subset of CSS —
 * every box with multiple children must be `display: flex`.
 *
 * Owner decision (2026-07-11): one universal "premium logo card" — white
 * ground, soft brand-color ambient glow (the same blue→violet→purple
 * language app/layout.tsx's own background already uses), just the F mark,
 * no wordmark, no headline, no description text. The textual description
 * lives in the page's own `<meta name="description">` (generateMetadata),
 * never on the image itself — so every share (homepage, every
 * [downloader] SEO page) now uses this exact same card.
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
        background: "#ffffff",
        position: "relative",
      }}
    >
      {/* Ambient brand-color glow — same blue/violet/purple language as the
          app's own root-layout background, just translated to Satori's
          supported CSS subset (plain radial-gradient boxes, no Tailwind). */}
      <div
        style={{
          position: "absolute",
          left: -180,
          top: -160,
          width: 620,
          height: 620,
          display: "flex",
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(56,132,255,0.30), rgba(56,132,255,0) 70%)",
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -200,
          top: -120,
          width: 560,
          height: 560,
          display: "flex",
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(168,85,247,0.26), rgba(168,85,247,0) 70%)",
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -260,
          width: 700,
          height: 500,
          display: "flex",
          marginLeft: -350,
          borderRadius: 9999,
          background: "radial-gradient(circle, rgba(236,72,153,0.16), rgba(236,72,153,0) 70%)",
          filter: "blur(10px)",
        }}
      />

      {/* The mark — a soft shadow underneath for depth on the white ground. */}
      <div
        style={{
          position: "absolute",
          width: 300,
          height: 60,
          bottom: 165,
          borderRadius: 9999,
          background: "radial-gradient(ellipse, rgba(15,10,40,0.16), rgba(15,10,40,0) 72%)",
          display: "flex",
        }}
      />
      <img src={iconDataUri} width={380} height={380} alt="" style={{ position: "relative" }} />
    </div>
  );
}
