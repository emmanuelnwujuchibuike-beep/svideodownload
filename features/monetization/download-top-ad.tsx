"use client";

import { usePathname } from "next/navigation";

import { StickyTopAd } from "./sticky-top-ad";

/**
 * Mounts the sticky top ad on the Downloads page ONLY, from the (app) layout.
 *
 * It lives in the layout — not the page — on purpose: the page sits inside the
 * page-transition template, whose transform is a containing block that breaks
 * `position: sticky` while a transition is in flight (the intermittent "the
 * sticky ad scrolls past" the owner reported). The layout is above that template,
 * so the pin is reliable. Rendered as the first child of the content column so it
 * sits directly under the top bar and stays put as the bar slides away on scroll.
 */
export function DownloadTopAd() {
  const pathname = usePathname();
  if (pathname !== "/downloads") return null;
  return <StickyTopAd />;
}
