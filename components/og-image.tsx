/* eslint-disable @next/next/no-img-element */
import type { ReactElement } from "react";

import { OG_ICON_BASE64 } from "@/components/og-icon-data";
import { OG_WORDMARK_FONT_BASE64 } from "@/components/og-font-data";

/**
 * Shared artwork for every social-share / OpenGraph image, rendered to PNG
 * by `next/og` (Satori). Satori supports a constrained subset of CSS —
 * every box with multiple children must be `display: flex`.
 *
 * Owner decision (2026-07-11, v2): a premium jewel-tone brand gradient card —
 * deep navy into Electric Blue into Royal Purple (the same brand palette as
 * app/globals.css) — with the F mark in a white badge circle plus the
 * "Frenz" wordmark, an icon+wordmark lockup in Frenz's own colors instead of
 * a generic logo-only card. No headline/description text on the image
 * itself — that lives in the page's own `<meta name="description">`
 * (generateMetadata). Every share (homepage, every [downloader] SEO page)
 * uses this exact same card.
 *
 * v3 (2026-07-11): "looks casual" — a high-luxury pass. A metallic bezel
 * ring around the badge (coin/medallion, not a flat sticker), a warm third
 * accent glow for richness, a hairline frame around the whole card (the
 * "premium packaging edge" luxury brands use), and the wordmark moved from
 * Space Grotesk to Bricolage Grotesque ExtraBold — more character/charm
 * while staying a clean, legible brand sans.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_ALT =
  "FrenzSave — Download and meet new friends with the latest news and reels";

// The real brand mark, inlined as a data URI — Satori renders synchronously, so
// a data URI (no network fetch) is the reliable way to embed it.
const iconDataUri = `data:image/png;base64,${OG_ICON_BASE64}`;

const WORDMARK_FONT = "Bricolage Grotesque";

// The wordmark font, inlined as a base64 constant (same reasoning as the icon
// data URI above) — a runtime fetch of a local static-asset URL only resolves
// reliably under the edge runtime, and a network fetch to Google Fonts adds an
// avoidable failure mode. See the OG-image crash incident memory: OG/share
// assets stay hardcoded, never read from disk or fetched at request time.
// Variable font — weight 800 selects its ExtraBold instance.
export function getOgFonts(): {
  name: string;
  data: Buffer;
  style: "normal";
  weight: 800;
}[] {
  return [
    {
      name: WORDMARK_FONT,
      data: Buffer.from(OG_WORDMARK_FONT_BASE64, "base64"),
      style: "normal",
      weight: 800,
    },
  ];
}

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
        background:
          "linear-gradient(135deg, #060A24 0%, #0A5CE0 34%, #6C4DFF 68%, #1B0E42 100%)",
      }}
    >
      {/* Soft brand-color light catches, top-left (electric blue) and
          bottom-right (violet) — same blue/violet/purple language as the
          app's own root-layout background, translated to Satori's supported
          CSS subset (plain radial-gradient boxes, no Tailwind). */}
      <div
        style={{
          position: "absolute",
          left: -160,
          top: -200,
          width: 620,
          height: 620,
          display: "flex",
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(62,166,255,0.5), rgba(62,166,255,0) 70%)",
          filter: "blur(10px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -220,
          bottom: -240,
          width: 660,
          height: 660,
          display: "flex",
          borderRadius: 9999,
          background:
            "radial-gradient(circle, rgba(142,107,255,0.46), rgba(142,107,255,0) 70%)",
          filter: "blur(10px)",
        }}
      />
      {/* A third, warmer accent glow low-center — the extra light source that
          takes the card from "flat two-tone gradient" to genuinely
          dimensional, the way a product-photography rim light does. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: -260,
          marginLeft: -260,
          width: 520,
          height: 340,
          display: "flex",
          borderRadius: 9999,
          background:
            "radial-gradient(ellipse, rgba(198,168,255,0.22), rgba(198,168,255,0) 72%)",
          filter: "blur(6px)",
        }}
      />

      {/* Diagonal glass sheen — a soft rotated highlight band for a polished,
          light-catching surface rather than a flat gradient fill. */}
      <div
        style={{
          position: "absolute",
          left: -200,
          top: -360,
          width: 1500,
          height: 420,
          display: "flex",
          transform: "rotate(-9deg)",
          background:
            "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.10) 45%, rgba(255,255,255,0) 100%)",
        }}
      />

      {/* Depth vignette — painted last so it consistently frames every layer
          beneath it, darkening the corners for a rich, dimensional card
          instead of a flat, candy-bright fill. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          display: "flex",
          background:
            "radial-gradient(ellipse at 50% 46%, rgba(0,0,0,0) 42%, rgba(2,1,15,0.48) 100%)",
        }}
      />

      {/* Hairline frame — the "premium packaging edge" luxury cards use, a
          thin light inset border tying the whole 1200x630 card together
          instead of the gradient bleeding to the raw crop edge. */}
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 22,
          right: 22,
          bottom: 22,
          display: "flex",
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,0.16)",
        }}
      />

      {/* The icon + wordmark lockup. */}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 44,
        }}
      >
        {/* Glow lifting the badge off the gradient. */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            marginLeft: -190,
            marginTop: -190,
            width: 380,
            height: 380,
            display: "flex",
            borderRadius: 9999,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.45), rgba(255,255,255,0) 68%)",
            filter: "blur(6px)",
          }}
        />

        {/* Medallion bezel — a metallic-tinted ring around the badge (coin/
            medallion, not a flat sticker): pale gold-white sweep so the edge
            catches light instead of reading as a plain white circle. */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 246,
            height: 246,
            borderRadius: 9999,
            background:
              "linear-gradient(155deg, #FFFFFF 0%, #F3E9CE 30%, #FFFFFF 55%, #D8CBEF 78%, #FFFFFF 100%)",
            boxShadow: "0 26px 70px -14px rgba(3,2,18,0.62)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 236,
              height: 236,
              borderRadius: 9999,
              background:
                "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.62) 100%)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 224,
                height: 224,
                borderRadius: 9999,
                background: "#FFFFFF",
              }}
            >
              <img
                src={iconDataUri}
                width={148}
                height={148}
                alt=""
                style={{ display: "flex" }}
              />
            </div>
          </div>
        </div>

        <span
          style={{
            position: "relative",
            display: "flex",
            fontFamily: WORDMARK_FONT,
            fontWeight: 700,
            fontSize: 132,
            letterSpacing: -3,
            lineHeight: 1,
            color: "#FFFFFF",
          }}
        >
          Frenz
        </span>
      </div>
    </div>
  );
}
