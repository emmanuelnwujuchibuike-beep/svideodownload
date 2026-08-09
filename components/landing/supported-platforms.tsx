import { BRAND_ICONS } from "@/lib/platform-icons";
import { cn } from "@/lib/utils";
import type { PlatformId } from "@/types";

/**
 * The "Supported Platforms:" badge strip.
 *
 * ── One component, two surfaces ──────────────────────────────────────────────
 * It appears twice on the landing page and the two sit on very different
 * backgrounds: under the hero download button (a light section) and inside the
 * "Download anything" card (a purple gradient, per `public/newlanding.jpg`).
 * Copying the markup for the second tone is how the two drift — the same trap
 * the Wallpaper CTA was just collapsed out of — so the surface is a prop.
 *
 * ── Zero client JavaScript ───────────────────────────────────────────────────
 * A plain server component. The landing has no headroom in its cold-entry
 * budget, and this is static markup with no behaviour; it must never gain any.
 *
 * ── Why the list is a constant and not derived ───────────────────────────────
 * `lib/platforms` knows about more platforms than a visitor needs to see in a
 * row of eight badges — the point here is instant recognition, not completeness.
 * The full list lives one tap away on the downloader pages.
 */
export const SUPPORTED_PLATFORMS: PlatformId[] = [
  "tiktok",
  "twitter",
  "snapchat",
  "instagram",
  "facebook",
  "pinterest",
  "youtube",
  "telegram",
];

export function SupportedPlatforms({
  /**
   * "light" sits on the page background; "onGradient" sits on the purple
   * download card, where the label needs white ink to be legible.
   */
  surface = "light",
  className,
}: {
  surface?: "light" | "onGradient";
  className?: string;
}) {
  const onGradient = surface === "onGradient";
  return (
    /*
      ONE line that scrolls, never a wrapping grid.

      With the label plus eight badges, `flex-wrap` broke onto a second row on
      a phone — six marks, then two orphans — which is most of what made the
      hero's CTA stack look scattered (owner, 2026-08-09). A single row that
      scrolls horizontally keeps the rhythm of the stack intact at every width
      and matches how the category pills already behave elsewhere.

      The scrollbar is hidden because this is an eight-item strip, not a
      browsing surface; the marks are recognisable enough that a partially
      visible one still reads as "and more".
    */
    <div
      className={cn(
        "flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <span
        className={cn(
          "shrink-0 text-xs font-semibold",
          onGradient ? "text-white/80" : "text-slate-500 dark:text-white/60",
        )}
      >
        Supported Platforms:
      </span>
      {SUPPORTED_PLATFORMS.map((id) => {
        const Icon = BRAND_ICONS[id];
        return Icon ? (
          <span
            key={id}
            /*
              The badge stays a white disc on BOTH surfaces. Brand marks are
              drawn for light backgrounds — tinting the disc to match the page
              would make several of them (YouTube, Pinterest) lose their own
              colour, and a recognisable logo is the entire job of this row.
            */
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-neutral-900 shadow-sm",
              !onGradient && "ring-1 ring-inset ring-slate-200/70 dark:ring-white/10",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
          </span>
        ) : null;
      })}
    </div>
  );
}
