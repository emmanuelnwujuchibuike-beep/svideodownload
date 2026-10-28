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
  BrainCircuit,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { NEU_CHIP, NEU_RAISED, NEU_WELL, PRIMARY_ACTION, SECONDARY_ACTION } from "@/components/landing/landing-classes";
import type { EarnItem } from "@/lib/profile-landing/earn";
import { cn } from "@/lib/utils";

/**
 * The signed-out Profile tab (owner brief 2026-10-11, "Premium anonymous profile
 * page"). It replaces the single "Login to personalize" card with a discovery
 * page for what Frenzsave actually does.
 *
 * Rules it keeps:
 *   · Server-rendered, no client JavaScript of its own — every action is a link.
 *     Nothing AI, no realtime, no polling.
 *   · Only what exists: every entry points at a real route, and every reward line
 *     comes from the live admin rules (lib/profile-landing/earn.ts). Wallpaper
 *     uploads by members are not built, so they are said to be not open yet.
 *   · Sign-in is the existing /login (one flow for new and returning members), with
 *     a validated ?next= so the visitor lands where they meant to go. Member-only
 *     links are sent to /login?next= at the edge by the middleware already.
 *   · No made-up numbers: no user counts, no earnings counters, no testimonials.
 *
 * Look (owner, 2026-10-28: "restructure the anonymous profile page to look more like the landing page … more black and
 * white, less purple and blue, only where needed … must not look like it was built with AI"): the landing's skin from
 * components/landing/landing-classes.ts — ink buttons, raised cards with inset wells, Sora headings. Sentence-case
 * headings, no eyebrows, no gradient text, no glow blobs. The one dark band is Frenz AI, like the landing's app band.
 */

export interface AnonymousProfileProps {
  earn: EarnItem[];
  cashOut: string;
  sub: { live: boolean; purchaseFeePercent: number; withdrawalFeePercent: number; requireQualification: boolean; autoPayout: boolean };
  wallpapers: { id: string; title: string; thumbUrl: string }[];
}

