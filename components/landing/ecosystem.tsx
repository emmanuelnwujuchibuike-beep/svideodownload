import type { LucideIcon } from "lucide-react";
import { ArrowRight, AudioLines, Clapperboard, Film, Image as ImageIcon, ImagePlay, MessageSquareText, Mic, Users, Wand2 } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AiButtonLink } from "@/features/ai/design/ai-button";
import type { PublicAdSummary } from "@/lib/ads-platform/public-summary";
import { SHOWCASE_TARGETS } from "@/lib/ai/showcase/slides";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE ECOSYSTEM, BY HIERARCHY — Landing + Download brief (owner, 2026-10-08)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * "DOWNLOAD · CREATE · DISCOVER · PROMOTE — through hierarchy rather than
 * clutter." The hero above stays the download (the shared DownloadPageCore);
 * these are the four steps down from it, each smaller than the last:
 *
 *   QuickActions     one compact row — the destinations a visitor came for
 *   FrenzAiSection   PRIMARY: the one large panel below the hero, in the
 *                    Frenz AI language, with AI Reels inside it
 *   DiscoverSection  SECONDARY: Reels · Feed · Wallpapers, three small cards
 *   PromoteSection   BUSINESS: one quiet band — present, never dominant
 *
 * Server components with no client code: links, not engines (§27). Nothing
 * here loads a reel, an ad creative or a video; the AI tools are the live list
 * the showcase already names (`SHOWCASE_TARGETS`), and the advertising facts
 * come from `getPublicAdSummary()` at the page's regeneration — never per
 * visitor.
 */

export const card = "rounded-[1.75rem] bg-card ring-1 ring-inset ring-black/[0.07] shadow-[0_10px_30px_-24px_rgba(30,40,90,0.4)] dark:ring-white/10";

function SectionHead({ eyebrow, title, highlight, sub, id }: { eyebrow: string; title: string; highlight: string; sub?: string; id: string }) {
  return (
    <header>
      <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-indigo-600 dark:text-indigo-300">{eyebrow}</p>
      <h2 id={id} className="mt-2 font-brand text-[1.75rem] font-bold leading-[1.1] tracking-[-0.035em] sm:text-[2.1rem]">
        {title} <span className="text-gradient">{highlight}</span>
      </h2>
      {sub ? <p className="mt-2 max-w-xl text-[14.5px] leading-relaxed text-muted-foreground">{sub}</p> : null}
    </header>
  );
}

/* Quick actions live in ./quick-actions.tsx — rendered inside the shared hero (a client component), so they ship alone. */

/* ─────────────────────────────── Frenz AI ─────────────────────────────── */

const TOOL_ICONS: Partial<Record<keyof typeof SHOWCASE_TARGETS, LucideIcon>> = {
  "text-to-video": Film,
  "image-to-video": ImagePlay,
  "text-to-audio": AudioLines,
  "voice-cloning": Mic,
  "lip-sync": MessageSquareText,
};

/** The live tools, from the list the AI showcase already maintains — never a second copy. */
function aiTools() {
  return (Object.entries(SHOWCASE_TARGETS) as [keyof typeof SHOWCASE_TARGETS, { label: string; path: string }][])
    .filter(([id]) => id in TOOL_ICONS)
    .map(([id, t]) => ({ id, label: t.label, href: `/ai${t.path}`, icon: TOOL_ICONS[id]! }));
}

/**
 * §6–§8. PRIMARY after Download: one panel, the Frenz AI language (white card,
 * one gradient word, one gradient pill), never the downloader's look. AI Reels
 * is its secondary action rather than another section — it is where the
 * made-with-AI work is watched, so it belongs to this story. Every tool chip
 * opens its tool (signed-out visitors meet the sign-in there, not here).
 */
