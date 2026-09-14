/**
 * Where "back" lands when there is NOTHING BEHIND THIS PAGE IN THIS DOCUMENT.
 *
 * ── 🔴 THE BUG (owner, 2026-09-13) ──────────────────────────────────────────
 * "If I navigate backswipe from the profile menu, the chat pages and some
 * other signed in pages it reloads and goes to a different page. They should
 * all backswipe like the Ai welcome page."
 *
 * The gesture calls `router.back()`. That is instant when the previous
 * history entry belongs to THIS document — the app router restores it from
 * its cache. It is a full document load when the previous entry belongs to a
 * document that no longer exists: after iOS evicted the installed app from
 * memory and reloaded it on return, after a "new version" reload, after a
 * deep link. The browser then re-requests the earlier URL, the server renders
 * it from scratch (a loading bar, a wait), and if that URL redirects — the
 * downloader-mode landing, a `/messages/new/<user>` step, a stale `?tab=` —
 * the member lands somewhere they never chose. The AI welcome page never
 * showed it because `/ai` is static and precached: a cross-document return
 * to it paints from the cache, instantly.
 *
 * So the gesture no longer asks the browser to cross documents. When the
 * page-transition stack says this document has no page behind the current
 * one, "back" becomes a CLIENT navigation to the page that is logically
 * behind it — the inbox behind a chat, the profile behind its followers, the
 * settings hub behind a settings screen, Home behind a top-level page. Same
 * `router.replace` the chat's own BackTarget override uses, so the stack
 * never grows a loop.
 *
 * Pure: a pathname in, a pathname out. Nothing here touches history.
 */
export function fallbackBackHref(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  const [head] = parts;

  if (head === "messages") return "/messages";
  if (head === "u") return parts.length >= 3 ? `/u/${parts[1]}` : "/home";
  if (head === "account") return parts.length >= 2 ? "/account" : "/home";
  if (head === "ai") return parts.length >= 2 ? "/ai" : "/home";
  if (head === "studio") {
    if (parts[1] === "ai") return parts.length >= 3 ? "/studio/ai" : "/studio";
    return parts.length >= 2 ? "/studio" : "/home";
  }
  if (head === "p" || head === "reels" || head === "feed") return "/feed";
  if (head === "downloads" || head === "history" || head === "support") return parts.length >= 2 ? `/${head}` : "/home";
  if (head === "home" || parts.length === 0) return "/home";
  // Anything else: one level up, and Home from the top.
  return parts.length >= 2 ? `/${parts.slice(0, -1).join("/")}` : "/home";
}
