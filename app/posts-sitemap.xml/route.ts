import { postHref } from "@/lib/social/post-url";
import { SITE_URL as siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Individual public posts — kept OUT of app/sitemap.ts deliberately. That file
  is a build-time static function over static config modules (SEO_SLUGS,
  BLOG_SLUGS, …); this is a DB-backed, hourly-revalidating query with a
  completely different caching contract, and mixing the two would change
  sitemap.ts's for everything else it lists too.

  Bounded to the most recent 10,000 published/public posts — same "revisit if
  this passes ~10,000 URLs" honesty sitemap.ts's own top-of-file note already
  applies to the generated downloader pages; a `generateSitemaps` index is the
  documented next step if this corpus ever gets there.
*/
export const revalidate = 3600;

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface Row {
  id: string;
  slug: string | null;
  category: string | null;
  created_at: string;
}

/**
 * Prefers `slug` (migration 0126) so a categorized post's sitemap entry is
 * its true canonical URL rather than a redirect hop through /p/[id]. Falls
 * back to the pre-migration shape instead of failing the whole sitemap —
 * same cascading-select pattern lib/social/posts.ts already uses for other
 * not-yet-applied migrations.
 */
async function loadPosts(): Promise<Row[]> {
  const db = createAdminClient();
  const rich = await db
    .from("posts")
    .select("id, slug, category, created_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(10000);
  if (!rich.error) return (rich.data ?? []) as Row[];

  const fallback = await db
    .from("posts")
    .select("id, created_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .order("created_at", { ascending: false })
    .limit(10000);
  return ((fallback.data ?? []) as { id: string; created_at: string }[]).map((r) => ({
    ...r,
    slug: null,
    category: null,
  }));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(): Promise<Response> {
  let rows: Row[] = [];
  if (hasSupabase) {
    try {
      rows = await loadPosts();
    } catch {
      rows = [];
    }
  }

  const urls = rows
    .map((r) => {
      const loc = escapeXml(`${siteUrl}${postHref(r)}`);
      const lastmod = new Date(r.created_at).toISOString();
      return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq></url>`;
    })
    .join("");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
