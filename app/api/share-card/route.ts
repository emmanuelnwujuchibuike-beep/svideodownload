import { isAppOnlyPath } from "@/lib/auth/app-only-paths";
import { safeNext } from "@/lib/auth/safe-next";
import { genericShareCard, renderShareCard, signInPathFor, type ShareCard } from "@/lib/seo/share-card";
import { SITE_URL } from "@/lib/site";
import { postCaptionTitle, uncaptionedPostTitle } from "@/lib/social/post-metadata";
import { getPost } from "@/lib/social/posts";
import { getPublicProfile } from "@/lib/social/profile";
import { profilePath } from "@/lib/social/profile-url";
import { getSound } from "@/lib/social/sounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/share-card?path=…&to=… — the link preview of an app-only address (code review, 2026-10-30).
 *
 * Reached through a middleware REWRITE, only for a link-preview fetcher with no session (lib/seo/link-preview-bots.ts)
 * asking for an app-only route. A profile gets the PROFILE card (photo, name, bio); a shared reel — /p/<id> sends a
 * video to /reels?start=<id> — gets its own picture and caption, never the creator's profile; a public sound its cover;
 * any other app-only address the site's card (owner, 2026-10-30: "the content shows only the image and not the profile
 * preview unless it was the Profile link"). The same fields each page's metadata always published, and never the page:
 * no feed, comment or file is read here. `path` is the internal path (/u/chris), `to` the address that was shared
 * (/chris?ref=…); anything that is not an app-only path or a same-site address is ignored.
 *
 * `no-store`: the card answers the shared address itself (the rewrite keeps it), so no cache may ever hand it to a
 * person instead of the sign-in redirect.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("path") ?? "";
  const path = isAppOnlyPath(raw) ? raw : "/";
  const shared = safeNext(params.get("to"), path);
  const card = (await ownCard(path, shared).catch(() => null)) ?? genericShareCard(path, shared);
  return new Response(renderShareCard(card, SITE_URL), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

/** A profile's, a reel's or a public sound's own card; null → the generic one. */
async function ownCard(path: string, shared: string): Promise<ShareCard | null> {
  const [area, id] = path.split("/").filter(Boolean);
  if (path === "/reels") {
    // a video post's own link (/p/<id>, /r/<token>) lands on /reels?start=<id> (lib/social/post-url.ts)
    const start = new URL(shared, SITE_URL).searchParams.get("start");
    if (!start || !UUID.test(start)) return null;
    const post = await getPost(start, null);
    if (!post) return null;
    // the content alone: its caption and its own picture — the creator's name and photo stay on their profile's card
    return {
      title: postCaptionTitle(post) ?? uncaptionedPostTitle(post),
      description: post.description ?? `Watch & save from ${post.platform} on FrenzSave.`,
      url: `/p/${post.id}`,
      image: post.thumbnail_url ?? null,
      type: "video.other",
      signInPath: signInPathFor(shared),
    };
  }
  if (area === "u" && id) {
    const profile = await getPublicProfile(decodeURIComponent(id), null);
    if (!profile) return null;
    // the address as shared when it is this profile's own (/chris?tab=sub — an Exclusive subscribe link keeps its tab)
    const own = profilePath(profile.handle);
    return {
      title: `${profile.displayName} (@${profile.handle})`,
      description: profile.bio ?? `${profile.displayName} on FrenzSave.`,
      url: shared === own || shared.startsWith(`${own}?`) || shared.startsWith(`${own}/`) ? shared : own,
      image: profile.avatarUrl ?? null,
      type: "profile",
      signInPath: signInPathFor(shared),
    };
  }
  if (area === "sound" && id && UUID.test(id)) {
    const sound = await getSound(id, null);
    if (!sound || !sound.isPublic) return null;
    return {
      title: `${sound.title} · ${sound.artistLabel}`,
      description: `Use "${sound.title}" by ${sound.artistLabel} in your own Reel on FrenzSave.`,
      url: `/sound/${sound.id}`,
      image: sound.coverArtUrl ?? null,
      type: "music.song",
      signInPath: signInPathFor(shared),
    };
  }
  return null;
}
