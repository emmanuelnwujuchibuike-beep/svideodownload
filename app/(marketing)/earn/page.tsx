import { ArrowRight, Bell, CalendarClock, Eye, Landmark, Link2, Lock, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { aiButtonClass } from "@/features/ai/design/ai-button";
import { subscriptionCharge, usd, withdrawalSplit } from "@/lib/creator/membership/engine";
import { getLandingSettings } from "@/lib/landing/settings";
import { jsonLd } from "@/lib/seo/json-ld";
import { SITE_URL } from "@/lib/site";

/*
  /earn — the public creator-monetization page (owner SEO brief 2026-10-11).

  Static, exactly like /profile: the private post rules (fees, price bounds, minimum
  withdrawal) are read through the service-role settings read at build — no
  cookie, no request data, no per-visit query — and an admin save of those
  settings regenerates every page (`revalidatePath("/", "layout")` in
  app/api/admin/landing). The daily revalidate is the backstop. So the fees on
  this page are always the ones checkout charges, and a visitor costs nothing but
  the static file. No client component of its own: the only JS is the shared header.

  🔴 Truth rule. Frenzsave's real fee model is NOT a single 10 % cut of what a
  subscriber pays. The subscriber pays the creator's price PLUS a purchase fee,
  and a withdrawal fee comes out when the creator withdraws
  (lib/creator/membership/engine.ts). At the default 10 % + 10 %, a 10-dollar
  price costs the subscriber 11 and puts 9 in the creator's bank. So "keep 90 %"
  is said of the PRICE YOU SET, never of "subscription revenue", and the
  subscriber's fee is shown, not hidden. No earnings, counts or testimonials.

  The CTA is a plain <a> to /earn/start (a route handler that knows who is
  signed in), not a <Link>: a client navigation cannot follow a handler's redirect.
*/
export const dynamic = "force-static";
export const revalidate = 86400;

const START = "/earn/start";
const EXAMPLE_PRICES = [300, 500, 1000, 2000];
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

// the share the creator keeps comes from the live withdrawal fee — never a literal (Reality Ledger)
const copy = (keep: number) => ({
  title: `Frenzsave Creator Monetization — Keep ${pct(keep)} of Your Subscription Price`,
  description: `Get paid for your content on Frenzsave. Set a monthly price, post subscriber-only photos and videos, and keep ${pct(keep)} of your price when you withdraw. See exactly how the fees work.`,
});

export async function generateMetadata(): Promise<Metadata> {
  const { title, description } = copy(100 - (await getLandingSettings()).frenzRewards.sub.withdrawalFeePercent);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/earn" },
    robots: { index: true, follow: true },
    openGraph: { type: "website", url: `${SITE_URL}/earn`, siteName: "Frenzsave", title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EarnPage() {
  const sub = (await getLandingSettings()).frenzRewards.sub;
  const buyFee = sub.purchaseFeePercent;
  const outFee = sub.withdrawalFeePercent;
  const keep = 100 - outFee;
  const ten = { charge: subscriptionCharge(1000, buyFee), out: withdrawalSplit(1000, outFee) };
  const examples = EXAMPLE_PRICES.map((p) => ({ price: p, pays: subscriptionCharge(p, buyFee).totalCents, keeps: withdrawalSplit(p, outFee).netCents }));

  const FAQ: { q: string; a: string }[] = [
    {
      q: "How can I earn money from my content on Frenzsave?",
      a: `Turn on Private Posts, Frenzsave's paid subscriptions. You set a monthly price, post photos and videos that only your paying subscribers can open, and share your subscribe link with your followers. Each payment gives a subscriber ${sub.periodDays} days of access, and the money goes into your private post balance, which you withdraw to your bank.`,
    },
    {
      q: "How do Frenzsave paid subscriptions work?",
      a: `A follower opens your profile, taps Subscribe and pays your price plus a ${pct(buyFee)} service fee through Paystack's secure checkout. Once Paystack confirms the payment, they can open your subscriber-only posts for ${sub.periodDays} days. To keep access after that, they pay again. Automatic renewal is planned but not available yet.`,
    },
    {
      q: "What does Frenzsave charge?",
      a: `Two fees, each charged once. Your subscriber pays a ${pct(buyFee)} service fee on top of your price, so the full price you set goes into your private post balance. When you withdraw, a ${pct(outFee)} withdrawal fee is taken from the amount you withdraw. In total you keep ${pct(keep)} of the price you set. Refunds and payment disputes can reverse earnings.`,
    },
    {
      q: "How much do I receive from a $10 subscription?",
      a: `If your price is $10.00, your subscriber pays ${usd(ten.charge.totalCents)} (${usd(ten.charge.feeCents)} of that is the service fee) and ${usd(1000)} goes into your private post balance. When you withdraw it, the ${pct(outFee)} withdrawal fee is ${usd(ten.out.feeCents)}, and ${usd(ten.out.netCents)} is paid to your bank. This is an illustration of the fee arithmetic, not a promise of earnings.`,
    },
    {
      q: "Can I publish exclusive posts just for subscribers?",
      a: "Yes. Private posts are photos and videos stored privately and kept apart from your public posts. They never appear in the feed, search or reels, have no public link, and can't be reposted or shared. A subscriber's access is checked by the server every time a post is opened, and the media links expire after a few minutes. Anyone who isn't subscribed sees only the cover you choose, if any.",
    },
    {
      q: "Can subscribers screenshot my private posts?",
      a: "No website or app can fully stop screenshots or screen recording on every device. Frenzsave makes it harder: posts are covered when the app is in the background, saving and downloading are switched off, and a light watermark shows the viewer's @handle. On computers, a screenshot taken with a keyboard shortcut is reported to you. Phones don't report screenshots to web apps, so those are not detected.",
    },
    {
      q: "Do I need an account to set up subscriptions?",
      a: "You need a free Frenzsave account to set a price, publish private posts and receive payouts. You can read everything on this page without one. When you tap Start Earning, you sign in or create an account and land straight on your setup.",
    },
    {
      q: "How do I get paid?",
      a: `Save a bank account once and withdraw from your private post balance. In Nigeria, payouts go straight to your bank through Paystack, and you can turn on automatic withdrawal so new earnings are sent as they arrive. Outside Nigeria, withdraw to a bank account (with its SWIFT code) or PayPal, and our team sends it after a quick review. The minimum withdrawal is ${usd(sub.minWithdrawalCents)}.`,
    },
    {
      q: "Are subscription earnings guaranteed?",
      a: "No. What you earn depends on how many people choose to subscribe and keep paying. The examples on this page show how the fees work out on a given price. They are not a forecast of what you will earn.",
    },
    {
      q: "How is Frenzsave different from other creator subscription platforms?",
      a: "Many creators compare platforms such as Patreon or OnlyFans. Their fees and rules change, so we don't publish comparisons of other services. What Frenzsave charges is stated in full on this page. Your private posts page also sits inside a social app your followers already use, alongside your public posts, reels and chat. All content must follow Frenzsave's terms.",
    },
  ];

  const features = [
    { icon: Lock, title: "Subscriber-only posts", body: "Photos and videos kept in private storage and opened only by paying subscribers." },
    { icon: Wallet, title: "Your own monthly price", body: `Choose any price from ${usd(sub.minPriceCents)} to ${usd(sub.maxPriceCents)}. Each payment gives ${sub.periodDays} days of access.` },
    { icon: Link2, title: "A link to share", body: "Your subscribe link opens your private posts page on your profile. Share it anywhere you have followers." },
    { icon: Bell, title: "New-subscriber alerts", body: "A notification and an email each time someone subscribes or joins your community." },
    { icon: Landmark, title: "Withdraw to your bank", body: "Paid out through Paystack to a saved account, with optional automatic withdrawal." },
    { icon: Eye, title: "Deterrents against copying", body: "No saving or downloading, a cover when the app is hidden, and a watermark with the viewer's @handle." },
  ];

  const steps = [
    { title: "Create an account or sign in", body: "Free, with the Frenzsave account you already have or a new one." },
    { title: "Open your private post setup", body: "Start Earning takes you straight to it on your profile." },
    { title: "Set your monthly price", body: "Your subscribers see your price plus the service fee before they pay." },
    { title: "Post subscriber-only content", body: "Add photos and videos to PRIVATE POSTS. Only paying subscribers can open them." },
    { title: "Get paid", body: "Share your link. Payments land in your private post balance, ready to withdraw." },
  ];

  const structured = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_URL}/earn`,
      url: `${SITE_URL}/earn`,
      name: copy(keep).title,
      description: copy(keep).description,
      isPartOf: { "@type": "WebSite", name: "Frenzsave", url: SITE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Earn", item: `${SITE_URL}/earn` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    },
  ];

  const card = "rounded-[1.4rem] bg-card ring-1 ring-inset ring-black/[0.07] dark:ring-white/10";
  const h2 = "font-brand text-[1.45rem] font-bold leading-tight tracking-[-0.03em] sm:text-[1.7rem]";

  return (
    <>
      <SiteHeader />
      <main className="relative isolate overflow-hidden bg-background">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[34rem] bg-gradient-to-b from-indigo-500/[0.09] via-violet-500/[0.05] to-transparent" />
        <div aria-hidden className="pointer-events-none absolute -right-28 top-16 -z-10 h-80 w-80 rounded-full bg-blue-500/10 blur-3xl" />

        <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-[calc(var(--frenz-safe-top)+5.5rem)] sm:px-6 sm:pt-[calc(var(--frenz-safe-top)+7rem)]">
          {/* ── Hero ── */}
          <p className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-200">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Frenzsave Private Posts · Creator subscriptions
          </p>
          <h1 className="mt-4 font-brand text-[clamp(2.1rem,9vw,3.4rem)] font-extrabold leading-[1.02] tracking-[-0.045em]">
            Earn Money From Your Content With{" "}
            <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-violet-300">Frenzsave</span>
          </h1>
          <p className="mt-4 max-w-xl text-[16.5px] font-medium leading-relaxed text-foreground/80">
            Turn your followers into paying subscribers. Set a monthly price, post photos and videos only they can open, and keep {pct(keep)} of the price you set when you withdraw.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <a href={START} className={aiButtonClass({ size: "lg" })}>
              Start Earning <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <a href="#how-it-works" className={aiButtonClass({ variant: "secondary", size: "lg" })}>
              How It Works
            </a>
          </div>
          <p className="mt-3 text-[13px] leading-snug text-muted-foreground">Free to set up. You only pay fees when you earn.</p>

          {/* ── Commission transparency ── */}
          <section className="mt-14" aria-labelledby="fees">
            <h2 id="fees" className={h2}>
              Your content. Your audience. Your earnings.
            </h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">Here&apos;s exactly what Frenzsave charges.</p>
            <div className={`mt-5 overflow-hidden p-5 sm:p-6 ${card}`}>
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-brand text-[clamp(3rem,14vw,4.25rem)] font-extrabold leading-none tracking-[-0.05em] text-indigo-600 dark:text-indigo-300">{pct(keep)}</p>
                  <p className="mt-1.5 text-[14px] font-semibold">of your price is yours</p>
                </div>
                <div className="text-right">
                  <p className="font-brand text-[2rem] font-bold leading-none tracking-[-0.04em] text-muted-foreground">{pct(outFee)}</p>
                  <p className="mt-1.5 text-[13px] text-muted-foreground">withdrawal fee</p>
                </div>
              </div>
              <div className="mt-5 flex h-3 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10" role="img" aria-label={`${pct(keep)} to the creator, ${pct(outFee)} withdrawal fee`}>
                <span className="h-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600" style={{ width: `${keep}%` }} />
              </div>
              <ul className="mt-5 space-y-2.5 text-[14px] leading-relaxed">
                <li className="flex gap-2.5">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
                  <span>
                    <strong className="font-semibold">Your subscriber pays a {pct(buyFee)} service fee on top of your price.</strong> The full price you set goes into your private post balance.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
                  <span>
                    <strong className="font-semibold">A {pct(outFee)} fee comes out when you withdraw.</strong> That&apos;s all Frenzsave takes from you.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-600" />
                  <span className="text-muted-foreground">Refunds and payment disputes can reverse earnings, and taxes are your responsibility where they apply.</span>
                </li>
              </ul>
            </div>

            <div className={`mt-4 overflow-x-auto ${card}`}>
              <table className="w-full text-left text-[14px]">
                <caption className="px-5 pt-4 text-left text-[13px] font-semibold text-muted-foreground">Illustrative, per subscription. Not a forecast of earnings.</caption>
                <thead>
                  <tr className="border-b border-border/70 text-[12px] uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-5 py-3 font-semibold">Your price</th>
                    <th scope="col" className="px-3 py-3 font-semibold">Subscriber pays</th>
                    <th scope="col" className="px-5 py-3 text-right font-semibold">You keep</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {examples.map((e) => (
                    <tr key={e.price} className="border-b border-border/50 last:border-0">
                      <td className="px-5 py-3 font-semibold">{usd(e.price)}</td>
                      <td className="px-3 py-3 text-muted-foreground">{usd(e.pays)}</td>
                      <td className="px-5 py-3 text-right font-bold text-indigo-700 dark:text-indigo-300">{usd(e.keeps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Features ── */}
          <section className="mt-14" aria-labelledby="features">
            <h2 id="features" className={h2}>
              Everything you need to sell exclusive content
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {features.map(({ icon: Icon, title, body }) => (
                <li key={title} className={`flex gap-3.5 p-4 ${card}`}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-400/20" aria-hidden>
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">{title}</h3>
                    <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ── How it works ── */}
          <section className="mt-14 scroll-mt-24" id="how-it-works" aria-labelledby="how">
            <h2 id="how" className={h2}>
              How it works
            </h2>
            <ol className="mt-5 space-y-3">
              {steps.map((s, i) => (
                <li key={s.title} className={`flex items-start gap-4 p-4 ${card}`}>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 font-brand text-[15px] font-bold text-white" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">{s.title}</h3>
                    <p className="mt-0.5 text-[13.5px] leading-snug text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Nigerian banks are paid instantly through Paystack. Creators in other countries withdraw to a bank account or PayPal, paid by our team after a quick review.
            </p>
          </section>

          {/* ── Privacy ── */}
          <section className="mt-14" aria-labelledby="private">
            <div className={`flex gap-4 p-5 ${card}`}>
              <ShieldCheck className="mt-0.5 h-6 w-6 shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
              <div>
                <h2 id="private" className="text-[16px] font-semibold">
                  Private means private
                </h2>
                <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">
                  Private posts are never in search, the feed or this page, and there is no public link to one. Access is checked by our server each time a post is opened, and media links expire within minutes. No website can stop every screenshot, and we don&apos;t claim to. The FAQ below explains what we do instead.
                </p>
              </div>
            </div>
          </section>

          {/* ── FAQ ── */}
          <section className="mt-14" aria-labelledby="faq">
            <h2 id="faq" className={h2}>
              Questions creators ask
            </h2>
            <div className={`mt-5 divide-y divide-border/70 ${card}`}>
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group px-4 py-3">
                  <summary className="flex min-h-[2.75rem] cursor-pointer list-none items-center justify-between gap-3 text-[14.5px] font-semibold [&::-webkit-details-marker]:hidden">
                    <h3 className="text-[14.5px] font-semibold">{q}</h3>
                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <p className="pb-1 text-[13.5px] leading-relaxed text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
            <p className="mt-4 text-[13.5px]">
              More in the{" "}
              <Link href="/help" prefetch={false} className="font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
                Help Center
              </Link>{" "}
              and our{" "}
              <Link href="/terms" prefetch={false} className="font-semibold text-indigo-700 underline-offset-2 hover:underline dark:text-indigo-300">
                Terms
              </Link>
              .
            </p>
          </section>

          {/* ── Final CTA ── */}
          <div className="mt-14 rounded-[1.75rem] bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 p-6 text-white sm:p-8">
            <p className="font-brand text-[1.5rem] font-bold leading-tight tracking-[-0.03em]">Ready to Monetize Your Content?</p>
            <p className="mt-1.5 text-[14.5px] text-white/85">Use the Frenzsave account you already have, or create one in a minute.</p>
            <a href={START} className={aiButtonClass({ variant: "secondary", className: "mt-5" })}>
              Set Up Your Subscriptions <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
          </div>
        </div>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(structured) }} />
      </main>
      <SiteFooter />
    </>
  );
}
