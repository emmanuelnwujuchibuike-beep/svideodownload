/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ONE SHARE LINK, EVERY SURFACE (owner brief 2026-10-07 §12)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "Generate one secure Frenzsave attribution link … Do not create separate
 * share logic for every content type." A profile, a post, a reel, an AI reel
 * and an AI video all ask here. For the member's OWN content the answer is
 * their attribution link (`/r/<token>` — POST /api/share-links, ownership
 * checked on the server, the same token every time); for anything else, or if
 * that fails, the plain public URL the caller passes. Cached per page session,
 * so reopening a sheet asks once.
 */
export type ShareKind = "profile" | "post" | "reel" | "ai_video" | "ai_audio" | "app";

const cache = new Map<string, Promise<string | null>>();

export function attributionLink(kind: ShareKind, contentId: string): Promise<string | null> {
  const key = `${kind}:${contentId}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = fetch("/api/share-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentType: kind, contentId }) })
    .then((r) => (r.ok ? (r.json() as Promise<{ url?: string }>) : null))
    .then((j) => (typeof j?.url === "string" ? j.url : null))
    .catch(() => null);
  cache.set(key, p);
  // a failure is not remembered — the next open tries again
  void p.then((u) => {
    if (!u) cache.delete(key);
  });
  return p;
}

/** The sheet title for each kind — the brief's own words. */
export function shareTitle(kind: ShareKind): string {
  return kind === "profile" ? "Share Profile" : kind === "reel" ? "Share Reel" : kind === "ai_video" ? "Share AI Reel" : kind === "ai_audio" ? "Share AI Audio" : kind === "app" ? "Share Frenzsave" : "Share Post";
}

/** Native share sheet where the device has one; otherwise the link is copied. */
export async function shareOrCopy(url: string, title: string): Promise<"shared" | "copied" | "cancelled" | "failed"> {
  try {
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title, url });
      return "shared";
    }
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return "cancelled";
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}
