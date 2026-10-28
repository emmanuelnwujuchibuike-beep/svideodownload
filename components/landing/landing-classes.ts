/* The landing's Frenz class strings, shared by its React sections (landing-ui.tsx), its deferred markup
   (lib/landing/deferred-sections.ts) and every marketing page that wears the new landing design
   (design/frenz-landing.html: ink buttons, neumorphic cards). */

/** A white card on the white page (the shared Card's look, as a class for links and lists). */
export const LANDING_CARD = "rounded-[22px] border border-frenz-line bg-frenz-card shadow-frenz-card";

/** The 40 px violet icon tile every Frenz row leads with. */
export const ICON_TILE = "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-frenz-violet/10 text-frenz-violet";

/** The ink fill and shadow of every main button (Download, Install, Add friends) — inverts in dark. */
export const INK = "bg-frenz-ink text-frenz-page shadow-[0_14px_28px_-14px_rgb(18_17_26/0.6)]";

/** The primary action: ink, like the Download button. */
export const PRIMARY_ACTION = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl ${INK} px-5 font-heading text-[15px] font-bold no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2 data-[pending]:opacity-80`;

/** Neumorphic skin: a raised card on the page. */
export const NEU_RAISED =
  "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_12px_30px_-8px_rgba(16,24,40,.14),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-6px_-6px_16px_rgba(255,255,255,.045),9px_11px_26px_rgba(0,0,0,.55)]";

/** Neumorphic skin: an inset well inside a raised card. */
export const NEU_WELL = "bg-frenz-fill shadow-[inset_0_2px_5px_rgba(16,24,40,.08)] dark:shadow-[inset_0_2px_6px_rgba(0,0,0,.5)]";

/** Neumorphic skin: a small raised chip (icon tiles, secondary buttons). */
export const NEU_CHIP =
  "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_6px_14px_-4px_rgba(16,24,40,.13),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-4px_-4px_10px_rgba(255,255,255,.045),5px_6px_14px_rgba(0,0,0,.55)]";

/** A secondary action: a raised chip with violet text (Open Creator Lounge). */
export const SECONDARY_ACTION = `inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl ${NEU_CHIP} px-5 font-heading text-[15px] font-bold text-frenz-violet no-underline transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet focus-visible:ring-offset-2`;
