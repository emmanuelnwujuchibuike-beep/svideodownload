import { ArrowRight, BadgeCheck, CreditCard, Eye, ImageUp, LayoutGrid, Lock, ShieldCheck, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AdvertiseFormats } from "@/features/ads-platform/advertise-formats";
import { AiButtonLink } from "@/features/ai/design/ai-button";
import { AiDisplayTitle } from "@/features/ai/design/ai-surface";
import { AUTOMATED_VALIDATION_NOTICE } from "@/lib/ads-platform/rules";

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

export default function AdvertisePage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background">
        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-[calc(var(--frenz-safe-top)+5.5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+7rem)]">
          <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700">
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
            <AiButtonLink href="/advertise/create" prefetch={false} size="lg" iconEnd={<ArrowRight className="h-4 w-4" />}>
              Create an Ad
            </AiButtonLink>
            <AiButtonLink href="/advertise/rules" prefetch={false} variant="secondary" size="lg">
              Advertising Rules
            </AiButtonLink>
          </div>
          <Link href="/advertise/campaigns" prefetch={false} className="mt-3 inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700">
            My campaigns →
          </Link>

          <section className="mt-12" aria-labelledby="how">
            <h2 id="how" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              How it works
            </h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2">
              {STEPS.map(({ icon: Icon, title, body }, i) => (
                <li key={title} className="flex gap-3.5 rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07]">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100" aria-hidden>
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
              Ad formats
            </h2>
            <p className="mt-1.5 text-[14px] text-muted-foreground">Sizes, limits and prices shown here are always the current ones.</p>
            <div className="mt-4">
              <AdvertiseFormats />
            </div>
          </section>

          <section className="mt-12" aria-labelledby="trust">
            <h2 id="trust" className="font-brand text-[1.35rem] font-bold tracking-[-0.03em]">
              Safe for the people who see your ad
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-3">
              {TRUST.map(({ icon: Icon, title, body }) => (
                <li key={title} className="rounded-[1.4rem] bg-card p-4 ring-1 ring-inset ring-black/[0.07]">
                  <Icon className="h-5 w-5 text-indigo-600" aria-hidden />
                  <p className="mt-2 text-[14.5px] font-semibold">{title}</p>
                  <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{body}</p>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-12 rounded-[1.75rem] bg-gradient-to-br from-indigo-600 via-violet-600 to-blue-600 p-6 text-white">
            <p className="font-brand text-[1.3rem] font-bold tracking-[-0.03em]">Ready when you are</p>
            <p className="mt-1 text-[14px] text-white/85">Use the Frenzsave account you already have.</p>
            <AiButtonLink href="/advertise/create" prefetch={false} variant="secondary" className="mt-4" iconEnd={<ArrowRight className="h-4 w-4" />}>
              Create an Ad
            </AiButtonLink>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
