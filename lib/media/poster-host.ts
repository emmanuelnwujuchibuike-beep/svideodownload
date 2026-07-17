/**
 * Is a poster URL one WE control, or someone else's (expiring) CDN?
 *
 * Source platforms hand back *signed* thumbnail URLs — p16-/p19-common-sign.tiktokcdn-us.com,
 * scontent-*.fbcdn.net. The signature expires and the URL then 403s permanently, so
 * any poster we merely link to is a broken tile on a timer. Anything on our own
 * storage is ours forever.
 *
 * The rule is deliberately "is it on a host we control?" rather than a blocklist of
 * known-bad CDNs: a blocklist is wrong the moment a new platform is added, and the
 * failure is silent and delayed (the tile breaks weeks later, when the signature
 * lapses — long after anyone would connect it to the change).
 */
export function isOwnPoster(
  url: string,
  hosts: { r2PublicBase?: string | null; supabaseHost?: string | null },
): boolean {
  const r2 = hosts.r2PublicBase?.replace(/\/$/, "");
  if (r2 && url.startsWith(r2)) return true;
  if (hosts.supabaseHost) {
    try {
      if (new URL(url).host === hosts.supabaseHost) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** True when a poster should be copied onto our storage. Null/empty → nothing to copy. */
export function needsRehost(
  url: string | null | undefined,
  hosts: { r2PublicBase?: string | null; supabaseHost?: string | null },
): boolean {
  if (!url) return false;
  return !isOwnPoster(url, hosts);
}
