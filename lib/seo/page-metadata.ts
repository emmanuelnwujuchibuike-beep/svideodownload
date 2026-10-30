import type { Metadata } from "next";

/** The site name every share preview carries. */
export const SITE_NAME = "Frenzsave";

function titleText(title: Metadata["title"]): string | undefined {
  if (!title) return undefined;
  if (typeof title === "string") return title;
  if ("absolute" in title && title.absolute) return title.absolute;
  if ("default" in title && title.default) return title.default;
  return undefined;
}

/**
 * Gives a page its OWN share metadata — og:url, og:title, og:description and the Twitter card — from its own
 * canonical, title and description (owner, 2026-10-29: "/glossary, /topics, /about and others currently point to
 * the homepage").
 *
 * ── Why this is needed at all ────────────────────────────────────────────────
 * Next merges `openGraph` shallowly: a page that sets no `openGraph` inherits the ROOT layout's whole object, so
 * every such page shared the homepage's og:title and og:description. And `alternates.canonical` never becomes
 * og:url by itself. `metadataBase` (app/layout.tsx) turns the relative paths here into absolute URLs.
 *
 * Anything the page sets explicitly in `openGraph` / `twitter` wins; this only fills what is missing. A page with
 * no canonical gets no og:url rather than a wrong one.
 */
export function withSocial(meta: Metadata): Metadata {
  const title = titleText(meta.title);
  const description = meta.description ?? undefined;
  const canonical = meta.alternates?.canonical;
  const url = typeof canonical === "string" || canonical instanceof URL ? canonical : canonical?.url;
  return {
    ...meta,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      ...(url ? { url } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...meta.openGraph,
    },
    twitter: {
      card: "summary_large_image",
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...meta.twitter,
    },
  };
}
