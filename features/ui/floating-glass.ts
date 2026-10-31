/**
 * The floating glass circle (owner, 2026-10-07: "more premium and glassy like iOS Instagram"): dark frosted
 * glass, legible over a bright cover AND over page content scrolling under it, with a hairline light edge, a
 * soft drop and a spring press. Shared by the profile's cover controls and, since 2026-10-23, the feed's
 * header ("change the feed top header to be like the profile premium floating glass").
 */
export const FLOATING_GLASS =
  "bg-black/30 text-white ring-1 ring-inset ring-white/25 backdrop-blur-lg backdrop-saturate-150 shadow-[0_10px_28px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.28)] transition-[background-color,transform] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:bg-black/40 active:scale-90 active:duration-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 motion-reduce:active:scale-100";

/** A glass circle button: the glass, round, clickable through a pass-through bar, icons sized like the profile's. */
export const FLOATING_GLASS_CIRCLE = `pointer-events-auto rounded-full ${FLOATING_GLASS} [&_svg]:h-[21px] [&_svg]:w-[21px] [&_svg]:text-white`;

/**
 * The feed pages' header circle (design/frenz-exclusive-feed.html — owner, 2026-10-31: "the top header and buttons of all
 * feeds pages"): white, 48 px, a hairline edge and a soft drop, ink icon. Over page content, not a photo — the dark glass
 * above stays for the profile cover, where the circles sit on an image.
 */
export const FEED_HEADER_CIRCLE =
  // 2026-10-31, second pass: frosted glass — a white gradient, a white hairline, 20 px blur, inner light and a violet-tinted drop
  "pointer-events-auto !h-12 !w-12 rounded-full border border-white/85 bg-[linear-gradient(160deg,rgba(255,255,255,.75),rgba(255,255,255,.35))] text-[#0E0E12] shadow-[inset_0_1px_1px_rgba(255,255,255,.9),inset_0_-1px_2px_rgba(14,14,18,.06),0_8px_20px_-10px_rgba(40,30,90,.35)] backdrop-blur-[20px] backdrop-saturate-[1.8] transition-transform duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7B5CF0] motion-reduce:active:scale-100 [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:text-[#0E0E12]";
