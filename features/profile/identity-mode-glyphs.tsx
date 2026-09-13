import { useId } from "react";

/**
 * The three identity-mode glyphs — Photo, Video, Avatar — drawn as filled,
 * rounded, softly lit shapes rather than line icons.
 *
 * Owner, 2026-09-13: "change the description card icon to a 3D professional
 * Snapchat-style icon, and don't use the sparkling star icon as the avatar
 * icon." The product's icon system is bare line glyphs; this pill is the one
 * place the owner asked for the other thing, so it gets its own three, and
 * nothing else borrows them.
 *
 * ── How the "3D" is made ───────────────────────────────────────────────────
 *
 * Each glyph is a solid silhouette filled with a top-to-bottom gradient (light
 * above, darker below), a white highlight sitting on its upper-left, and a
 * faint darker rim along the bottom. That is the whole recipe — a lit, slightly
 * domed object — and it is all vector, so it is crisp at any size and costs no
 * image request. `useId` keeps the gradient ids unique when the pill renders
 * three of them side by side.
 *
 * The active glyph is lit in the brand gradient with white details; the
 * inactive ones are a neutral grey so the chosen mode reads at a glance.
 */
export type IdentityModeGlyphName = "photo" | "video" | "avatar";

export function IdentityModeGlyph({
  name,
  active,
  className,
}: {
  name: IdentityModeGlyphName;
  active: boolean;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const body = `g-${uid}`;
  const shine = `s-${uid}`;
  const top = active ? "#8b9cff" : "#c9cdd6";
  const bottom = active ? "#5b3df5" : "#8b90a0";
  const detail = "#ffffff";
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
        <radialGradient id={shine} cx="0.3" cy="0.2" r="0.6">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {name === "photo" ? (
        <>
          {/* the print — a rounded card */}
          <rect x="3" y="4" width="18" height="16" rx="4.5" fill={`url(#${body})`} />
          <rect x="3" y="4" width="18" height="16" rx="4.5" fill={`url(#${shine})`} />
          {/* bottom rim */}
          <path d="M4.2 17.5c.6 1.7 2 2.5 3.8 2.5h8c1.8 0 3.2-.8 3.8-2.5" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1" />
          {/* sun */}
          <circle cx="9" cy="9.5" r="1.9" fill={detail} fillOpacity="0.95" />
          {/* mountains */}
          <path d="M5.5 17.2l4.2-5.1a1 1 0 0 1 1.55.02l2.35 3 1.5-1.8a1 1 0 0 1 1.5-.05l2.9 3.94" fill="none" stroke={detail} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : name === "video" ? (
        <>
          {/* camcorder body */}
          <rect x="2.5" y="6.5" width="13.5" height="11" rx="3.5" fill={`url(#${body})`} />
          <rect x="2.5" y="6.5" width="13.5" height="11" rx="3.5" fill={`url(#${shine})`} />
          {/* lens flap */}
          <path d="M16 10.4l3.6-2.2a1.2 1.2 0 0 1 1.9 1v5.6a1.2 1.2 0 0 1-1.9 1L16 13.6z" fill={`url(#${body})`} />
          <path d="M16 10.4l3.6-2.2a1.2 1.2 0 0 1 1.9 1v5.6a1.2 1.2 0 0 1-1.9 1L16 13.6z" fill={`url(#${shine})`} />
          {/* bottom rim */}
          <path d="M3.6 15.2c.5 1.5 1.7 2.3 3.4 2.3h5.6c1.7 0 2.9-.8 3.4-2.3" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1" />
          {/* lens glint */}
          <circle cx="7.6" cy="10.4" r="1.4" fill={detail} fillOpacity="0.9" />
        </>
      ) : (
        <>
          {/* shoulders */}
          <path d="M4 20.5c0-4.1 3.6-6.7 8-6.7s8 2.6 8 6.7c0 .9-.7 1.5-1.6 1.5H5.6C4.7 22 4 21.4 4 20.5z" fill={`url(#${body})`} />
          <path d="M4 20.5c0-4.1 3.6-6.7 8-6.7s8 2.6 8 6.7c0 .9-.7 1.5-1.6 1.5H5.6C4.7 22 4 21.4 4 20.5z" fill={`url(#${shine})`} />
          {/* head */}
          <circle cx="12" cy="8" r="5" fill={`url(#${body})`} />
          <circle cx="12" cy="8" r="5" fill={`url(#${shine})`} />
          {/* bottom rims */}
          <path d="M8.3 11.3a5 5 0 0 0 7.4 0" fill="none" stroke="#000" strokeOpacity="0.14" strokeWidth="1" />
          <path d="M5.4 21.2h13.2" fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="1" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
