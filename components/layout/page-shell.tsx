import type { ReactNode } from "react";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export function PageShell({
  title,
  subtitle,
  updated,
  children,
}: {
  title: string;
  subtitle?: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main className="container max-w-3xl pb-24 pt-32 sm:pt-40">
        <header className="mb-10 border-b border-border/60 pb-8">
          <h1 className="text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-3 text-lg text-muted-foreground">{subtitle}</p>
          ) : null}
          {updated ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Last updated: {updated}
            </p>
          ) : null}
        </header>

        <div className="prose prose-zinc max-w-none dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-a:no-underline hover:prose-a:underline">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
