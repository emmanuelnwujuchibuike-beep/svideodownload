import { PlatformStatusDot } from "@/components/platform/platform-status-dot";
import { BRAND_ICONS, BRAND_MARKS } from "@/lib/platform-icons";
import { statusOf, type PlatformStatusMap } from "@/lib/platform-status";
import { getPlatformStatus } from "@/lib/platform-status-store";
import { PLATFORMS } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import type { PlatformId } from "@/types";

/**
 * The strip with live platform health, for SERVER callers.
 *
 * 🔴 Two components rather than one async component, and the split is a
 * performance requirement, not a style choice:
 *
 *  • `download-box.tsx` is `"use client"` and renders this strip. A client
 *    component cannot render an async server component, so making the strip
 *    itself async would break that page outright.
 *  • The landing must stay STATIC. This wrapper reads through the service-role
 *    client (no cookies, no headers), exactly like `PhoneMockup` already reads
 *    the landing settings, so `/` is still prerendered and the read happens at
 *    ISR revalidation rather than per request. LCP is untouched.
 *
 * Both components are server-only — no `"use client"` anywhere in this file or
 * in `PlatformStatusDot` — so the landing's client bundle does not grow by a
 * single byte. That is what keeps this inside the 275 kB cold-entry ceiling.
 */
export async function SupportedPlatformsLive(
  props: Omit<Parameters<typeof SupportedPlatforms>[0], "statuses">,
) {
  const statuses = await getPlatformStatus();
  return <SupportedPlatforms {...props} statuses={statuses} />;
}

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
  /**
   * Operator-declared platform health (Feature: platform status, 2026-08-11).
   *
   * 🔴 Passed IN rather than fetched here. This row renders on `/`, which is
   * statically generated — a data read inside it would opt the landing page out
   * of static generation and cost it the edge cache, the same trap recorded on
   * `getLandingSettings`. Every caller resolves it at a server boundary.
   *
   * Omitted means "no data", which resolves to operational for every platform,
   * so an unmigrated caller renders exactly what it did before.
   */
  statuses,
}: {
  surface?: "light" | "onGradient";
  className?: string;
  statuses?: PlatformStatusMap;
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
    /*
      ── STACKED, and every mark visible at once (owner, 2026-08-10) ───────────
      "make the platform logos beside platform supported to be under the platform
      supported text so the logos shows full without sliding."

      This was a single horizontal row — label first, then eight badges — that
      scrolled, because the label plus 8×36px tiles plus gaps needs ~460px and a
      320px phone has about 270px of container to give. So on the one form factor
      that matters most, the last two or three marks were always off-screen
      behind a hidden scrollbar, and finding them meant knowing to swipe a strip
      that gives no sign it can be swiped.

      Two changes, and the second is what actually solves it:

      • The label moves to its OWN line, which hands the marks the full width
        instead of the width left over after "Platforms supported".

      • The marks become an 8-column GRID rather than a flex row. A grid column
        is a share of the available width, so eight tiles always fit on one line
        at any viewport — they get smaller on a narrow phone instead of falling
        off the end. `aspect-square` keeps every tile a square as it scales, and
        the glyph inside is a `clamp()` so it tracks the tile down without
        becoming a speck.

      This also deletes an accessibility failure at the source rather than
      patching it. axe flagged both instances of this strip as
      `scrollable-region-focusable` (serious): it was a scroll container whose
      children are all plain `<span>`s, so there was nothing tabbable inside and
      a keyboard-only user could not reach the scrolled-off marks at all. With
      nothing to scroll, there is no dead end to give keyboard access to — and no
      pointless tab stop added to the hero either.

      The earlier objection to wrapping (owner, 2026-08-09: eight badges wrapped
      to "six marks, then two orphans") does not apply here. That was a `flex-wrap`
      row breaking wherever it ran out of room; this is a fixed eight-column grid
      that cannot produce an orphan.

      `max-w-md` caps the grid so the tiles do not inflate to 80px each inside
      the wide "Download anything" card — the row is a recognition cue, not a
      feature grid.
    */
    <div className={cn("flex flex-col gap-2", className)}>
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
          "text-xs font-semibold",
          onGradient ? "text-white/80" : "text-slate-500 dark:text-white/60",
        )}
      >
        Platforms supported
      </span>
      <div className="grid w-full max-w-md grid-cols-8 gap-1.5 sm:gap-2">
        {SUPPORTED_PLATFORMS.map((id) => {
          const Icon = BRAND_ICONS[id];
          const mark = BRAND_MARKS[id];
          return Icon ? (
            <span
              key={id}
              /*
                ── Squircle tiles, brand colour (public/landingnew.jpg) ────────
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

                🔴 `aspect-square w-full`, NOT `h-9 w-9` (owner, 2026-08-10 — all
                eight visible, no sliding). A fixed 36px tile is what forced the
                row to overflow on a phone in the first place: eight of them plus
                gaps cannot fit 270px, so something had to scroll off. A tile
                that is one-eighth of the width shrinks to fit instead — about
                29px on a 320px screen, 38px on a Pixel — and the row always ends
                where the column ends.
              */
              /*
                🔴 A PERCENTAGE radius, not `rounded-2xl`.

                `rounded-2xl` is a fixed 16px. That was a squircle on the old
                36px tile, but the tile now scales with the viewport — and at
                320px it is about 29px wide, where a 16px radius is more than
                half the side and renders a perfect CIRCLE. The tiles turned back
                into the discs the squircle deliberately replaced, only at the
                narrow width where nobody would think to look.

                `26%` holds the same shape at every size — close to the ~22.5%
                iOS uses for its own app icons, which is the look this row is
                imitating.
              */
              className={cn(
                // `relative` is what the status light positions against — see
                // PlatformStatusDot. Nothing else about the tile changes.
                "relative flex aspect-square w-full items-center justify-center rounded-[26%] bg-white shadow-sm",
                !onGradient && "ring-1 ring-inset ring-slate-200/70 dark:ring-white/10",
              )}
              style={mark?.bg ? { background: mark.bg } : undefined}
            >
              {/* The glyph tracks the tile down rather than staying 18px and
                  crowding it at the narrow end — clamped so it never becomes a
                  speck on a small phone or bloats on a wide card. */}
              <Icon
                className="h-[clamp(13px,3.6vw,18px)] w-[clamp(13px,3.6vw,18px)]"
                style={mark ? { color: mark.fg } : undefined}
              />
              {/* Renders NOTHING while the platform is working — see the note on
                  the component for why green is silent. */}
              <PlatformStatusDot
                status={statusOf(statuses, id)}
                platformName={PLATFORMS[id]?.name ?? id}
                size="sm"
              />
            </span>
          ) : null;
        })}
      </div>
    </div>
  );
}
