import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SupportArticleBody, supportArticleJsonLd } from "@/components/support/support-article";
import { TRUST_ARTICLES, articleHref, getArticle } from "@/lib/support/articles";
import { centreOf } from "@/lib/support/sections";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

/*
  TRUST_ARTICLES, not the whole corpus.

  This used to generate params for every SUPPORT_ARTICLE, which was harmless only
  while every article happened to be a trust article. The moment the Help Center
  corpus landed it would have prerendered each help article at /trust/<slug> as
  well as /help/<slug> — two canonical URLs for one page, which splits ranking and
  is invisible in the UI because both render perfectly.
*/
export function generateStaticParams() {
  return TRUST_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article || centreOf(article.section).id !== "trust") return {};

  return {
    title: `${article.title} — Frenzsave Trust Center`,
    description: article.description,
    alternates: { canonical: articleHref(article) },
  };
}

/**
 * A Trust Center article — the trust-side view of the shared corpus.
 *
 * The body lives in `SupportArticleBody` because the Help Center renders the same
 * shape; see that file for why the summary and the policy link are structural
 * rather than conventional.
 */
export default async function TrustArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);

  /*
    A help article requested under /trust is a 404, not a render. Serving it here
    would recreate the duplicate-canonical problem through the back door, since
    the URL would exist and be linkable even without being prerendered.
  */
  if (!article || centreOf(article.section).id !== "trust") notFound();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(supportArticleJsonLd(article, siteUrl)) }}
      />
      <SiteHeader />
      <main>
        <SupportArticleBody article={article} />
      </main>
      <SiteFooter />
    </>
  );
}
