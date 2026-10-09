import { Plus } from "lucide-react";

import { PlatformStatusDot } from "@/components/platform/platform-status-dot";
import { BRAND_ICONS, BRAND_MARKS } from "@/lib/platform-icons";
import { statusOf, type PlatformStatusMap } from "@/lib/platform-status";
import { PLATFORMS, platformLinkPhrase } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import type { PlatformId } from "@/types";

/*
 * ═══════════════════════════════════════════════════════════════════════════
 *  🔴 THIS MODULE MUST NEVER IMPORT A DATA READER. MEASURED, 2026-08-31.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A `SupportedPlatformsLive` wrapper used to live here: an async server
 * component that called `getPlatformStatus()` and rendered the strip with the
 * result. Its doc-comment claimed the file cost the landing's client bundle
 * "not a single byte", because nothing in it says `"use client"`.
 *
 * That reasoning is wrong, and it cost the landing page 60.2 kB gzipped —
 * 22% of a 275 kB ceiling that had 3 kB of headroom.
 *
 * `features/downloads/download-box.tsx` IS `"use client"`, and it imports
 * `SupportedPlatforms` from this file. A bundler pulls in the whole MODULE,
 * not the one export that was named, so the client graph got:
 *
 *     download-box.tsx  ("use client")
 *       -> components/landing/supported-platforms.tsx
 *       -> lib/platform-status-store.ts
 *       -> lib/supabase/admin.ts
 *       -> @supabase/supabase-js          ← 47.2 kB + 13.0 kB gzipped
 *
 * So every visitor downloaded, parsed and evaluated the Supabase client (the
 * SERVICE-ROLE one, no less) before React could hydrate the page and attach the
 * Download button's handler. `SupportedPlatformsLive` had ZERO call sites — it
 * was dead code — so all of that was paid for a component nobody rendered.
 * The service-role KEY was never exposed: it is not a `NEXT_PUBLIC_` var, so
 * Next replaces it with `undefined` in client code (verified against the built
 * chunks). The weight was real; the key leak was not.
 *
 * Every live caller already resolves the status at a proper server boundary and
 * passes it down as the `statuses` prop — `components/landing/hero.tsx`,
 * `app/(app)/downloads/page.tsx`, `app/admin/page.tsx`. That is the pattern; the
 * wrapper was a second way to do the same thing that only a server component
 * could ever have used.
 *
 * ⛔ If a live-data variant is ever wanted back, it goes in its OWN module. A
 * server-only reader and a client-imported component cannot share a file.
 */

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
 * ── No state of its own ──────────────────────────────────────────────────────
 * It holds no state and imports no hooks. Its one caller (`DownloadBox`, a
 * client component) owns the "+" toggle and the tap handler and passes them in,
 * so the markup stays a pure function of its props and adds no module weight.
 *
 * ── Why the list is a constant and not derived ───────────────────────────────
 * `lib/platforms` knows about more platforms than a visitor needs to see in a
 * row of eight badges — the point here is instant recognition, not completeness.
 * The full list lives one tap away on the downloader pages.
 */
export const SUPPORTED_PLATFORMS: PlatformId[] = [
  // The improved reference's order (2026-10-09): two rows of five, the "+"
  // closing the second.
  "tiktok",
  "instagram",
  "twitter",
  "snapchat",
  "facebook",
  "pinterest",
  // youtube swapped for linkedin 2026-08-25 — AdSense "low value content"
  // rejection, twice; the owner's read is a YouTube-branded downloader is
  // the trigger. See config/seoPages.ts's removal note for the full picture.
  "linkedin",
  "telegram",
  // Reddit joins (2026-10-09): a real extractor (lib/platforms) with its own
  // downloader page. The reference's WhatsApp tile is NOT drawn — nothing here
  // downloads from WhatsApp, and a logo is a claim of support.
  "reddit",
];

/**
 * Behind the "+" tile: platforms the extractor also handles (each has its own
 * downloader page) but that do not need a spot in the first two rows. YouTube is
 * deliberately absent here too, for the AdSense reason above.
 */
