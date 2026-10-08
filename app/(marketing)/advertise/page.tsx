import { ArrowRight, BadgeCheck, CreditCard, Eye, ImageUp, LayoutGrid, Lock, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AdvertiseFormats } from "@/features/ads-platform/advertise-formats";
import { AdvertisePlacementsPricing } from "@/features/ads-platform/advertise-placements-pricing";
import { AiButtonLink } from "@/features/ai/design/ai-button";
import { AiDisplayTitle } from "@/features/ai/design/ai-surface";
import { AUTOMATED_VALIDATION_NOTICE } from "@/lib/ads-platform/rules";
import { TapOnceLink } from "@/features/ui/tap-once-link";
import { jsonLd } from "@/lib/seo/json-ld";

/*
  Static: the page reads no cookie and no price at build. The live part — the
  formats an admin has opened and their starting prices — is a client island
  reading the catalog once after paint (features/ads-platform/advertise-formats).
*/
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Advertise on Frenzsave — create an ad in minutes",
  description: "Promote your business on Frenzsave. Choose a format and placement, upload your image or video, preview it and go live after payment.",
  alternates: { canonical: "/advertise" },
};

const STEPS = [
  { icon: LayoutGrid, title: "Choose where", body: "Pick a format and where it appears — the top banner, the Feed, Reels, AI pages or downloads." },
  { icon: ImageUp, title: "Upload your ad", body: "An image or a short video. We check it right away and show you a live preview." },
  { icon: CreditCard, title: "See the price, then pay", body: "A clear total before you pay, with no hidden fees." },
  { icon: Zap, title: "Go live", body: AUTOMATED_VALIDATION_NOTICE },
];

const TRUST = [
  { icon: Lock, title: "No data theft", body: "Ads may never ask for passwords, codes or card details." },
  { icon: ShieldCheck, title: "Safe destinations", body: "Every link is checked. Shortened and blocked links are refused." },
  { icon: Eye, title: "Honest ads", body: "No fake buttons, fake urgency or misleading claims." },
];

/**
 * §43 FAQ (owner, 2026-10-08). Answers describe how the platform actually works
 * (Parts 1–3): server-confirmed price, automated validation, refunds through the
 * payment provider, one placement per ad unless the admin allows more.
 */
const AD_FAQ: { q: string; a: string }[] = [
  {
    q: "How quickly does my ad go live?",
    a: "Usually right after payment. Your ad goes live automatically once the payment is confirmed and it passes our automated validation and safety checks. If something needs a closer look, we review it and let you know.",
  },
  {
    q: "How is the price decided?",
    a: "It depends on the format, where the ad appears and how many days it runs. You see the exact total — including any promotion — before you pay, and that is the price you are charged.",
  },
  {
    q: "How do I pay?",
    a: "On a secure checkout page from our payment partner. You can pay by card or bank transfer depending on your country. Nothing is charged until you confirm there.",
  },
  {
    q: "What can't I advertise?",
    a: "Scams and fraud, phishing, anything that asks people for passwords, one-time codes or card details, malicious or deceptive links, misleading claims or fake buttons, and any content prohibited by law or by Frenzsave policy. The Advertising Rules list everything.",
  },
  {
    q: "Do I need a Frenzsave account?",
    a: "Only to upload your ad and pay, so the campaign belongs to you. You can explore formats, places and prices without one.",
  },
  {
    q: "Can I get a refund?",
    a: "If your ad is refused before it starts, or a payment problem occurs, contact support and we will help. Refunds are returned through the payment provider you paid with.",
  },
];

export default function AdvertisePage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-[calc(var(--frenz-safe-top)+5.5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+7rem)]">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
            <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Frenzsave Ads
          </p>
          <AiDisplayTitle
            title="Advertise on"
            highlight="Frenzsave"
            stack
            subtitle="Put your business in front of people downloading, creating and scrolling on Frenzsave. Set up an ad in a few minutes."
            className="mt-4"
          />
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <AiButtonLink tapOnce href="/advertise/create" prefetch={false} size="lg" iconEnd={<ArrowRight className="h-4 w-4" />}>
              Start Advertising
            </AiButtonLink>
            <AiButtonLink tapOnce href="/advertise/rules" prefetch={false} variant="secondary" size="lg">
              Advertising Rules
            </AiButtonLink>
          </div>
          {/*
            §10/§44 (owner, 2026-10-08): say up front when an account comes in, so
            the sign-in is never a surprise. The application keeps every choice in
            the browser and the sign-in returns straight to it (next=/advertise/create).
          */}
          <p className="mt-3 text-[13px] leading-snug text-muted-foreground">
            No account needed to explore formats, places and prices. You&apos;ll sign in with your Frenzsave account when you upload your ad — your choices are kept.
          </p>
          <TapOnceLink href="/advertise/campaigns" className="mt-1 inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">
            My campaigns →
          </TapOnceLink>

          <section className="mt-12" aria-labelledby="how">
            <h2 id="how" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              How it works
            </h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3.5 rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-400/20" aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[15px] font-semibold">
                      <span className="mr-1.5 tabular-nums text-indigo-600">{i + 1}.</span>
                      {title}
                    </p>
                    <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-12" aria-labelledby="formats">
            <h2 id="formats" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              Ad formats and creative requirements
            </h2>
            <p className="mt-1.5 text-[14px] text-muted-foreground">Sizes, limits and prices shown here are always the current ones.</p>
            <div className="mt-4">
              <AdvertiseFormats />
            </div>
          </section>

          {/* §13–§16, §43: placements and pricing — the admin's live configuration, never hard-coded */}
          <div className="mt-12">
            <AdvertisePlacementsPricing />
          </div>

          <section className="mt-12" aria-labelledby="trust">
            <h2 id="trust" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              Safe for the people who see your ad
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
                  <Icon className="h-5 w-5 text-indigo-600" aria-hidden />
                  <p className="mt-2 text-[14.5px] font-semibold">{title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-4 text-[13.5px]">
            Read the full{" "}
            <TapOnceLink href="/advertise/rules" className="font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
              Advertising Rules
            </TapOnceLink>{" "}
            before you apply.
          </p>

          <section className="mt-12" aria-labelledby="faq">
            <h2 id="faq" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              Questions advertisers ask
            </h2>
            <div className="mt-4 divide-y divide-border/70 rounded-[1.4rem] bg-card ring-1 ring-inset ring-black/[0.07] dark:ring-white/10">
              {AD_FAQ.map(({ q, a }) => (
                <details key={q} className="group px-4 py-3">
                  <summary className="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-semibold [&::-webkit-details-marker]:hidden">
                    {q}
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <p className="pb-1 text-[13.5px] leading-relaxed text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{
                __html: jsonLd({
                  "@context": "https://schema.org",
                  "@type": "FAQPage",
                  mainEntity: AD_FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
                }),
              }}
            />
          </section>

          <div className="mt-12 rounded-[1.75rem] bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-600 p-6 text-white">
            <p className="font-brand text-[1.3rem] font-bold tracking-[-0.03em]">Ready when you are</p>
            <p className="mt-1 text-[14px] text-white/85">Use the Frenzsave account you already have — or create one in a minute.</p>
            <AiButtonLink tapOnce href="/advertise/create" prefetch={false} variant="secondary" className="mt-4" iconEnd={<ArrowRight className="h-4 w-4" />}>
              Start Advertising
            </AiButtonLink>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
