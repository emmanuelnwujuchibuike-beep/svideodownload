import {
  ArrowRight,
  AudioLines,
  Bookmark,
  Briefcase,
  Clapperboard,
  Coins,
  Compass,
  Crown,
  Download,
  Film,
  Gift,
  History,
  Image as ImageIcon,
  ImagePlay,
  Images,
  Lock,
  Megaphone,
  MessageCircle,
  Mic,
  Music2,
  Newspaper,
  Share2,
  Target,
  UserPlus,
  Users,
  Video,
  Wallet,
  type LucideIcon,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { EarnItem } from "@/lib/profile-landing/earn";
import { cn } from "@/lib/utils";

/**
 * The signed-out Profile tab (owner brief 2026-10-11, "Premium anonymous profile
 * page"). It replaces the single "Login to personalize" card with a discovery
 * page for what Frenzsave actually does.
 *
 * Rules it keeps:
 *   · Server-rendered, no client JavaScript of its own — every action is a link;
 *     "Explore features" is an in-page anchor. Nothing AI, no realtime, no polling.
 *   · Only what exists: every entry points at a real route, and every reward line
 *     comes from the live admin rules (lib/profile-landing/earn.ts). Wallpaper
 *     uploads by members are not built, so they are said to be not open yet.
 *   · Sign-in is the existing /login (one flow for new and returning members), with
 *     a validated ?next= so the visitor lands where they meant to go. Member-only
 *     links are sent to /login?next= at the edge by the middleware already.
 *   · No made-up numbers: no user counts, no earnings counters, no testimonials.
 */

export interface AnonymousProfileProps {
  earn: EarnItem[];
  cashOut: string;
  sub: { live: boolean; purchaseFeePercent: number; withdrawalFeePercent: number; requireQualification: boolean; autoPayout: boolean };
  wallpapers: { id: string; title: string; thumbUrl: string }[];
}

const SECTION = "scroll-mt-24";
const CARD = "rounded-[24px] border border-black/[0.06] bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-20px_rgba(79,70,229,0.25)] dark:border-white/[0.08] dark:shadow-none";
const PRIMARY = "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-5 text-[14.5px] font-semibold text-white shadow-[0_10px_24px_-12px_rgba(79,70,229,0.8)] transition active:scale-[0.98] motion-reduce:active:scale-100";
const QUIET = "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-full border border-black/[0.08] bg-background px-5 text-[14.5px] font-semibold text-foreground transition hover:bg-black/[0.03] active:scale-[0.98] motion-reduce:active:scale-100 dark:border-white/[0.12] dark:hover:bg-white/[0.05]";
const EYEBROW = "text-[11.5px] font-bold uppercase tracking-[0.14em] text-indigo-600 dark:text-indigo-300";
const H2 = "text-[1.45rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[1.7rem]";
const LEAD = "mt-1.5 text-[14.5px] leading-relaxed text-muted-foreground";

const login = (next: string) => `/login?next=${encodeURIComponent(next)}`;

const AI_TOOLS: { label: string; icon: LucideIcon; href: string }[] = [
  { label: "Text to Video", icon: Video, href: "/ai/text-to-video" },
  { label: "Image to Video", icon: ImagePlay, href: "/ai/image-to-video" },
  { label: "Lip Sync Pro", icon: Clapperboard, href: "/ai/lip-sync" },
  { label: "Text to Audio", icon: AudioLines, href: "/ai/text-to-audio" },
  { label: "Voice Cloning", icon: Mic, href: "/ai/voice-cloning" },
];

const PLATFORMS = ["TikTok", "Instagram", "X (Twitter)", "Facebook", "Pinterest", "Snapchat", "Reddit", "Vimeo", "LinkedIn", "Threads", "Telegram"];

export function AnonymousProfile({ earn, cashOut, sub, wallpapers }: AnonymousProfileProps) {
  return (
    <div className="relative">
      {/* A — welcome */}
      <section aria-labelledby="ap-hero" className="relative overflow-hidden rounded-[28px] border border-black/[0.05] bg-gradient-to-br from-white via-indigo-50/70 to-violet-100/60 px-5 pb-6 pt-7 dark:border-white/[0.08] dark:from-slate-950 dark:via-indigo-950/60 dark:to-violet-950/50 sm:px-8 sm:pb-8 sm:pt-9">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-violet-400/25 blur-3xl dark:bg-violet-500/20" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl dark:bg-blue-500/15" />
        <p className={cn(EYEBROW, "relative")}>Your digital world</p>
        <h1 id="ap-hero" className="relative mt-2 text-[2rem] font-extrabold leading-[1.05] tracking-[-0.045em] sm:text-[2.6rem]">
          More Than Downloads.
          <span className="block bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-indigo-300 dark:to-violet-300">Create. Connect. Earn.</span>
        </h1>
        <p className="relative mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">Discover AI creation tools, exclusive content, wallpapers, social features, and new ways to earn on Frenzsave.</p>
        <div className="relative mt-5 flex flex-wrap gap-2.5">
          <Link prefetch={false} href={login("/home")} className={PRIMARY}>
            Create Your Account <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <a href="#features" className={QUIET}>
            Explore Features
          </a>
        </div>
      </section>

      {/* B — Frenz AI */}
      <section id="features" aria-labelledby="ap-ai" className={cn(SECTION, "mt-6")}>
        <div className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(120%_90%_at_0%_0%,#1e3a8a_0%,#312e81_42%,#4c1d95_100%)] p-5 text-white shadow-[0_24px_48px_-28px_rgba(76,29,149,0.9)] sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_85%_10%,rgba(167,139,250,0.35),transparent_70%)]" />
          <div className="relative flex items-center gap-2.5">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-inset ring-white/20">
              <Wand2 className="h-5 w-5" />
            </span>
            <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-white/70">Frenz AI</p>
          </div>
          <h2 id="ap-ai" className="relative mt-3 text-[1.5rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[1.8rem]">
            Make videos, voices and audio with AI.
          </h2>
          <p className="relative mt-1.5 max-w-xl text-[14.5px] leading-relaxed text-white/80">Turn a description or a photo into a video, give a video natural lip sync, or turn your words into lifelike audio in your own cloned voice.</p>
          <ul className="relative mt-4 flex flex-wrap gap-2" aria-label="Frenz AI tools">
            {AI_TOOLS.map((t) => (
              <li key={t.label}>
                <Link prefetch={false} href={t.href} className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-full bg-white/10 px-3 text-[13px] font-semibold ring-1 ring-inset ring-white/20 transition hover:bg-white/16">
                  <t.icon className="h-4 w-4 text-violet-200" aria-hidden /> {t.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="relative mt-3 text-[12px] text-white/60">Tools, credits and limits depend on your account and plan. Most creations use credits.</p>
          <div className="relative mt-4 flex flex-wrap gap-2.5">
            <Link prefetch={false} href="/ai" className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full bg-white px-5 text-[14.5px] font-bold text-indigo-800 transition active:scale-[0.98] motion-reduce:active:scale-100">
              Explore Frenz AI <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link prefetch={false} href="/ai/text-to-video" className="inline-flex min-h-[2.75rem] items-center gap-2 rounded-full px-4 text-[14.5px] font-semibold text-white/90 ring-1 ring-inset ring-white/30 transition hover:bg-white/10">
              Create with AI
            </Link>
          </div>
        </div>
      </section>

      {/* C — get paid */}
      <section id="creators" aria-labelledby="ap-creators" className={cn(SECTION, "mt-10")}>
        <p className={EYEBROW}>Get paid for your content</p>
        <h2 id="ap-creators" className={cn(H2, "mt-1.5")}>Your Content Can Earn.</h2>
        <p className={LEAD}>Share exclusive content, build your audience, and earn when people subscribe to your content.</p>
        <div className={cn(CARD, "mt-4 p-4 sm:p-5")}>
          <ul className="grid gap-3 sm:grid-cols-3">
            <Benefit icon={Crown} title="Paid subscriptions">
              Set a monthly price and offer exclusive posts to your subscribers.{sub.live ? ` Subscribers pay your price plus a ${sub.purchaseFeePercent}% fee.` : ""}
            </Benefit>
            <Benefit icon={Lock} title="Exclusive content">
              Post subscriber-only photos and videos. Only paying subscribers can open them, and they can&apos;t be shared or linked.
            </Benefit>
            <Benefit icon={Wallet} title="Creator earnings">
              Track your subscription earnings and withdraw to your bank through Paystack{sub.requireQualification ? " once your account is approved" : ""}. A {sub.withdrawalFeePercent}% withdrawal fee applies.
            </Benefit>
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">Earnings depend on your subscribers; nothing is guaranteed. Payouts follow Frenzsave&apos;s payout rules.</p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {/* /earn/start: sign in, then straight onto the creator's own SUB setup (2026-10-11).
                A plain <a>: it is a route handler that redirects, which a client navigation cannot follow. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/earn/start" className={PRIMARY}>
              Become a Creator <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <Link prefetch={false} href="/earn" className={QUIET}>
              Fees and FAQ
            </Link>
          </div>
          <ol id="how-creators" className={cn(SECTION, "mt-4 grid gap-2 border-t border-black/[0.06] pt-4 text-[13.5px] dark:border-white/[0.08] sm:grid-cols-4")}>
            {["Create your account", "Set your subscription price", "Post for subscribers", "Withdraw your earnings"].map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-[12px] font-bold text-white">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* D — earn */}
      {earn.length ? (
        <section id="earn" aria-labelledby="ap-earn" className={cn(SECTION, "mt-10")}>
          <p className={EYEBROW}>Rewards</p>
          <h2 id="ap-earn" className={cn(H2, "mt-1.5")}>Earn More on Frenzsave.</h2>
          <p className={LEAD}>Take part in eligible activities, share your profile, and discover opportunities to earn rewards.</p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {earn.map((e) => (
              <li key={e.id}>
                <Link prefetch={false} href={e.href} className={cn(CARD, "flex h-full items-start gap-3 p-4 transition hover:border-indigo-500/30")}>
                  <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600 dark:text-amber-300">
                    {e.id === "referrals" ? <UserPlus className="h-[18px] w-[18px]" /> : e.id === "ai_video_shared" ? <Share2 className="h-[18px] w-[18px]" /> : e.id === "quests" ? <Target className="h-[18px] w-[18px]" /> : <Gift className="h-[18px] w-[18px]" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold">{e.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{e.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={cn(CARD, "mt-3 p-4")}>
            <p className="text-[13.5px] font-semibold">What each balance is for</p>
            <dl className="mt-2 grid gap-2 text-[13px] sm:grid-cols-3">
              <Kind icon={Coins} term="AI credits">Spend on any Frenz AI tool. Bought credits and rewards both land here.</Kind>
              <Kind icon={Coins} term="Cashable credits">{cashOut}</Kind>
              <Kind icon={Crown} term="Private post earnings">Money your subscribers pay you. Kept apart from AI credits and paid out through Paystack.</Kind>
            </dl>
          </div>
          <Link prefetch={false} href="/rewards" className={cn(QUIET, "mt-4")}>
            Explore Ways to Earn <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      ) : null}

      {/* E — wallpapers */}
      <section id="wallpapers" aria-labelledby="ap-wall" className={cn(SECTION, "mt-10")}>
        <p className={EYEBROW}>Wallpapers</p>
        <h2 id="ap-wall" className={cn(H2, "mt-1.5")}>Wallpapers Worth Keeping.</h2>
        <p className={LEAD}>Browse and save high-quality phone wallpapers, free.</p>
        {wallpapers.length ? (
          <ul className="mt-4 grid grid-cols-4 gap-2" aria-label="Wallpaper previews">
            {wallpapers.map((w) => (
              <li key={w.id} className="aspect-[9/16] overflow-hidden rounded-2xl bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- an existing optimised thumbnail, lazy and sized by its box (no layout shift) */}
                <img src={w.thumbUrl} alt={w.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Link prefetch={false} href="/wallpapers" className={QUIET}>
            <Images className="h-4 w-4" aria-hidden /> Discover Wallpapers
          </Link>
          <span className="inline-flex min-h-[2.25rem] items-center rounded-full bg-black/[0.04] px-3 text-[12.5px] font-medium text-muted-foreground dark:bg-white/[0.06]">Uploading your own wallpapers isn&apos;t open yet</span>
        </div>
      </section>

      {/* F — downloads */}
      <section id="downloads" aria-labelledby="ap-dl" className={cn(SECTION, "mt-10")}>
        <p className={EYEBROW}>Downloader</p>
        <h2 id="ap-dl" className={cn(H2, "mt-1.5")}>Everything You Need to Save.</h2>
        <p className={LEAD}>Paste a link to save videos, photos and audio from the platforms below.</p>
        <div className={cn(CARD, "mt-4 p-4 sm:p-5")}>
          <ul className="grid grid-cols-3 gap-2 text-center text-[12.5px] font-semibold">
            <Capability icon={Film} label="Videos" />
            <Capability icon={ImageIcon} label="Photos" />
            <Capability icon={Music2} label="Audio, where offered" />
          </ul>
          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">Supported platforms</p>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Supported platforms">
            {PLATFORMS.map((p) => (
              <li key={p} className="rounded-full border border-black/[0.06] px-2.5 py-1 text-[12.5px] dark:border-white/[0.1]">
                {p}
              </li>
            ))}
          </ul>
          <Link prefetch={false} href="/" className={cn(PRIMARY, "mt-4")}>
            <Download className="h-4 w-4" aria-hidden /> Open Downloader
          </Link>
        </div>
      </section>

      {/* G — community */}
      <section id="community" aria-labelledby="ap-social" className={cn(SECTION, "mt-10")}>
        <p className={EYEBROW}>Community</p>
        <h2 id="ap-social" className={cn(H2, "mt-1.5")}>Your People. Your Community.</h2>
        <p className={LEAD}>Connect with friends, chat, share public content, and discover what the community is creating.</p>
        <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile icon={Users} title="Find friends" body="Friends, followers and lists" href="/friends" />
          <Tile icon={MessageCircle} title="Chat" body="Private messages" href="/messages" />
          <Tile icon={Clapperboard} title="Reels and posts" body="Public videos and photos" href="/reels" />
          <Tile icon={Compass} title="Explore" body="What people are sharing" href="/explore" />
        </ul>
        <Link prefetch={false} href="/feed" className={cn(QUIET, "mt-4")}>
          Discover the Community <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      {/* H — directory */}
      <section aria-labelledby="ap-dir" className={cn(SECTION, "mt-10")}>
        <h2 id="ap-dir" className="text-[1.1rem] font-bold tracking-[-0.02em]">Everything on Frenzsave</h2>
        <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Entry icon={Wand2} title="AI Studio" href="/ai" />
          <Entry icon={Download} title="Video downloader" href="/" />
          <Entry icon={Images} title="Wallpapers" href="/wallpapers" />
          <Entry icon={Crown} title="Creator subscriptions" href="/members" />
          <Entry icon={Lock} title="Private posts" href="/members" />
          <Entry icon={Gift} title="Rewards and referrals" href="/rewards" />
          <Entry icon={Target} title="Quests" href="/quests" />
          <Entry icon={Users} title="Friends" href="/friends" />
          <Entry icon={MessageCircle} title="Chat" href="/messages" />
          <Entry icon={Newspaper} title="Feed" href="/feed" />
          <Entry icon={History} title="History" href="/history" />
          <Entry icon={Bookmark} title="Saved" href="/saved" />
          <Entry icon={Briefcase} title="Professional network" href="/network" />
          <Entry icon={Megaphone} title="Advertise" href="/advertise" />
        </ul>
      </section>

      {/* I — final */}
      <section aria-labelledby="ap-final" className="mt-10 rounded-[28px] border border-black/[0.05] bg-gradient-to-br from-indigo-50 via-white to-violet-50 px-5 py-7 text-center dark:border-white/[0.08] dark:from-indigo-950/60 dark:via-slate-950 dark:to-violet-950/50 sm:px-8">
        <h2 id="ap-final" className={H2}>Ready to Make More of Frenzsave?</h2>
        <p className={cn(LEAD, "mx-auto max-w-lg")}>Create your account to explore AI tools, save content, connect with friends, and unlock eligible earning opportunities.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Link prefetch={false} href={login("/home")} className={PRIMARY}>
            Create Free Account
          </Link>
          <Link prefetch={false} href={login("/home")} className={QUIET}>
            I Already Have an Account
          </Link>
        </div>
      </section>
    </div>
  );
}

function Benefit({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 sm:flex-col sm:gap-2">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span>
        <span className="block text-[14.5px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{children}</span>
      </span>
    </li>
  );
}

function Kind({ icon: Icon, term, children }: { icon: LucideIcon; term: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl bg-black/[0.025] p-3 dark:bg-white/[0.04]">
      <dt className="flex items-center gap-1.5 font-semibold">
        <Icon className="h-4 w-4 text-indigo-600 dark:text-indigo-300" aria-hidden /> {term}
      </dt>
      <dd className="mt-1 leading-snug text-muted-foreground">{children}</dd>
    </div>
  );
}

function Capability({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <li className="flex flex-col items-center gap-1.5 rounded-2xl bg-black/[0.025] px-2 py-3 dark:bg-white/[0.04]">
      <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden />
      {label}
    </li>
  );
}

function Tile({ icon: Icon, title, body, href }: { icon: LucideIcon; title: string; body: string; href: string }) {
  return (
    <li>
      <Link prefetch={false} href={href} className={cn(CARD, "flex h-full flex-col gap-2 p-3.5 transition hover:border-indigo-500/30")}>
        <Icon className="h-5 w-5 text-indigo-600 dark:text-indigo-300" aria-hidden />
        <span>
          <span className="block text-[14px] font-semibold">{title}</span>
          <span className="block text-[12.5px] leading-snug text-muted-foreground">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function Entry({ icon: Icon, title, href }: { icon: LucideIcon; title: string; href: string }) {
  return (
    <li>
      <Link prefetch={false} href={href} className="flex min-h-[3rem] items-center gap-2.5 rounded-2xl border border-black/[0.06] bg-card px-3 text-[13.5px] font-semibold transition hover:border-indigo-500/30 hover:bg-indigo-500/[0.03] dark:border-white/[0.08]">
        <Icon className="h-[18px] w-[18px] shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </Link>
    </li>
  );
}
