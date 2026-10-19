/* The landing's Frenz class strings, shared by its React sections (landing-ui.tsx) and its deferred markup (lib/landing/deferred-sections.ts). */

/** A white card on the white page (the shared Card's look, as a class for links and lists). */
export const LANDING_CARD = "rounded-[22px] border border-frenz-line bg-frenz-card shadow-frenz-card";

/** The 40 px violet icon tile every Frenz row leads with. */
export const ICON_TILE = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet";

/** The primary action — the only place a section uses the gradient. */
export const PRIMARY_ACTION =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-frenz-gradient-x px-5 font-heading text-[15px] font-bold text-white no-underline shadow-frenz-card transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 data-[pending]:opacity-80";
