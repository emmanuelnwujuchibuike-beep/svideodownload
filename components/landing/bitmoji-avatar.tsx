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
 *
 * Variety is deliberate: skin, hair colour, hairstyle, eyes, brows, glasses and
 * shirt all key off DIFFERENT slices of the hash so two seeds rarely look alike.
 * Gender is explicit (`female`) rather than guessed — a name doesn't reliably tell
 * you, and getting it wrong on a real-looking face is worse than a coin flip. When
 * omitted it's derived from the seed so a crowd is mixed.
 */

const SKIN = ["#F2C9A0", "#E0A87B", "#C68642", "#8D5524", "#5C3317", "#FFDBB4", "#D9A066"];
const HAIR = ["#2C1B18", "#4A312C", "#1B1B1B", "#6B4423", "#A55728", "#0F0F14", "#7B4B2A", "#B87333"];
const SHIRT = ["#0A84FF", "#6C4DFF", "#F43F5E", "#10B981", "#F59E0B", "#8E6BFF", "#EC4899", "#14B8A6"];
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

export function BitmojiAvatar({
  seed,
  female,
  className,
}: {
  seed: string;
  female?: boolean;
  className?: string;
}) {
  const h = hash(seed);
  const skin = SKIN[h % SKIN.length]!;
  const hair = HAIR[(h >> 3) % HAIR.length]!;
  const shirt = SHIRT[(h >> 6) % SHIRT.length]!;
  const isFemale = female ?? ((h >> 8) & 1) === 1;
  const style = (h >> 9) % 4; // hairstyle within gender
  const smile = ((h >> 12) & 1) === 1;
  const glasses = (h >> 13) % 4 === 0; // ~1 in 4
  const uid = `bm${h.toString(36)}`;

  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Illustrated avatar">
      <defs>
        {/* Soft dimensional shading — a top-left light source: highlight on the
            forehead/cheek, shadow toward the jaw. */}
        <radialGradient id={`${uid}-skin`} cx="40%" cy="34%" r="75%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.18" />
        </radialGradient>
        <linearGradient id={`${uid}-shirt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id={`${uid}-hair`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.12" />
        </linearGradient>
      </defs>

      {/* Long hair for women is drawn BEHIND the head first, so it frames the face. */}
      {isFemale ? (
        style === 0 ? (
          // long straight past the shoulders
          <path d="M14 26c0-11 8-18 18-18s18 7 18 18v22c0 4-4 6-8 6l-2-24H24l-2 24c-4 0-8-2-8-6z" fill={hair} />
        ) : style === 1 ? (
          // wavy long
          <path d="M13 27c0-12 9-19 19-19s19 7 19 19c1 8-1 15-4 21-2-3-3-8-3-14l-2-6H23l-2 6c0 6-1 11-3 14-3-6-3-13-2-21z" fill={hair} />
        ) : null
      ) : null}

      {/* shoulders */}
      <path d="M10 64c0-11 9.9-17 22-17s22 6 22 17z" fill={shirt} />
      <path d="M10 64c0-11 9.9-17 22-17s22 6 22 17z" fill={`url(#${uid}-shirt)`} />
      {/* neck + soft chin shadow */}
      <rect x="27" y="38" width="10" height="12" rx="5" fill={skin} />
      <ellipse cx="32" cy="40" rx="9" ry="3.5" fill="#000000" opacity="0.12" />
      {/* head — women a touch narrower for a softer face */}
      <ellipse cx="32" cy="27" rx={isFemale ? 14 : 15} ry="16" fill={skin} />
      {/* ears (+ studs on women) */}
      <circle cx={isFemale ? 18 : 17} cy="28" r="3" fill={skin} />
      <circle cx={isFemale ? 46 : 47} cy="28" r="3" fill={skin} />
      {isFemale ? (
        <>
          <circle cx="18" cy="31" r="1" fill="#FFD700" />
          <circle cx="46" cy="31" r="1" fill="#FFD700" />
        </>
      ) : null}
      {/* dimensional shading over the skin, UNDER hair + features */}
      <ellipse cx="32" cy="27" rx={isFemale ? 14 : 15} ry="16" fill={`url(#${uid}-skin)`} />

      {/* Top hair — gendered set. */}
      {isFemale ? (
        style === 2 ? (
          // bob framing the cheeks
          <path d="M17 27c0-11 7-17 15-17s15 6 15 17c0-3-1-6-4-7-3 3-8 4-11 4-4 0-8-1-11-4-2 1-4 4-4 7z" fill={hair} />
        ) : style === 3 ? (
          // centre part with a small bun up top
          <>
            <circle cx="32" cy="9" r="4" fill={hair} />
            <path d="M17 26c0-10 7-16 15-16s15 6 15 16c-2-3-3-7-8-8l-1 3h-12l-1-3c-5 1-6 5-8 8z" fill={hair} />
          </>
        ) : (
          // front hairline for the long styles above
          <path d="M18 25c0-10 6-16 14-16s14 6 14 16c-2-4-4-7-9-8-2 2-3 3-5 3s-3-1-5-3c-5 1-7 4-9 8z" fill={hair} />
        )
      ) : style === 0 ? (
        <path d="M17 24c0-9 6.7-14 15-14s15 5 15 14c0-4-4-6-15-6s-15 2-15 6z" fill={hair} />
      ) : style === 1 ? (
        <path d="M17 26c-1-11 6-17 15-17s16 6 15 17c-2-6-3-9-7-10-3 3-14 4-18 1-2 2-4 5-5 9z" fill={hair} />
      ) : style === 2 ? (
        // side part with a swoop
        <path d="M17 25c0-10 7-15 15-15s15 5 15 15c-2-4-3-8-8-9-6 3-15 3-19 5-1 1-2 2-3 4z" fill={hair} />
      ) : (
        // short textured / curly top
        <path d="M18 24a6 6 0 0 1 4-8 6 6 0 0 1 10-3 6 6 0 0 1 10 3 6 6 0 0 1 4 8c-3-3-8-4-14-4s-11 1-14 4z" fill={hair} />
      )}
      {/* hair sheen */}
      <ellipse cx="27" cy="15" rx="6" ry="3" fill={`url(#${uid}-hair)`} opacity="0.5" />

      {/* eyes */}
      <ellipse cx="26" cy="27" rx="2.1" ry="2.6" fill="#1B1B1B" />
      <ellipse cx="38" cy="27" rx="2.1" ry="2.6" fill="#1B1B1B" />
      <circle cx="26.8" cy="26.2" r="0.7" fill="#fff" />
      <circle cx="38.8" cy="26.2" r="0.7" fill="#fff" />
      {/* lashes on women */}
      {isFemale ? (
        <>
          <path d="M23.6 25.2q2.4-1.4 4.8 0" stroke="#1B1B1B" strokeWidth="1" strokeLinecap="round" fill="none" />
          <path d="M35.6 25.2q2.4-1.4 4.8 0" stroke="#1B1B1B" strokeWidth="1" strokeLinecap="round" fill="none" />
        </>
      ) : null}
      {/* brows — thinner/higher on women */}
      <path d="M23 22.5q3-1.6 6 0" stroke={hair} strokeWidth={isFemale ? 1.1 : 1.5} strokeLinecap="round" fill="none" />
      <path d="M35 22.5q3-1.6 6 0" stroke={hair} strokeWidth={isFemale ? 1.1 : 1.5} strokeLinecap="round" fill="none" />

      {/* glasses (some) */}
      {glasses ? (
        <g stroke="#333" strokeWidth="0.9" fill="none" opacity="0.85">
          <circle cx="26" cy="27" r="3.6" />
          <circle cx="38" cy="27" r="3.6" />
          <path d="M29.6 27h4.8M22.4 26.5l-3 .5M41.6 26.5l3 .5" />
        </g>
      ) : null}

      {/* cheek blush */}
      <ellipse cx="24" cy="31" rx="2.4" ry="1.6" fill="#ff6b6b" opacity={isFemale ? 0.28 : 0.18} />
      <ellipse cx="40" cy="31" rx="2.4" ry="1.6" fill="#ff6b6b" opacity={isFemale ? 0.28 : 0.18} />

      {/* mouth — women get a fuller, tinted lip */}
      {isFemale ? (
        <path d="M28 33.5q4 3.5 8 0q-4 2-8 0z" fill="#C64B5B" />
      ) : smile ? (
        <path d="M27 34q5 4.5 10 0" stroke="#7A3B2E" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M27 33.5q5 5 10 0z" fill="#7A3B2E" />
      )}
    </svg>
  );
}
