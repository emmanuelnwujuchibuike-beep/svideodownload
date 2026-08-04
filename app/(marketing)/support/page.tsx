import { ArrowRight, BookOpen, Headset, Mail, MessageSquare } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SiTiktok } from "react-icons/si";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { SupportChat } from "@/features/support/support-chat";
import { localeAlternates } from "@/lib/i18n/alternates";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Support — chat with us, email support and answers",
  description:
    "Get help with FrenzSave. Start a 1:1 chat with our team, email us, or read answers to the most common questions about downloading, accounts and privacy.",
  alternates: { canonical: "/support", ...localeAlternates("/support") },
};

const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || "support@frenzsave.com";

/** The official TikTok account. One constant so the handle and the URL can
 *  never disagree — the label is derived from it, not typed twice. */
const TIKTOK_HANDLE = "frenzsave";
const TIKTOK_URL = `https://www.tiktok.com/@${TIKTOK_HANDLE}`;

/**
 * Support — one page for every way to reach us: a live 1:1 chat with the team,
 * email, and a curated FAQ that links into the full Help Center. The chat is a
 * client island (SupportChat) so the page itself stays static and opens instantly;
 * the FAQ is a native <details> accordion, so it needs no JavaScript at all.
 *
 * Every answer here is a checkable product fact — the same Reality-Ledger bar the
 * rest of the marketing site is held to. Nothing here claims a capability the
 * product doesn't have.
 */
const FAQ: { q: string; a: string }[] = [
  {
    q: "Is FrenzSave free to use?",
    a: "Yes. The downloader is completely free and needs no account — paste a link and save it. A free account adds the social side (your profile, library, friends and messages), and an optional Pro plan removes ads and unlocks higher-quality downloads.",
  },
  {
    q: "Do I need an account to download?",
    a: "No. Downloading works with no sign-up at all. You only need an account for the community features — posting, following people, saving to your library across devices, and this support chat.",
  },
  {
    q: "Do you store the videos I download?",
    a: "The files you download are delivered to your device, not kept on your account. See our Privacy Policy for exactly what we do and don't collect.",
  },
  {
    q: "A link won't download — what should I do?",
    a: "Make sure the post is public (private and age-restricted posts can't be fetched) and that you copied the full share link. If it still fails, send us the exact link in the chat and we'll take a look.",
  },
  {
    q: "How do I remove ads?",
    a: "Upgrade to Pro from the Pricing page. Pro is ad-free across the whole app and adds faster, higher-quality downloads.",
  },
];

export default function SupportPage() {
  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="border-b border-border/60 bg-gradient-to-b from-slate-50 to-indigo-50/50 pb-12 pt-[calc(var(--frenz-safe-top)+7rem)] dark:from-[#050816] dark:to-[#050816] sm:pt-[calc(var(--frenz-safe-top)+8rem)]">
          <div className="container max-w-4xl text-center">
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
              <Headset className="h-3.5 w-3.5" /> Support
            </span>
            <h1 className="text-balance text-4xl font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white sm:text-5xl">
              We&rsquo;re here to help
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
              Chat with our team, drop us an email, or find a quick answer below. Whatever
              you need, we&rsquo;ve got you.
            </p>
          </div>
        </section>

        <div className="container max-w-6xl py-12 sm:py-16">
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Live chat */}
            <div>
              <div className="mb-4 flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-bold tracking-tight">Chat with us</h2>
              </div>
              <SupportChat />
            </div>

            {/* Email + FAQ */}
            <div className="space-y-6">
              {/* Contact options */}
              <div className="grid gap-4 sm:grid-cols-2">
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="group flex flex-col gap-2 rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-lg shadow-blue-500/30 ring-1 ring-inset ring-white/30">
                    <Mail className="h-5 w-5 drop-shadow-sm" />
                  </span>
                  <span className="mt-1 text-sm font-bold">Email support</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    Prefer email? Write to us any time.
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    {SUPPORT_EMAIL} <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </span>
                </a>

                <Link
                  href="/help"
                  className="group flex flex-col gap-2 rounded-3xl border border-border/60 bg-card p-5 shadow-soft transition hover:-translate-y-0.5 hover:shadow-card"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-purple-600 text-white shadow-lg shadow-violet-500/30 ring-1 ring-inset ring-white/30">
                    <BookOpen className="h-5 w-5 drop-shadow-sm" />
                  </span>
                  <span className="mt-1 text-sm font-bold">Help Center</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    Step-by-step guides and troubleshooting.
                  </span>
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
                    Browse articles <ArrowRight className="h-3 w-3 transition group-hover:translate-x-0.5" />
                  </span>
                </Link>
              </div>

              {/* FAQ */}
              <div>
                <h2 className="mb-4 text-lg font-bold tracking-tight">Frequently asked questions</h2>
                <div className="space-y-2.5">
                  {FAQ.map((item) => (
                    <details
                      key={item.q}
                      className="group rounded-2xl border border-border/60 bg-card px-4 py-1 shadow-soft [&_summary::-webkit-details-marker]:hidden"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-semibold">
                        {item.q}
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-90" />
                      </summary>
                      <p className="pb-4 pt-1 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
                    </details>
                  ))}
                </div>
              </div>

              {/* Follow — the official TikTok account (owner). `rel` carries
                  `noopener` because it opens in a new tab, and `nofollow`
                  because an outbound social link shouldn't pass ranking signal. */}
              <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
                <h2 className="text-lg font-bold tracking-tight">Follow Frenz</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tips, new features and downloader tricks on TikTok.
                </p>
                <a
                  href={TIKTOK_URL}
                  target="_blank"
                  rel="nofollow noopener"
                  className="group mt-3.5 inline-flex items-center gap-2.5 rounded-2xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition hover:opacity-90 active:scale-[0.98]"
                >
                  <SiTiktok className="h-4 w-4" />
                  @{TIKTOK_HANDLE}
                  <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
