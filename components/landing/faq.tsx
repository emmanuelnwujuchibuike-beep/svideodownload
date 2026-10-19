import { faqJsonLd } from "@/components/landing/faq-data";
import { jsonLd } from "@/lib/seo/json-ld";

/**
 * The FAQ's structured data stays in the landing document itself, so search engines read it on the
 * first fetch. The questions you see are drawn by the deferred sections (lib/landing/deferred-sections.ts)
 * from this same `FAQS` list, so the two can't drift.
 */
export function FaqJsonLd() {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd) }} />;
}