export function FrenzAiSection() {
  return (
    <section aria-labelledby="landing-ai" className="container max-w-5xl px-3 py-10 sm:py-14">
      <div className={cn(card, "relative overflow-hidden p-5 sm:p-8")}>
        {/* the one soft wash, as the AI pages carry it — a static gradient, no blur */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-violet-200/60 via-sky-200/40 to-transparent dark:from-violet-500/15 dark:via-sky-500/10" />
        <div className="relative">
          <SectionHead
            id="landing-ai"
            eyebrow="Frenz AI"
            title="Create more with"
            highlight="AI."
            sub="Turn words into video, bring photos to life, and make voices and audio — right where you save and share."
          />
          <ul className="mt-5 flex flex-wrap gap-2">
            {aiTools().map(({ id, label, href, icon: Icon }) => (
              <li key={id}>
                <Link
                  href={href}
                  prefetch={false}
                  className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[13px] font-semibold text-foreground transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
                >
                  <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <AiButtonLink href="/ai" prefetch={false} size="lg" iconEnd={<ArrowRight className="h-4 w-4" />}>
              Explore Frenz AI
            </AiButtonLink>
            {/* §8 AI Reels: where the made-with-AI work is watched — the secondary action, not another section */}
            <AiButtonLink href="/reels?tab=ai" prefetch={false} variant="secondary" size="lg" icon={<Wand2 className="h-4 w-4" />}>
              Watch AI Reels
            </AiButtonLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── Discover ─────────────────────────────── */

const DISCOVER: { href: string; title: string; body: string; icon: LucideIcon }[] = [
  { href: "/reels", title: "Reels", body: "Short videos, endlessly — swipe, react and share.", icon: Clapperboard },
  { href: "/feed", title: "Feed", body: "Posts, photos and clips from the people you follow.", icon: Users },
  { href: "/wallpapers", title: "Wallpapers", body: "Free HD wallpapers for your phone and desktop.", icon: ImageIcon },
];

/**
 * §22 SECONDARY. Three small cards in one row on a tablet and up, stacked on a
 * phone. `id="products"` keeps the header's "Products" link landing here — it
 * pointed at the section this replaces.
 */
export function DiscoverSection() {
  return (
    <section id="products" aria-labelledby="landing-discover" className="container max-w-5xl scroll-mt-24 px-3 py-6 sm:py-10">
      <SectionHead id="landing-discover" eyebrow="Discover" title="More to watch," highlight="share and explore." />
      <ul className="mt-5 grid gap-3 sm:grid-cols-3">
        {DISCOVER.map(({ href, title, body, icon: Icon }) => (
          <li key={href}>
            <Link href={href} prefetch={false} className={cn(card, "flex h-full items-start gap-3.5 p-4 transition-transform active:scale-[0.99]")}>
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-50 to-sky-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:from-indigo-500/15 dark:to-sky-500/10 dark:text-indigo-300 dark:ring-indigo-400/20" aria-hidden>
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{title}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ─────────────────────────────── Promote ─────────────────────────────── */

/**
 * §9 BUSINESS. Visible to everyone, signed in or not — a quiet band, not a
 * sales banner. Hidden entirely when an admin has advertising switched off
 * (§36); the placements are the admin's enabled ones by their human names
 * (§14), and a promotion appears only while it is live (§16).
 */
export function PromoteSection({ ads }: { ads: PublicAdSummary }) {
  if (!ads.enabled) return null;
  const promo = ads.promotion;
  return (
    <section id="advertise" aria-labelledby="landing-promote" className="container max-w-5xl scroll-mt-24 px-3 py-6 sm:py-10">
      <div className={cn(card, "p-5 sm:p-7")}>
        <SectionHead
          id="landing-promote"
          eyebrow="Promote on Frenzsave"
          title="Reach people across"
          highlight="Frenzsave."
          sub="Put your brand, product or content in front of people as they save, watch and create."
        />
        {ads.placements.length ? (
          // A taste, not the catalogue: the first five, then "and more" — the full list lives on /advertise (§14, §23)
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Where ads appear">
            {ads.placements.slice(0, 5).map((p) => (
              <li key={p} className="rounded-full bg-secondary px-3 py-1 text-[12.5px] font-semibold text-muted-foreground">
                {p}
              </li>
            ))}
            {ads.placements.length > 5 ? <li className="px-1 py-1 text-[12.5px] font-semibold text-muted-foreground">and more</li> : null}
          </ul>
        ) : null}
        {promo ? (
          <p className="mt-3 text-[13px] font-semibold text-emerald-700 dark:text-emerald-300">
            {promo.name}
            {promo.extraDays > 0 ? ` · +${promo.extraDays} bonus ${promo.extraDays === 1 ? "day" : "days"}` : ""}
            {promo.discountPercent > 0 ? ` · ${promo.discountPercent}% off` : ""}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <AiButtonLink href="/advertise" prefetch={false} iconEnd={<ArrowRight className="h-4 w-4" />}>
            Advertise on Frenzsave
          </AiButtonLink>
          <Link href="/advertise/rules" prefetch={false} className="inline-flex min-h-[2.75rem] items-center text-[13.5px] font-semibold text-indigo-700 dark:text-indigo-300">
            Advertising rules
          </Link>
        </div>
      </div>
    </section>
  );
}

/** A thin rule between the ecosystem steps, so the page reads in chapters. */
export function Chapter({ children }: { children: ReactNode }) {
  return <div className="bg-background">{children}</div>;
}
