/**
 * Which content area a route is — tiny and dependency-free, because the top
 * banner on every content page needs it before any ad engine is loaded.
 */

import type { AdPageContext } from "./catalog";

/**
 * The content area a pathname belongs to, or null for a page that is none of
 * them (academy, help, settings…). A null page can still show a placement whose
 * scope is `all_pages` — the global top banner — and nothing else.
 */
export function pageForPath(pathname: string | null | undefined, reelsTab?: string | null): AdPageContext | null {
  const p = (pathname ?? "").split("?")[0]!.replace(/\/+$/, "") || "/";
  if (p === "/" || p === "/downloads" || p === "/library") return "download";
  // AI Reels is the Reels deck's AI tab (/reels?tab=ai), not a route of its own
  if (p === "/reels" || p.startsWith("/reels/")) return reelsTab === "ai" ? "ai_reels" : "reels";
  if (p === "/feed" || p.startsWith("/feed/")) return "feed";
  if (p === "/ai" || p.startsWith("/ai/") || p === "/studio/ai" || p.startsWith("/studio/ai/")) return "ai";
  return null;
}
