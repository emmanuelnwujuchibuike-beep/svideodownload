import {
  Caveat,
  Comic_Neue,
  Inter,
  Merriweather,
  Playfair_Display,
  Poppins,
  Quicksand,
  Roboto_Mono,
} from "next/font/google";

import type { ChatFontStyle } from "@/lib/social/chat-appearance";

/**
 * The actual typeface for each of the 10 chat font styles — kept in its own
 * file, separate from lib/social/chat-appearance.ts (imported by the API
 * route's zod schema), so a server route validating a PATCH body never pulls
 * in font-loading machinery it has no use for.
 *
 * Only ONE weight per family, latin subset, `display: "swap"` — next/font
 * only actually downloads a family's font file once something on the page
 * renders text with its generated class, so loading 8 extra families here
 * costs nothing for the vast majority of visitors who never open this
 * picker or whose chosen style is "default"/"minimal" (both font-free).
 */
const merriweather = Merriweather({ subsets: ["latin"], weight: "400", display: "swap" });
const playfair = Playfair_Display({ subsets: ["latin"], weight: "500", display: "swap" });
const inter = Inter({ subsets: ["latin"], weight: "400", display: "swap" });
const quicksand = Quicksand({ subsets: ["latin"], weight: "500", display: "swap" });
const poppins = Poppins({ subsets: ["latin"], weight: "600", display: "swap" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], weight: "400", display: "swap" });
const caveat = Caveat({ subsets: ["latin"], weight: "600", display: "swap" });
const comicNeue = Comic_Neue({ subsets: ["latin"], weight: "700", display: "swap" });

/** `default` reuses whatever the app's own body font already is (Plus Jakarta
 *  Sans, set globally in app/layout.tsx) — empty class, zero extra load.
 *  `minimal` is a plain system-font stack via Tailwind's arbitrary-value
 *  syntax — also zero extra load, just a different (still-free) family. */
export const FONT_STYLE_CLASS: Record<ChatFontStyle, string> = {
  default: "",
  classic: merriweather.className,
  elegant: playfair.className,
  modern: inter.className,
  rounded: quicksand.className,
  bold: poppins.className,
  minimal: "font-[ui-sans-serif,system-ui,sans-serif]",
  mono: robotoMono.className,
  handwritten: caveat.className,
  playful: comicNeue.className,
};
