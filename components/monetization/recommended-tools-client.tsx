"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";

import type { Placement, RecommendedTool } from "@/lib/monetization/tools";
import { cn } from "@/lib/utils";

import { AffiliateDisclosure } from "./affiliate-disclosure";

/**
 * Client-side Recommended Tools for surfaces rendered after page load (the live
 * download-result card). Fetches `/api/tools`; renders nothing until/unless
 * tools come back, so it never reserves empty space (no layout shift).
 */
export function RecommendedToolsClient({
  placement,
  title = "Recommended tools",
  className,
}: {
  placement: Placement;
  title?: string;
  className?: string;
}) {
  const [tools, setTools] = useState<RecommendedTool[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/tools?placement=${placement}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((d) => alive && setTools((d.tools ?? []) as RecommendedTool[]))
      .catch(() => alive && setTools([]));
    return () => {
      alive = false;
    };
  }, [placement]);

  if (!tools || tools.length === 0) return null;

  return (
    <section className={cn("mx-auto mt-6 w-full max-w-2xl", className)}>
      <p className="mb-3 text-center text-sm font-medium text-muted-foreground">{title}</p>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {tools.map((t) => (
          <a
            key={t.id}
            href={t.url}
            target="_blank"
            rel="sponsored nofollow noopener"
            className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card p-3 transition hover:border-primary/40 hover:shadow-soft"
          >
            {t.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={t.imageUrl}
                alt=""
                width={36}
                height={36}
                loading="lazy"
                decoding="async"
                className="h-9 w-9 shrink-0 rounded-lg object-cover"
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-cyan-400 text-sm font-bold text-white">
                {t.name.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{t.name}</span>
              {t.description ? (
                <span className="block truncate text-xs text-muted-foreground">{t.description}</span>
              ) : null}
            </span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-primary transition group-hover:translate-x-0.5" />
          </a>
        ))}
      </div>
      <AffiliateDisclosure className="mt-3" />
    </section>
  );
}