const SECTION = "scroll-mt-24";
const CARD = `rounded-[28px] ${NEU_RAISED}`;
const H2 = "font-heading text-[20px] font-extrabold leading-[1.15] tracking-[-0.02em] sm:text-[24px]";
const LEAD = "mt-1.5 text-[15px] leading-relaxed text-frenz-muted";
const ICON = `flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] text-frenz-ink ${NEU_CHIP}`;

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
    <div className="frenz-ui relative text-frenz-ink">
      {/* A — welcome: plain page, ink type, one ink button */}
      <section aria-labelledby="ap-hero" className="px-1 pt-2">
        <h1 id="ap-hero" className="font-heading text-[30px] font-extrabold leading-[1.08] tracking-[-0.03em] sm:text-[40px]">
          Download, create, chat and earn, in one app.
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-frenz-muted">
          Save videos from {PLATFORMS.length} platforms, make videos and voices with Frenz AI, keep up with friends, and get paid for what you post.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link prefetch={false} href={login("/home")} className={PRIMARY_ACTION}>
            Create your account <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <Link prefetch={false} href={login("/home")} className={SECONDARY_ACTION}>
            Sign in
          </Link>
        </div>
      </section>

      {/* B — downloads: the thing most visitors came for, first */}
      <section id="downloads" aria-labelledby="ap-dl" className={cn(SECTION, "mt-8")}>
        <div className={cn(CARD, "p-[22px] sm:p-8")}>
          <h2 id="ap-dl" className={H2}>Save anything you can link to</h2>
          <p className={LEAD}>Paste a link to save the video, photos or audio. No account needed.</p>
          <ul className="mt-4 grid grid-cols-3 gap-2.5 text-center text-[13px] font-semibold">
            <Capability icon={Film} label="Videos" />
            <Capability icon={ImageIcon} label="Photos" />
            <Capability icon={Music2} label="Audio, where offered" />
          </ul>
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Supported platforms">
            {PLATFORMS.map((p) => (
              <li key={p} className={cn("rounded-full px-3 py-1.5 text-[12.5px] font-semibold", NEU_WELL)}>
                {p}
              </li>
            ))}
          </ul>
          <Link prefetch={false} href="/" className={cn(PRIMARY_ACTION, "mt-5")}>
            <Download className="h-4 w-4" aria-hidden /> Open the downloader
          </Link>
        </div>
      </section>

      {/* C — Frenz AI: the one dark band */}
      <section id="features" aria-labelledby="ap-ai" className={cn(SECTION, "mt-6")}>
        <div className="relative overflow-hidden rounded-[28px] bg-[#12111A] p-[22px] text-white shadow-[0_24px_48px_-24px_rgba(18,17,26,.55),inset_0_1px_0_rgba(255,255,255,.08)] sm:p-8">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="flex h-[42px] w-[42px] items-center justify-center rounded-[13px] bg-white/10 ring-1 ring-inset ring-white/15">
              <BrainCircuit className="h-5 w-5" />
            </span>
            <h2 id="ap-ai" className="font-heading text-[20px] font-extrabold tracking-[-0.02em] sm:text-[24px]">Frenz AI</h2>
          </div>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/75">
            Turn a description or a photo into a video, give a video natural lip sync, or turn your words into audio in your own cloned voice.
          </p>
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Frenz AI tools">
            {AI_TOOLS.map((t) => (
              <li key={t.label}>
                <Link prefetch={false} href={t.href} className="inline-flex min-h-[2.5rem] items-center gap-1.5 rounded-full bg-white/[0.08] px-3.5 text-[13px] font-semibold ring-1 ring-inset ring-white/15 transition hover:bg-white/[0.14]">
                  <t.icon className="h-4 w-4 text-white/70" aria-hidden /> {t.label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] text-white/55">Tools, credits and limits depend on your account and plan. Most creations use credits.</p>
          {/* on the dark band the ink button inverts to white */}
          <Link prefetch={false} href="/ai" className={cn(PRIMARY_ACTION, "mt-5 bg-white text-[#12111A] shadow-none dark:bg-white dark:text-[#12111A]")}>
            Explore Frenz AI <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </section>

      {/* D — get paid: the landing's Creator Lounge card */}
      <section id="creators" aria-labelledby="ap-creators" className={cn(SECTION, "mt-6")}>
        <div className={cn(CARD, "p-[22px] sm:p-8")}>
          <h2 id="ap-creators" className={H2}>Made something people love? Get paid for it.</h2>
          <p className={LEAD}>Offer exclusive posts to subscribers and track what you earn.</p>
          <ul className="mt-4 grid gap-2.5">
            <Benefit icon={Crown} title="Paid subscriptions">
              Set a monthly price for your exclusive posts.{sub.live ? ` Subscribers pay your price plus a ${sub.purchaseFeePercent}% fee.` : ""}
            </Benefit>
            <Benefit icon={Lock} title="Exclusive content">
              Subscriber-only photos and videos. Only paying subscribers can open them, and they can&apos;t be shared or linked.
            </Benefit>
            <Benefit icon={Wallet} title="Withdraw to your bank">
              Through Paystack or Flutterwave{sub.requireQualification ? " once your account is approved" : ""}. A {sub.withdrawalFeePercent}% withdrawal fee applies.
            </Benefit>
          </ul>
          <ol id="how-creators" className={cn(SECTION, "mt-5 grid gap-2.5 text-[13.5px] font-semibold sm:grid-cols-4")}>
            {["Create your account", "Set your price", "Post for subscribers", "Withdraw"].map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-frenz-ink text-[12px] font-bold text-frenz-page">{i + 1}</span>
                {step}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[12.5px] text-frenz-muted">Earnings depend on your subscribers; nothing is guaranteed. Payouts follow Frenzsave&apos;s payout rules.</p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {/* /earn/start: sign in, then straight onto the creator's own SUB setup (2026-10-11).
                A plain <a>: it is a route handler that redirects, which a client navigation cannot follow. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/earn/start" className={PRIMARY_ACTION}>
              Become a creator <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <Link prefetch={false} href="/earn" className={SECONDARY_ACTION}>
              Fees and FAQ
            </Link>
          </div>
        </div>
      </section>

      {/* E — earn */}
      {earn.length ? (
        <section id="earn" aria-labelledby="ap-earn" className={cn(SECTION, "mt-10 px-1")}>
          <h2 id="ap-earn" className={H2}>Ways to earn rewards</h2>
          <p className={LEAD}>Take part in eligible activities and share your profile.</p>
          <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
            {earn.map((e) => (
              <li key={e.id}>
                <Link prefetch={false} href={e.href} className={cn("flex h-full items-start gap-3 rounded-[22px] p-3.5 transition active:scale-[0.99]", NEU_RAISED)}>
                  <span aria-hidden className={ICON}>
                    {e.id === "referrals" ? <UserPlus className="h-5 w-5" /> : e.id === "ai_video_shared" ? <Share2 className="h-5 w-5" /> : e.id === "quests" ? <Target className="h-5 w-5" /> : <Gift className="h-5 w-5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold">{e.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-frenz-muted">{e.body}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <div className={cn("mt-3 rounded-[22px] p-4", NEU_WELL)}>
            <p className="text-[14px] font-bold">What each balance is for</p>
            <dl className="mt-2 grid gap-3 text-[13px] sm:grid-cols-3">
              <Kind icon={Coins} term="AI credits">Spend on any Frenz AI tool. Bought credits and rewards both land here.</Kind>
              <Kind icon={Coins} term="Cashable credits">{cashOut}</Kind>
              <Kind icon={Crown} term="Private post earnings">Money your subscribers pay you. Kept apart from AI credits and paid out through Paystack or Flutterwave.</Kind>
            </dl>
          </div>
          <Link prefetch={false} href="/rewards" className={cn(SECONDARY_ACTION, "mt-4")}>
            All ways to earn <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </section>
      ) : null}

      {/* F — wallpapers: the pictures carry the colour */}
      <section id="wallpapers" aria-labelledby="ap-wall" className={cn(SECTION, "mt-10 px-1")}>
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="ap-wall" className={H2}>Wallpapers</h2>
            <p className={LEAD}>High-quality phone wallpapers, free to save.</p>
          </div>
          <Link prefetch={false} href="/wallpapers" className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[14px] font-bold text-frenz-ink">
            See all <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {wallpapers.length ? (
          <ul className="mt-4 grid grid-cols-4 gap-2" aria-label="Wallpaper previews">
            {wallpapers.map((w) => (
              <li key={w.id} className={cn("aspect-[9/16] overflow-hidden rounded-[18px]", NEU_WELL)}>
                {/* eslint-disable-next-line @next/next/no-img-element -- an existing optimised thumbnail, lazy and sized by its box (no layout shift) */}
                <img src={w.thumbUrl} alt={w.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[12.5px] text-frenz-muted">Uploading your own wallpapers isn&apos;t open yet.</p>
      </section>

      {/* G — community */}
      <section id="community" aria-labelledby="ap-social" className={cn(SECTION, "mt-10 px-1")}>
        <h2 id="ap-social" className={H2}>Your people</h2>
        <p className={LEAD}>Add friends, chat, and see what everyone is posting.</p>
        <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Tile icon={Users} title="Find friends" body="Friends, followers and lists" href="/friends" />
          <Tile icon={MessageCircle} title="Chat" body="Private messages" href="/messages" />
          <Tile icon={Clapperboard} title="Reels and posts" body="Public videos and photos" href="/reels" />
          <Tile icon={Compass} title="Explore" body="What people are sharing" href="/explore" />
        </ul>
      </section>

      {/* H — directory: a plain grouped list */}
      <section aria-labelledby="ap-dir" className={cn(SECTION, "mt-10")}>
        <h2 id="ap-dir" className="px-1 font-heading text-[17px] font-extrabold tracking-[-0.02em]">Everything on Frenzsave</h2>
        <ul className={cn("mt-3 grid grid-cols-2 overflow-hidden rounded-[22px] sm:grid-cols-3", NEU_RAISED)}>
          <Entry icon={BrainCircuit} title="AI Studio" href="/ai" />
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
      <section aria-labelledby="ap-final" className={cn(CARD, "mt-10 px-[22px] py-7 text-center sm:px-8")}>
        <h2 id="ap-final" className={H2}>Your account is free</h2>
        <p className={cn(LEAD, "mx-auto max-w-lg")}>Keep your History on every device, use Frenz AI, chat with friends and unlock eligible rewards.</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Link prefetch={false} href={login("/home")} className={PRIMARY_ACTION}>
            Create your account
          </Link>
          <Link prefetch={false} href={login("/home")} className={SECONDARY_ACTION}>
            Sign in
          </Link>
        </div>
      </section>
    </div>
  );
}

function Benefit({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <li className={cn("flex items-center gap-3 rounded-[18px] p-3", NEU_WELL)}>
      <span aria-hidden className={ICON}>
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-[15px] font-bold">{title}</span>
        <span className="mt-px block text-[13px] leading-snug text-frenz-muted">{children}</span>
      </span>
    </li>
  );
}

function Kind({ icon: Icon, term, children }: { icon: LucideIcon; term: string; children: ReactNode }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 font-bold">
        <Icon className="h-4 w-4 text-frenz-ink" aria-hidden /> {term}
      </dt>
      <dd className="mt-1 leading-snug text-frenz-muted">{children}</dd>
    </div>
  );
}

function Capability({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <li className={cn("flex flex-col items-center gap-1.5 rounded-[18px] px-2 py-3.5", NEU_WELL)}>
      <Icon className="h-5 w-5 text-frenz-ink" aria-hidden />
      {label}
    </li>
  );
}

function Tile({ icon: Icon, title, body, href }: { icon: LucideIcon; title: string; body: string; href: string }) {
  return (
    <li>
      <Link prefetch={false} href={href} className={cn("flex h-full flex-col gap-2.5 rounded-[22px] p-3.5 transition active:scale-[0.99]", NEU_RAISED)}>
        <span aria-hidden className={ICON}>
          <Icon className="h-5 w-5" />
        </span>
        <span>
          <span className="block text-[14.5px] font-bold">{title}</span>
          <span className="block text-[12.5px] leading-snug text-frenz-muted">{body}</span>
        </span>
      </Link>
    </li>
  );
}

function Entry({ icon: Icon, title, href }: { icon: LucideIcon; title: string; href: string }) {
  return (
    <li className="border-b border-r border-frenz-line">
      <Link prefetch={false} href={href} className="flex min-h-[3.25rem] items-center gap-2.5 px-3.5 text-[13.5px] font-semibold transition active:bg-frenz-fill">
        <Icon className="h-[18px] w-[18px] shrink-0 text-frenz-muted" aria-hidden />
        <span className="min-w-0 truncate">{title}</span>
      </Link>
    </li>
  );
}
