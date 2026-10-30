import { SITE_AUTHOR, type SiteAuthor } from "@/config/author";
import { SITE_URL } from "@/lib/site";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Article JSON-LD for a blog post or a /learn guide — author, datePublished and dateModified from real records
 * (owner, 2026-10-29). One builder so the two templates cannot drift apart.
 *
 * `dateModified` falls back to `datePublished` when a page was never edited, which is what Google asks for; an
 * invalid date throws at build time rather than shipping markup that misdescribes the page.
 */
export function articleJsonLd({
  path,
  headline,
  description,
  published,
  updated,
  author = SITE_AUTHOR,
}: {
  /** The page's own path, e.g. "/blog/how-to-…". */
  path: string;
  headline: string;
  description: string;
  published: string;
  updated?: string;
  author?: SiteAuthor;
}) {
  const modified = updated ?? published;
  for (const d of [published, modified]) {
    if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(d))) throw new Error(`articleJsonLd(${path}): "${d}" is not an ISO date`);
  }
  if (modified < published) throw new Error(`articleJsonLd(${path}): dateModified ${modified} is before datePublished ${published}`);

  const url = `${SITE_URL}${path}`;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline,
    description,
    datePublished: published,
    dateModified: modified,
    author: {
      "@type": "Person",
      name: author.name,
      description: author.bio,
      ...(author.avatar ? { image: author.avatar.startsWith("http") ? author.avatar : `${SITE_URL}${author.avatar}` } : {}),
      ...(author.url ? { url: author.url.startsWith("http") ? author.url : `${SITE_URL}${author.url}` } : {}),
    },
    publisher: {
      "@type": "Organization",
      name: "Frenzsave",
      logo: { "@type": "ImageObject", url: `${SITE_URL}/icon.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
  };
}
