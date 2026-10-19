import { renderDeferredSections } from "@/lib/landing/deferred-sections";

/**
 * The landing's lower sections as HTML, fetched by `DeferredSection` only when a visitor scrolls near
 * them (owner, 2026-10-19: "below section shouldn't load on landing"). See lib/landing/deferred-sections.ts.
 *
 * Built once at build time and served from the CDN: it reads no request, no cookie and no database, and
 * middleware.ts leaves this path alone (a middleware run would make it uncacheable at the edge). Nothing
 * here costs a function invocation per visitor.
 */
export const dynamic = "force-static";

export function GET() {
  return Response.json(renderDeferredSections());
}
