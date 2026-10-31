/**
 * ═══ ONE FROSTED GLASS FOR EVERY FLOATING BUTTON ═══
 *
 * Owner, 2026-10-31: the feed header's frosted glass (design/frenz-exclusive-feed.html `.circle`) goes on "the Profile
 * page top floating buttons … the friends pages floating buttons and everywhere that there's a floating button".
 * This supersedes 2026-10-07's dark glass on the profile cover. `FROSTED_GLASS` is the surface only — size, shape and
 * layout stay with each button — so every floating control is one recipe: a white gradient, a white hairline,
 * inner light and a violet-tinted drop, with ink icons. NO backdrop-filter (owner, 2026-10-31: heat): these buttons sit on a
 * bar that already blurs, or over a still image — a second live blur per button cost GPU on every scroll frame.
 *
 * Not here on purpose: controls over full-screen video or a dark media viewer (Reels, the post viewer) keep their dark
 * immersive glass so white glyphs read on any frame, and brand-gradient action buttons are not glass at all.
 */
export const FROSTED_GLASS =
  "border border-white/85 bg-[linear-gradient(160deg,rgba(255,255,255,.88),rgba(255,255,255,.6))] text-[#0E0E12] shadow-[inset_0_1px_1px_rgba(255,255,255,.9),inset_0_-1px_2px_rgba(14,14,18,.06),0_8px_20px_-10px_rgba(40,30,90,.35)] transition-transform duration-150 active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7B5CF0] motion-reduce:active:scale-100";

/** The profile cover's controls — now the same frosted glass as the feed header (owner, 2026-10-31). */
export const FLOATING_GLASS = FROSTED_GLASS;

/** A glass circle button: the glass, round, clickable through a pass-through bar, ink icons. */
export const FLOATING_GLASS_CIRCLE = `pointer-events-auto rounded-full ${FROSTED_GLASS} [&_svg]:h-[21px] [&_svg]:w-[21px] [&_svg]:text-[#0E0E12]`;

/** The feed pages' header circle (design/frenz-exclusive-feed.html, 2026-10-31 second pass): 48 px of the frosted glass. */
export const FEED_HEADER_CIRCLE = `pointer-events-auto !h-12 !w-12 rounded-full ${FROSTED_GLASS} [&_svg]:h-[22px] [&_svg]:w-[22px] [&_svg]:text-[#0E0E12]`;
