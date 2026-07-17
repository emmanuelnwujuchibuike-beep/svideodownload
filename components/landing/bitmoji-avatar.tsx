/**
 * Cartoon avatar for the landing page — a Snapchat-Bitmoji-style face, generated.
 *
 * WHY THIS EXISTS AND NOT A REAL AVATAR: the landing page is public and anonymous,
 * and a real person's face + handle should not be used as marketing decoration for
 * a product they merely signed up to. Real profile photos and names never leave the
 * app onto this page — the mockup and the people rail render these instead.
 *
 * Deterministic: the same seed always yields the same face, so a given person is
 * visually stable across renders without their identity ever being involved. Pure
 * inline SVG — no network, no image decode, no CLS, and it costs nothing on the
 * hero's critical path (docs/FEATURE_21_HERO.md §1). No emoji, per the house rule.
 */

const SKIN = ["#F2C9A0", "#E0A87B", "#C68642", "#8D5524", "#5C3317", "#FFDBB4"];
const HAIR = ["#2C1B18", "#4A312C", "#1B1B1B", "#6B4423", "#A55728", "#0F0F14"];
const SHIRT = ["#0A84FF", "#6C4DFF", "#F43F5E", "#10B981", "#F59E0B", "#8E6BFF"];
const BG = [
  "from-blue-500 to-indigo-600",
  "from-rose-500 to-pink-600",
  "from-violet-500 to-purple-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-cyan-500 to-blue-600",
];

/** Small, stable string hash — same seed in, same face out. */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function bitmojiBg(seed: string): string {
  return BG[hash(seed) % BG.length]!;
}

export function BitmojiAvatar({ seed, className }: { seed: string; className?: string }) {
  const h = hash(seed);
  const skin = SKIN[h % SKIN.length]!;
  const hair = HAIR[(h >> 3) % HAIR.length]!;
  const shirt = SHIRT[(h >> 6) % SHIRT.length]!;
  const variant = (h >> 9) % 3; // hair shape
  const smile = (h >> 11) % 2; // grin vs soft smile

  const uid = `bm${h.toString(36)}`;
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Illustrated avatar">
      <defs>
        {/* Soft dimensional shading — a top-left light source: highlight on the
            forehead/cheek, shadow toward the jaw. Gives the flat glyph a rounded,
            Bitmoji-like read without any raster asset. */}
        <radialGradient id={`${uid}-skin`} cx="40%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.18" />
        </radialGradient>
        <linearGradient id={`${uid}-shirt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
      </defs>
      {/* shoulders */}
      <path d="M10 64c0-11 9.9-17 22-17s22 6 22 17z" fill={shirt} />
      <path d="M10 64c0-11 9.9-17 22-17s22 6 22 17z" fill={`url(#${uid}-shirt)`} />
      {/* neck (with a soft chin shadow above it) */}
      <rect x="27" y="38" width="10" height="12" rx="5" fill={skin} />
      <ellipse cx="32" cy="40" rx="9" ry="3.5" fill="#000000" opacity="0.12" />
      {/* head */}
      <ellipse cx="32" cy="27" rx="15" ry="16" fill={skin} />
      {/* ears */}
      <circle cx="17" cy="28" r="3" fill={skin} />
      <circle cx="47" cy="28" r="3" fill={skin} />
      {/* dimensional shading over the skin, UNDER hair + features */}
      <ellipse cx="32" cy="27" rx="15" ry="16" fill={`url(#${uid}-skin)`} />
      {/* hair */}
      {variant === 0 ? (
        <path d="M17 24c0-9 6.7-14 15-14s15 5 15 14c0-4-4-6-15-6s-15 2-15 6z" fill={hair} />
      ) : variant === 1 ? (
        <path d="M17 26c-1-11 6-17 15-17s16 6 15 17c-2-6-3-9-7-10-3 3-14 4-18 1-2 2-4 5-5 9z" fill={hair} />
      ) : (
        <path d="M17 25c0-10 7-15 15-15s15 5 15 15c-2-3-2-7-6-8-4 4-14 4-18 2-3 1-5 3-6 6z" fill={hair} />
      )}
      {/* eyes */}
      <ellipse cx="26" cy="27" rx="2.1" ry="2.6" fill="#1B1B1B" />
      <ellipse cx="38" cy="27" rx="2.1" ry="2.6" fill="#1B1B1B" />
      <circle cx="26.8" cy="26.2" r="0.7" fill="#fff" />
      <circle cx="38.8" cy="26.2" r="0.7" fill="#fff" />
      {/* brows */}
      <path d="M23 22.5q3-1.6 6 0" stroke={hair} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M35 22.5q3-1.6 6 0" stroke={hair} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      {/* cheek blush — a small warmth, the Bitmoji tell */}
      <ellipse cx="24" cy="31" rx="2.4" ry="1.6" fill="#ff6b6b" opacity="0.18" />
      <ellipse cx="40" cy="31" rx="2.4" ry="1.6" fill="#ff6b6b" opacity="0.18" />
      {/* mouth */}
      {smile ? (
        <path d="M27 34q5 4.5 10 0" stroke="#7A3B2E" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M27 33.5q5 5 10 0z" fill="#7A3B2E" />
      )}
    </svg>
  );
}
