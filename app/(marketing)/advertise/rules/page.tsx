import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AiButtonLink } from "@/features/ai/design/ai-button";
import { ADVERTISING_RULES, ADVERTISING_RULES_VERSION, AUTOMATED_VALIDATION_NOTICE } from "@/lib/ads-platform/rules";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Frenzsave Advertising Rules",
  description: "What every ad on Frenzsave must follow: privacy, no scams or fraud, no malicious links, no misleading advertising, user safety and enforcement.",
  alternates: { canonical: "/advertise/rules" },
};

/** The rules every advertiser agrees to before payment — the same text the application shows (lib/ads-platform/rules.ts). */
export default function AdvertisingRulesPage() {
  const updated = new Date(`${ADVERTISING_RULES_VERSION}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <article className="mx-auto w-full max-w-2xl px-4 pb-24 pt-[calc(var(--frenz-safe-top)+5.5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+7rem)]">
          <h1 className="font-brand text-[2rem] font-bold leading-tight tracking-[-0.04em]">Frenzsave Advertising Rules</h1>
          <p className="mt-2 text-[13px] text-muted-foreground">Last updated {updated}</p>
          <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
            These rules protect the people who see ads on Frenzsave. Every advertiser agrees to them before an ad can be paid for. {AUTOMATED_VALIDATION_NOTICE}
          </p>
          <div className="mt-8 space-y-7">
            {ADVERTISING_RULES.map((r, i) => (
              <section key={r.id} id={r.id} aria-labelledby={`rule-${r.id}`}>
                <h2 id={`rule-${r.id}`} className="text-[1.1rem] font-bold tracking-[-0.02em]">
                  <span className="mr-2 tabular-nums text-indigo-600">{i + 1}.</span>
                  {r.title}
                </h2>
                <p className="mt-2 text-[14.5px] leading-relaxed">{r.intro}</p>
                {r.items.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-[14.5px] leading-relaxed">
                    {r.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
          <div className="mt-10">
            <AiButtonLink tapOnce href="/advertise/create" prefetch={false}>
              Create an Ad
            </AiButtonLink>
          </div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
