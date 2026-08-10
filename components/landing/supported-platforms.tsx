import { BRAND_ICONS, BRAND_MARKS } from "@/lib/platform-icons";
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
      {/*
        "Platforms supported" (owner, 2026-08-10: "don't use the word work, use
        platform supported").

        The reference draws "Works with" here and I had followed it. Overruled,
        and the owner's wording is the better one anyway: "works with" is the
        language of compatibility — of a thing that plugs into something else —
        while this row is a statement about what the product itself handles.
        The colon from the original label is dropped; it bought nothing and this
        row spends every pixel of width it can on the marks.
      */}
      <span
        className={cn(
          "shrink-0 text-xs font-semibold",
          onGradient ? "text-white/80" : "text-slate-500 dark:text-white/60",
        )}
      >
        Platforms supported
      </span>
      {SUPPORTED_PLATFORMS.map((id) => {
        const Icon = BRAND_ICONS[id];
        const mark = BRAND_MARKS[id];
        return Icon ? (
          <span
            key={id}
            /*
              ── Squircle tiles, brand colour (public/landingnew.jpg) ──────────
              Owner, 2026-08-10: "use the way icons are on the button in the
              design I saved in public."

              Two changes from the discs this replaced. The tile is a rounded
              SQUARE and a size bigger, which is what the reference draws and
              which reads as an app icon rather than as a bullet point. And the
              glyph is the brand's own colour instead of one flat near-black —
              the row exists so someone can spot their app instantly, and seven
              identical grey marks is the one treatment that cannot do that.

              The tile stays WHITE on both surfaces, including the purple card.
              Brand marks are drawn for light backgrounds; tinting the tile
              would cost YouTube and Pinterest their own colour, and the logo IS
              the message here.

              `mark.bg` overrides that for the two brands whose identity is the
              surface rather than the ink — see `BRAND_MARKS`, where the pairing
              is contrast-tested.
            */
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm",
              !onGradient && "ring-1 ring-inset ring-slate-200/70 dark:ring-white/10",
            )}
            style={mark?.bg ? { background: mark.bg } : undefined}
          >
            <Icon className="h-[18px] w-[18px]" style={mark ? { color: mark.fg } : undefined} />
          </span>
        ) : null;
      })}
    </div>
  );
}
