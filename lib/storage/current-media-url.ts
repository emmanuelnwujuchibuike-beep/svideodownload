/**
 * Old chat media, served from where it lives TODAY (owner, 2026-10-29: "voice notes sent on chat expire after some
 * time, and don't make sound after some months").
 *
 * Nothing deletes a chat file and its link never expires. What changed is the ADDRESS: media was first served from the
 * bucket's `pub-<id>.r2.dev` address and later from the media domain (R2_PUBLIC_BASE_URL). Both name the same bucket
 * with the same keys, but the move rewrote posts, avatars, stories and comments (scripts/backfill-r2.mjs --rehost) —
 * never `message_attachments`. Older voice notes and photos kept the r2.dev address, which Cloudflare rate-limits and
 * which stops answering altogether once it is switched off. So every such link is read as the same key on the
 * current domain. Anything else (Supabase Storage, an outside link) is returned as it is.
 */
const R2_DEV = /^pub-[a-z0-9]+\.r2\.dev$/i;

export function currentMediaUrl<T extends string | null>(url: T, base: string | undefined = process.env.R2_PUBLIC_BASE_URL): T {
  if (!url || !base) return url;
  const to = base.replace(/\/$/, "");
  let u: URL;
  let target: URL;
  try {
    u = new URL(url);
    target = new URL(to);
  } catch {
    return url;
  }
  // only an old r2.dev address, and only when the media domain is something else
  if (!R2_DEV.test(u.host) || R2_DEV.test(target.host)) return url;
  return `${to}${u.pathname}${u.search}` as T;
}