export const MORE_PLATFORMS: PlatformId[] = ["threads", "vimeo"];

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
  /**
   * Makes every tile a button (Download page refinement, 2026-10-09: "all icons
   * interactive"). Tapping a platform hands its id back — the paste box uses it
   * to focus itself and name the platform in its placeholder. Omitted, the tiles
   * stay plain marks, so a caller without a paste box draws exactly what it did.
   */
  onPick,
  /** Whether the MORE_PLATFORMS row is open. Only meaningful with `onToggleMore`. */
  expanded = false,
  /** Draws the "+" tile, which toggles the MORE_PLATFORMS row. */
  onToggleMore,
}: {
  surface?: "light" | "onGradient";
  className?: string;
  statuses?: PlatformStatusMap;
  onPick?: (id: PlatformId) => void;
  expanded?: boolean;
  onToggleMore?: () => void;
}) {
  const onGradient = surface === "onGradient";
  const ids = onToggleMore && expanded ? [...SUPPORTED_PLATFORMS, ...MORE_PLATFORMS] : SUPPORTED_PLATFORMS;
  /*
    ── ONE TILE, EVERY SIZE THE SAME (Download page refinement, 2026-10-09:
    "consistent size & style, even visual weight") ──────────────────────────
    Five columns, so two rows of five hold nine platforms and the "+" — and each
    tile is a fifth of the width (~47 px on a 320 px phone, capped by the grid's
    max width on a wide card), which is also a comfortable tap target now that
    the tiles can be tapped. Same radius, same hairline ring, same glyph size on
    every tile; the brand colour is the only thing that differs.
  */
  const tileClass = cn(
    // `relative` is what the status light positions against — see PlatformStatusDot.
    "relative flex aspect-square w-full items-center justify-center rounded-[26%] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
    !onGradient && "ring-1 ring-inset ring-slate-200/80 dark:ring-white/10",
  );
  const interactive = "transition-transform duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-reduce:transition-none";
  const glyph = "h-[clamp(17px,5.2vw,22px)] w-[clamp(17px,5.2vw,22px)]";
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
      {/*
        🔴 UPPERCASE, tracked, per `public/newnativeapplandingpage.jpg` (owner,
        2026-08-11: "i want a 100% exact").

        The reference draws this as a section EYEBROW — small caps with wide
        letter-spacing — not as a sentence. That is the native-app idiom the
        whole design is imitating: a quiet uppercase label is read as a heading
        for the row beneath it, while sentence case reads as a statement in its
        own right and competes with the headline above.

        The words are unchanged from the owner's own 2026-08-10 correction
        ("don't use the word work, use platform supported") — only the case and
        tracking follow the new reference.
      */}
      <span
        className={cn(
          "text-[11px] font-bold uppercase tracking-[0.09em]",
          onGradient ? "text-white/75" : "text-slate-500 dark:text-white/55",
        )}
      >
        Supported platforms
      </span>
      <div className="grid w-full max-w-[22rem] grid-cols-5 gap-2.5">
        {ids.map((id) => {
          const Icon = BRAND_ICONS[id];
          const mark = BRAND_MARKS[id];
          const name = PLATFORMS[id]?.name ?? id;
          const Tile = onPick ? "button" : "span";
          return Icon ? (
            <Tile
              key={id}
              {...(onPick
                ? { type: "button" as const, onClick: () => onPick(id), "aria-label": `Paste ${platformLinkPhrase(id)}`, title: name }
                : {})}
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
              className={cn(tileClass, onPick && interactive)}
              style={mark?.bg ? { background: mark.bg } : undefined}
            >
              {/* The glyph tracks the tile down rather than staying 18px and
                  crowding it at the narrow end — clamped so it never becomes a
                  speck on a small phone or bloats on a wide card. */}
              <Icon
                className={glyph}
                style={mark ? { color: mark.fg } : undefined}
              />
              {/* The status light. Renders NOTHING for a healthy platform — a
                  badge appears only for `partial` or `down` (owner, 2026-08-11,
                  after briefly trying it the other way). When it does appear it
                  is tappable and explains itself; see the component. */}
              <PlatformStatusDot
                status={statusOf(statuses, id)}
                platformName={name}
                size="sm"
              />
            </Tile>
          ) : null;
        })}
        {onToggleMore ? (
          <button
            type="button"
            onClick={onToggleMore}
            aria-expanded={expanded}
            aria-label={expanded ? "Show fewer platforms" : "Show more supported platforms"}
            className={cn(tileClass, interactive, "text-slate-400 dark:bg-white/5 dark:text-white/60")}
          >
            <Plus className={cn(glyph, "transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-45")} strokeWidth={1.75} aria-hidden />
          </button>
        ) : null}
      </div>
    </div>
  );
}
