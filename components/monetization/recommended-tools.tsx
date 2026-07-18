import { ArrowUpRight } from "lucide-react";

import { getMonetizationSettings } from "@/lib/monetization/settings";
import { getRecommendedTools, type Placement, type RecommendedTool } from "@/lib/monetization/tools";
import { jsonLd } from "@/lib/seo/json-ld";
import { cn } from "@/lib/utils";

import { AffiliateDisclosure } from "./affiliate-disclosure";

/**
 * Server-rendered "Recommended Tools" section, fully managed from the admin
 * dashboard (DB-driven). Renders nothing when the global toggle is off or no
 * tools target this placement — so it never leaves an empty box.
 *
 * UX/SEO: images lazy-load, links are `sponsored nofollow`, an FTC disclosure
 * is shown, and an ItemList JSON-LD describes the list. Fully responsive.
 */
export async function RecommendedTools({
  placement,
  title = "Recommended tools",
  subtitle,
  variant = "grid",
  limit,
  className,
}: {
  placement: Placement;
  title?: string;
  subtitle?: string;
  variant?: "grid" | "sidebar";
  limit?: number;
  className?: string;
}) {
  const settings = await getMonetizationSettings();
  if (!settings.recommendedTools) return null;

  const tools = await getRecommendedTools(placement, limit ?? (variant === "sidebar" ? 5 : 8));
  if (tools.length === 0) return null;

  const ld = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    itemListElement: tools.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      ...(t.description ? { description: t.description } : {}),
    })),
  };

  if (variant === "sidebar") {
    return (
      <aside className={cn("rounded-2xl border border-border/70 bg-card p-4 shadow-soft", className)}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
        <h2 className="mb-3 text-sm font-semibold">{title}</h2>
        <ul className="space-y-2">
          {tools.map((t) => (
            <li key={t.id}>
              <ToolLink tool={t} compact />
            </li>
          ))}
        </ul>
        <AffiliateDisclosure className="mt-3 justify-start text-left" />
      </aside>
    );
  }

  return (
    <section className={cn("w-full", className)}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
      <div className="mb-5 text-center">
        <h2 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => (
          <ToolLink key={t.id} tool={t} />
        ))}
      </div>
      <AffiliateDisclosure className="mt-4" />
    </section>
  );
}

function ToolLink({ tool, compact = false }: { tool: RecommendedTool; compact?: boolean }) {
  return (
    <a
      href={tool.url}
      target="_blank"
      rel="sponsored nofollow noopener"
      className={cn(
        "group flex items-center gap-3 rounded-xl border border-border/70 bg-card transition hover:border-primary/40 hover:shadow-soft",
        compact ? "p-2.5" : "p-3.5",
      )}
    >
      <ToolLogo tool={tool} size={compact ? 32 : 40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("truncate font-semibold", compact ? "text-sm" : "text-sm")}>
            {tool.name}
          </span>
          {tool.category ? (
            <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
              {tool.category}
            </span>
          ) : null}
        </span>
        {!compact && tool.description ? (
          <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
            {tool.description}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-lg font-semibold text-primary transition group-hover:gap-1.5",
          compact ? "text-xs" : "bg-primary/10 px-2.5 py-1.5 text-xs",
        )}
      >
        {compact ? <ArrowUpRight className="h-3.5 w-3.5" /> : <>{tool.cta} <ArrowUpRight className="h-3.5 w-3.5" /></>}
      </span>
    </a>
  );
}

function ToolLogo({ tool, size }: { tool: RecommendedTool; size: number }) {
  if (tool.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={tool.imageUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {tool.name.charAt(0).toUpperCase()}
    </span>
  );
}
