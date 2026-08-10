import type { IconType } from "react-icons";
import { FaLinkedin } from "react-icons/fa";
import {
  SiFacebook,
  SiInstagram,
  SiPinterest,
  SiReddit,
  SiSnapchat,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiVimeo,
  SiX,
  SiYoutube,
} from "react-icons/si";

import type { PlatformId } from "@/types";

/** Real brand logos per platform (shared across hero, flagship, showcase). */
export const BRAND_ICONS: Partial<Record<PlatformId, IconType>> = {
  tiktok: SiTiktok,
  instagram: SiInstagram,
  facebook: SiFacebook,
  twitter: SiX,
  pinterest: SiPinterest,
  reddit: SiReddit,
  vimeo: SiVimeo,
  youtube: SiYoutube,
  threads: SiThreads,
  snapchat: SiSnapchat,
  linkedin: FaLinkedin,
  telegram: SiTelegram,
};

/**
 * How each brand mark is PAINTED (owner, 2026-08-10: "use the way icons are on
 * the button in the design I saved in public" — `public/landingnew.jpg`).
 *
 * The strip rendered every logo in one flat near-black, so seven instantly
 * recognisable brands arrived as seven identical grey glyphs and the row lost
 * the only job it has: letting someone spot their app in half a second. The
 * reference draws them in colour, and that is the whole point of showing logos
 * rather than a list of names.
 *
 * ── Why some carry a `bg` and most do not ────────────────────────────────────
 * A brand's colour is usually its INK (YouTube red, Facebook blue). For two of
 * them it is the SURFACE: Snapchat's identity is a black ghost on yellow, and
 * Instagram's is a white glyph on its warm gradient. Painting those as ink
 * produces the failure this map exists to prevent — Snapchat yellow on a white
 * tile is a contrast ratio of about 1.07, an invisible logo that still passes
 * every build.
 *
 * `platform-icons.test.ts` runs each pair through the WCAG maths from
 * `lib/a11y/contrast.ts` and fails below 3:1, the non-text contrast minimum.
 * A hex typed by eye is exactly the kind of thing that looks fine on the
 * designer's monitor and disappears on someone else's.
 *
 * `bg` is a full CSS background value, so a gradient and a flat colour use the
 * same field.
 */
export interface BrandMark {
  /** Glyph colour. */
  fg: string;
  /** Tile background when the brand's identity is the surface. Defaults to white. */
  bg?: string;
  /** Solid colour the contrast test measures `fg` against (a gradient has no single value). */
  bgTest?: string;
}

export const BRAND_MARKS: Partial<Record<PlatformId, BrandMark>> = {
  tiktok: { fg: "#010101" },
  twitter: { fg: "#000000" },
  snapchat: { fg: "#141414", bg: "#FFFC00", bgTest: "#FFFC00" },
  instagram: {
    fg: "#FFFFFF",
    /*
      Instagram's pink → purple, and deliberately NOT its full five-stop ramp.
      The official gradient opens on #F58529 orange and #FEDA77 yellow, and the
      contrast test rejected it: white ink on that orange is 2.54:1, under the
      3:1 floor for a graphic that carries meaning. The yellow is worse.

      Those two stops cannot hold white ink at 18px, so the mark uses the half
      of Instagram's ramp that can. It is still unmistakably Instagram, and the
      white glyph now sits at about 4.4:1 wherever it lands on the tile.
    */
    bg: "linear-gradient(45deg,#E1306C 0%,#C13584 50%,#833AB4 100%)",
    // Graded against the LIGHTEST stop — the worst case for white ink, and the
    // only honest way to reduce a gradient to one number.
    bgTest: "#E1306C",
  },
  facebook: { fg: "#0866FF" },
  pinterest: { fg: "#E60023" },
  youtube: { fg: "#FF0000" },
  telegram: { fg: "#1E90C8" },
  reddit: { fg: "#D93900" },
  linkedin: { fg: "#0A66C2" },
  threads: { fg: "#000000" },
  vimeo: { fg: "#0D7EC1" },
};

/** The tile a mark sits on when the brand does not bring its own surface. */
export const BRAND_TILE_BG = "#FFFFFF";

/** The hero/flagship featured platforms, in display order. */
export const FLAGSHIP_IDS: PlatformId[] = [
  "tiktok",
  "twitter",
  "snapchat",
  "instagram",
  "facebook",
  "pinterest",
];

/** Short marketing taglines for the flagship cards. */
export const FLAGSHIP_TAGLINES: Partial<Record<PlatformId, string>> = {
  tiktok: "No-watermark HD videos & sounds",
  twitter: "Save X videos & GIFs instantly",
  snapchat: "Download Spotlight clips",
  instagram: "Reels, posts & stories in HD",
  facebook: "Watch videos & Reels in HD",
  pinterest: "Save video pins effortlessly",
};
