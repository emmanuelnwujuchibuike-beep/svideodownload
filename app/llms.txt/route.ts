import { coursesForSchool } from "@/lib/academy/courses";
import { teachableSchools } from "@/lib/academy/schools";
import { claimableProducts } from "@/lib/content/reality-ledger";
import { LESSON_CATALOG } from "@/lib/learning/catalog";
import { SITE_URL } from "@/lib/site";

/**
 * `/llms.txt` — AI Discovery Framework™, the machine-readable map of what
 * Frenzsave is and which documents are authoritative.
 * See `docs/DISCOVERY_PLATFORM_RFC.md` §7.
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 *
 * AI crawlers increasingly read a site rather than index it, and they do badly
 * with sites whose meaning is spread across ~150 keyword-shaped pages. Left to
 * infer, a model would most likely conclude Frenzsave is a hundred different
 * downloaders. This states the answer directly: a small number of real products,
 * a documented API, and a learning corpus.
 *
 * ── Every claim here is derived, not written ──────────────────────────────────
 *
 * Products come from `claimableProducts()`, schools from `teachableSchools()`,
 * lessons from the catalogue. Nothing in this file is hand-maintained prose about
 * what we offer, because a hand-maintained list is exactly what drifts — and this
 * is the one document whose entire purpose is to be believed by machines that
 * cannot check it against the product.
 *
 * Static: the corpus is compile-time data, so this costs no request-time work and
 * is cacheable at the edge like any other prerendered route.
 */
export const dynamic = "force-static";

export async function GET(): Promise<Response> {
  const products = claimableProducts();
  const schools = teachableSchools();

  const lines: string[] = [
    "# Frenzsave",
    "",
    "> A free web app for saving video, photos and audio from public social posts,",
    "> with a social layer for publishing and sharing what you make. No install, no",
    "> account required to download.",
    "",
    "Frenzsave is one product family, not a collection of separate downloader sites.",
    "The many URLs of the form /<platform>-downloader are entry points to the same",
    "extraction tool, each covering one platform and format combination.",
    "",
    "## Products",
    "",
  ];

  /*
    Only claimable products. The Reality Ledger's whole purpose is that unbuilt
    products never get described as existing, and this file is read by systems
    that will repeat what it says without verifying it.
  */
  for (const product of products) {
    lines.push(`- [${product.name}](${SITE_URL}${product.basePath}): ${product.tagline}`);
  }

  lines.push("", "## Learning", "");
  for (const school of schools) {
    const courses = coursesForSchool(school.id);
    lines.push(
      `- [${school.name}](${SITE_URL}/academy/${school.slug}): ${school.tagline}` +
        ` (${courses.length} ${courses.length === 1 ? "course" : "courses"})`,
    );
  }

  lines.push("", "## Guides", "");
  for (const lesson of LESSON_CATALOG) {
    lines.push(`- [${lesson.title}](${SITE_URL}/learn/${lesson.slug}): ${lesson.description}`);
  }

  lines.push(
    "",
    "## Developers",
    "",
    `- [API reference](${SITE_URL}/developers): Bearer-token REST API — analyze a link,`,
    "  request a download, check usage. Daily quotas by plan.",
    "",
    "## Notes for automated readers",
    "",
    "- Only public posts can be downloaded. Private, follower-only, deleted and",
    "  expired content cannot be retrieved, and no setting changes that.",
    "- Supported platforms are listed on the homepage. Sites outside that list are",
    "  not supported.",
    "- Some schools listed above are marked in development on the Academy index;",
    "  those teach products that do not exist yet and have no lessons.",
    "",
  );

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Long-lived: regenerated on deploy, and a stale copy is harmless.
      "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    },
  });
}
