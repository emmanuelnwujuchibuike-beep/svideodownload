import { getMonetizationSettings } from "@/lib/monetization/settings";
import { getRecommendedTools } from "@/lib/monetization/tools";

import { AffiliateDisclosure } from "./affiliate-disclosure";

/**
 * Footer "Recommended Tools" area, grouped into columns by category
 * (Hosting / VPN / AI / Domains / …). Fully DB-driven and admin-managed;
 * renders nothing when disabled or empty so the footer never shows blank columns.
 */
export async function FooterTools() {
  const settings = await getMonetizationSettings();
  if (!settings.recommendedTools) return null;

  const tools = await getRecommendedTools("footer", 24);
  if (tools.length === 0) return null;

  // Group by category, preserving order; uncategorised falls under "Tools".
  const groups = new Map<string, typeof tools>();
  for (const t of tools) {
    const key = (t.category || "Tools").trim();
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }

  return (
    <div className="mt-12 border-t border-border/40 pt-10">
      <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
        Recommended tools
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {[...groups.entries()].map(([category, items]) => (
          <div key={category}>
            <h3 className="mb-3 text-sm font-semibold capitalize">{category}</h3>
            <ul className="space-y-2">
              {items.slice(0, 6).map((t) => (
                <li key={t.id}>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="sponsored nofollow noopener"
                    className="text-sm text-muted-foreground transition hover:text-foreground"
                  >
                    {t.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <AffiliateDisclosure className="mt-6 justify-start text-left" />
    </div>
  );
}
