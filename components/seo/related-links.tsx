import { ArrowUpRight, Home } from "lucide-react";
import Link from "next/link";

import { seoPageId } from "@/lib/content/graph/build";
import { relatedFor } from "@/lib/content/graph/traverse";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { getRelatedPages, type SeoPage } from "@/lib/seo/seo-pages";

/**
 * Graph-derived links from this page into the product surfaces.
 *
 * This is the link class the Experience Graph exists to create. Until Phase 3 the
 * ~148 generated SEO pages linked only to each other — a closed loop with no crawl
 * path into the products they describe. A page about saving TikTok audio had no
 * relation to the "Audio extraction" capability that performs it.
 *
 * `relatedFor` defaults to `realOnly`, so an unbuilt product can never be surfaced
 * here no matter how the traversal reaches it — the Reality Ledger at the link layer.
 *
 * API routes are excluded: `/api/download` proves a capability exists but is not a
 * destination to send a reader to.
 */
function ProductLinks({ slug }: { slug: string }) {
  const nodeId = seoPageId(slug);

  const products = relatedFor(nodeId, { kinds: ["product"], limit: 2 });
  const capabilities = relatedFor(nodeId, { kinds: ["capability"], limit: 4 }).filter(
    ({ node }) => node.href && !node.href.startsWith("/api/"),
  );

  if (products.length === 0) return null;

  return (
    <>
      <h3 className="mb-4 mt-10 text-lg font-semibold">What powers this</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map(({ node }) => (
          <Link
            key={node.id}
            href={node.href ?? "/"}
            className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:border-foreground/20 hover:shadow-card"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{node.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {typeof node.meta?.purpose === "string" ? node.meta.purpose : "Frenzsave"}
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
          </Link>
        ))}
      </div>

      {capabilities.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {capabilities.map(({ node }) => (
            <Link
              key={node.id}
              href={node.href!}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-foreground/20 hover:text-foreground"
            >
              {node.title}
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

function PageCard({ page }: { page: SeoPage }) {
  const platform = PLATFORMS[page.platformId];
  const Icon = BRAND_ICONS[page.platformId];
  return (
    <Link
      href={`/${page.slug}`}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:border-foreground/20 hover:shadow-card"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${platform.accent} text-white`}
      >
        {Icon ? <Icon className="h-4 w-4" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {page.primaryKeyword}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {page.brand}
        </span>
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
    </Link>
  );
}

/** Auto-generated internal links for a landing page (crawl-depth + authority). */
export function RelatedLinks({ slug, brand }: { slug: string; brand: string }) {
  const { sameCluster, crossCluster } = getRelatedPages(slug);

  return (
    <section className="border-t border-border/60 py-16 sm:py-20">
      <div className="container max-w-5xl">
        <h2 className="mb-8 text-2xl font-semibold tracking-[-0.02em] sm:text-3xl">
          More {brand} downloaders
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sameCluster.map((p) => (
            <PageCard key={p.slug} page={p} />
          ))}
        </div>

        {crossCluster.length > 0 ? (
          <>
            <h3 className="mb-4 mt-10 text-lg font-semibold">
              Download from other platforms
            </h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {crossCluster.map((p) => (
                <PageCard key={p.slug} page={p} />
              ))}
              <Link
                href="/"
                className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-soft transition hover:border-foreground/20 hover:shadow-card"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <Home className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    All platforms
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    Home
                  </span>
                </span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:text-foreground" />
              </Link>
            </div>
          </>
        ) : null}

        <ProductLinks slug={slug} />
      </div>
    </section>
  );
}
