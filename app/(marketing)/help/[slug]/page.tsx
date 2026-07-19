import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SupportArticleBody, supportArticleJsonLd } from "@/components/support/support-article";
import { HELP_ARTICLES, articleHref, getArticle } from "@/lib/support/articles";
import { centreOf } from "@/lib/support/sections";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL as siteUrl } from "@/lib/site";

export const dynamic = "force-static";

/* Help articles only — a trust article here would be a second canonical URL for
   a page that already has one. See the matching note in trust/[slug]. */
export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article || centreOf(article.section).id !== "help") return {};

  return {
    title: `${article.title} — Frenzsave Help Center`,
    description: article.description,
    alternates: { canonical: articleHref(article) },
  };
}

/** A Help Center article — the help-side view of the shared corpus. */
export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article || centreOf(article.section).id !== "help") notFound();

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
