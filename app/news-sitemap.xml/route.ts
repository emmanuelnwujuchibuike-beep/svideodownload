import { postHref } from "@/lib/social/post-url";
import { SITE_URL as siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Google News Sitemap — ONLY `category = 'news'` posts published in the last
  48 hours (Google's own freshness requirement for the News Sitemap; older
  news posts are still fully indexable, just through posts-sitemap.xml/the
  regular index instead — see this file's sibling). A short revalidate
  because freshness is the entire point here, unlike the general sitemap.
*/
export const revalidate = 300;

const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

interface Row {
  id: string;
  slug: string | null;
  title: string;
  created_at: string;
}

async function loadNewsPosts(): Promise<Row[]> {
  const db = createAdminClient();
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const rich = await db
    .from("posts")
    .select("id, slug, title, created_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("category", "news")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!rich.error) return (rich.data ?? []) as Row[];

  const fallback = await db
    .from("posts")
    .select("id, title, created_at")
    .eq("status", "published")
    .eq("visibility", "public")
    .eq("category", "news")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  return ((fallback.data ?? []) as { id: string; title: string; created_at: string }[]).map((r) => ({
    ...r,
    slug: null,
  }));
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(): Promise<Response> {
  let rows: Row[] = [];
  if (hasSupabase) {
    try {
      rows = await loadNewsPosts();
    } catch {
      rows = [];
    }
  }

  const urls = rows
    .map((r) => {
      const loc = escapeXml(`${siteUrl}${postHref({ id: r.id, slug: r.slug, category: "news", created_at: r.created_at })}`);
      return `<url>
  <loc>${loc}</loc>
  <news:news>
    <news:publication>
      <news:name>Frenzsave</news:name>
      <news:language>en</news:language>
    </news:publication>
    <news:publication_date>${new Date(r.created_at).toISOString()}</news:publication_date>
    <news:title>${escapeXml(r.title)}</news:title>
  </news:news>
</url>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${urls}\n</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
