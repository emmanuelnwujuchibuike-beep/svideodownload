"use client";

import {
  ArrowRight,
  AudioLines,
  Captions,
  ChevronRight,
  Clapperboard,
  History,
  ImagePlus,
  Mic,
  MousePointerClick,
  PersonStanding,
  Play,
  ScanFace,
  Shirt,
  Sparkles,
  Type,
  UserRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FrenzAIEnvironment } from "@/features/ai/core/frenz-ai-environment";
import { FrenzAIAllowanceBar } from "@/features/ai/frenz-ai-chrome";
import { FrenzAITierLabel } from "@/features/ai/frenz-ai-tier-label";
import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import { getAiEntitlement, type AiMemberEntitlement } from "@/lib/ai/client";
import {
  readAiEntitlementCache,
  writeAiEntitlementCache,
} from "@/lib/ai/entitlement-cache";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE FRENZ AI WELCOME PAGE — the front door of the studio
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Rebuilt 2026-09-20 from the owner's reference screen ("Create. Transform.
 * Perfect.") as a native-app screen rather than a page about one tool:
 *
 *   AI STUDIO · the headline · one supporting line · a small CSS figure
 *   THE STUDIO CARD · the four capability groups · Explore AI Studio
 *   AI TOOLS · one compact card per door
 *   HOW IT WORKS · three steps
 *   AI CREDITS & USAGE · the balance door, with the plan chip when there is one
 *
 * ── What the page says is what the product does ─────────────────────────────
 *
 * Every card here is a real door. The four replacement scopes open the
 * workspace on that scope (`/create?mode=`); voice replacement, text to speech
 * and lip sync are steps of every creation, so their cards open the studio's
 * entry — the scope page — where the flow begins. Voice CLONING is not offered
 * (lib/ai/voice/tts-provider.ts §6) and there is no text-to-audio tool, so
 * neither is named: a card that leads nowhere is a claim, not a feature.
 * No provider or model is named anywhere on this page (Part 9 §7).
 *
 * ── The performance rule ────────────────────────────────────────────────────
 *
 * Not one photograph. The hero figure is three gradient rectangles and three
 * chips; the only animation is the call to action's ambient light, which is a
 * transform on a wider layer (compositor only, 9 s per pass), paused by the
 * environment's `--ai-play` on a hidden tab and stopped under reduced motion.
 * The one fetch is the entitlement (for `offered` and the plan chip); it paints
 * from its last answer first, so the page never reflows on entry.
 */
const CATEGORIES = [
  {
    id: "character",
    icon: ScanFace,
    tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300",
    title: "Character & Face",
    detail: "Replace a face, a head, the upper body or the whole character — the movement, expressions and scene stay.",
    items: ["Face Only", "Face + Head", "Upper Body", "Full Character"],
  },
  {
    id: "voice",
    icon: Mic,
    tint: "bg-blue-500/[0.10] text-blue-600 dark:text-blue-300",
    title: "Voice",
    detail: "Keep the original sound, use your own recording, or generate speech from text in a chosen voice.",
    items: ["Voice Replace", "Text to Speech"],
  },
  {
    id: "video",
    icon: Clapperboard,
    tint: "bg-fuchsia-500/[0.10] text-fuchsia-600 dark:text-fuchsia-300",
    title: "Video",
    detail: "Match the mouth to a new voice; choose the seconds to keep and the output quality.",
    items: ["Lip Sync", "Trim & Quality"],
  },
  {
    id: "audio",
    icon: AudioLines,
    tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300",
    title: "Audio",
    detail: "The original audio is preserved unless you replace it — with a recording, or the sound of another video.",
    items: ["Original Audio", "Your Recording"],
  },
] as const;

const HOW = [
  { icon: MousePointerClick, title: "Choose a tool", detail: "Select the AI tool you need." },
  { icon: ImagePlus, title: "Add your media", detail: "Upload your video, image, audio or text." },
  { icon: Sparkles, title: "Create & preview", detail: "Generate your result and review it." },
] as const;

interface ToolCard {
  id: string;
  icon: typeof ScanFace;
  tint: string;
  name: string;
  blurb: string;
  href: string;
}

function toolCards(characterReplaceHref: string, historyHref: string): ToolCard[] {
  const create = `${characterReplaceHref}/create`;
  return [
    { id: "face_only", icon: ScanFace, tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300", name: "Face Only", blurb: "Replace the face, keep the performance.", href: `${create}?mode=face_only` },
    { id: "skin_face", icon: UserRound, tint: "bg-purple-500/[0.10] text-purple-600 dark:text-purple-300", name: "Face + Head", blurb: "Replace the face and head appearance.", href: `${create}?mode=skin_face` },
    { id: "upper_body", icon: Shirt, tint: "bg-fuchsia-500/[0.10] text-fuchsia-600 dark:text-fuchsia-300", name: "Upper Body", blurb: "Replace the face, torso and clothing.", href: `${create}?mode=upper_body` },
    { id: "full_character", icon: PersonStanding, tint: "bg-pink-500/[0.10] text-pink-600 dark:text-pink-300", name: "Full Character", blurb: "Transform the complete character.", href: `${create}?mode=full_character` },
    { id: "lip_sync", icon: Captions, tint: "bg-blue-500/[0.10] text-blue-600 dark:text-blue-300", name: "Lip Sync", blurb: "Sync speech with video.", href: characterReplaceHref },
    { id: "voice_replace", icon: Mic, tint: "bg-sky-500/[0.10] text-sky-600 dark:text-sky-300", name: "Voice Replace", blurb: "Use your own recording as the voice.", href: characterReplaceHref },
    { id: "tts", icon: Type, tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300", name: "Text to Speech", blurb: "Turn text into realistic speech.", href: characterReplaceHref },
    { id: "history", icon: History, tint: "bg-amber-500/[0.12] text-amber-600 dark:text-amber-300", name: "Your AI Videos", blurb: "Everything you have created, in one place.", href: historyHref },
  ];
}

export function FrenzAIWelcome({
  characterReplaceHref = "/studio/ai/character-replace",
  historyHref = "/studio/ai/history",
  usageHref = "/studio/ai/usage",
}: {
  characterReplaceHref?: string;
  historyHref?: string;
  usageHref?: string;
}) {
  /*
    Painted from the last answer first (owner, 2026-09-13: "this section
    reloads every time I enter the page or backswipe"). The network still
    replaces it on every mount; the cache puts the plan chip on screen at the
    first frame. See lib/ai/entitlement-cache.ts.
  */
  const [entitlement, setEntitlement] = useState<AiMemberEntitlement | null>(null);

  useEffect(() => {
    let alive = true;
    // In the effect, not the initial state: the prerendered markup has no
    // entitlement, and an initial state that differs from it is a hydration
    // mismatch. The cached paint lands one frame after hydration.
    const cached = readAiEntitlementCache();
    if (cached) setEntitlement((current) => current ?? cached);
    void getAiEntitlement().then((res) => {
      // A refusal is not an error worth showing here: the page is entirely usable without it.
      if (alive && res.ok) {
        const { ok: _ok, ...view } = res;
        const next = view as unknown as AiMemberEntitlement;
        setEntitlement(next);
        writeAiEntitlementCache(next);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Until the entitlement answers the studio is drawn as open: "not available" is a claim about a switch nobody has read yet.
  const available = entitlement ? entitlement.offered : true;
  const tools = toolCards(characterReplaceHref, historyHref);

  return (
    <FrenzAIEnvironment stage="idle" className="relative overflow-hidden rounded-[1.75rem]">
      {/* the room's light — static, well under the text */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(70% 38% at 12% 0%, rgba(124,58,237,0.11) 0%, transparent 62%)," +
            "radial-gradient(56% 36% at 96% 22%, rgba(59,130,246,0.10) 0%, transparent 66%)",
        }}
      />

      <div className="px-4 pb-6 pt-5 sm:px-6 sm:pt-6">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">AI Studio</p>
            <h1 className="mt-1.5 text-[2.1rem] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[2.75rem]">
              Create. Transform. <span className="text-gradient">Perfect.</span>
            </h1>
            <p className="mt-2.5 max-w-[24rem] text-[14.5px] leading-relaxed text-muted-foreground sm:text-[15.5px]">
              Professional AI tools for video, voice and audio creation.
            </p>
          </div>
          <HeroFigure />
        </header>

        {/* ── THE STUDIO CARD ──────────────────────────────────────────────── */}
        <section
          aria-labelledby="ai-studio-title"
          className={cn(
            "relative mt-6 overflow-hidden rounded-[1.75rem] bg-card/95 p-4 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-6",
            "shadow-[0_20px_48px_-30px_rgba(15,23,42,0.35)]",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(55% 45% at 100% 0%, rgba(99,102,241,0.10) 0%, transparent 65%)," +
                "radial-gradient(45% 40% at 0% 100%, rgba(217,70,239,0.07) 0%, transparent 65%)",
            }}
          />

          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[0.95rem] bg-[#131a4a] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_24px_-14px_rgba(19,26,74,0.7)]">
              <FrenzLogo size={24} alt="" />
            </span>
            <div className="min-w-0">
              <h2 id="ai-studio-title" className="text-[17px] font-bold leading-tight tracking-[-0.02em] sm:text-[19px]">
                Frenz AI Studio
              </h2>
              <p className="mt-0.5 text-[12.5px] leading-tight text-muted-foreground sm:text-[13px]">All-in-one AI creation suite</p>
            </div>
            <span className="ml-auto hidden shrink-0 rounded-full border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-[11px] font-semibold text-primary sm:inline-flex">
              Video · Voice · Audio
            </span>
          </div>

          {/* the four groups — what the studio does, readable in a few seconds */}
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:gap-2.5" aria-label="What Frenz AI Studio does">
            {CATEGORIES.map((c) => (
              <li key={c.id} className="rounded-[1.15rem] bg-secondary/55 p-3 ring-1 ring-inset ring-black/[0.035] dark:bg-white/[0.04] dark:ring-white/[0.06]">
                <div className="flex items-center gap-2">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem]", c.tint)}>
                    <c.icon className="h-4 w-4" aria-hidden />
                  </span>
                  <h3 className="text-[12px] font-bold uppercase tracking-[0.07em]">{c.title}</h3>
                </div>
                {/* the capabilities: a dot-marked list that runs inline where there is room and stacks on a phone */}
                <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] font-semibold leading-snug" aria-label={`${c.title} capabilities`}>
                  {c.items.map((item) => (
                    <li key={item} className="flex items-center gap-1.5">
                      <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-primary/70" />
                      {item}
                    </li>
                  ))}
                </ul>
                <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{c.detail}</p>
              </li>
            ))}
          </ul>

          {/* ── EXPLORE AI STUDIO — the one primary action on the page ────── */}
          {available ? (
            <Link
              href={characterReplaceHref}
              className={cn(
                "ai-cta group mt-5 flex min-h-[56px] w-full items-center justify-center gap-2.5 px-7",
                "text-[16.5px] font-semibold tracking-[-0.01em]",
                "transition-transform duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.985]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              )}
            >
              <Sparkles className="h-[18px] w-[18px] opacity-80" aria-hidden />
              Explore AI Studio
              <ArrowRight className="h-[18px] w-[18px] transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
              <LinkPendingStripe />
            </Link>
          ) : (
            <p className="mt-5 rounded-full bg-secondary px-5 py-3.5 text-center text-[13.5px] font-semibold text-muted-foreground">
              Not available right now. Check back soon.
            </p>
          )}
          <p className="mt-3 text-center text-[12px] leading-snug text-muted-foreground">
            Upload media or enter text and the tool creates a new result with AI. Processing time and credits vary by tool.
          </p>
        </section>

        {/* ── AI TOOLS ─────────────────────────────────────────────────────── */}
        <section aria-labelledby="ai-tools-title" className="mt-7">
          <div className="flex items-end justify-between gap-3 px-1">
            <h2 id="ai-tools-title" className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              AI Tools
            </h2>
            <p className="text-[11.5px] text-muted-foreground">Tap a tool to start</p>
          </div>
          <ul className="mt-2.5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
            {tools.map((tool) => (
              <li key={tool.id} className="min-w-0">
                <ToolCardView tool={tool} />
              </li>
            ))}
          </ul>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
        <section aria-labelledby="ai-how-title" className="mt-7">
          <h2 id="ai-how-title" className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            How it works
          </h2>
          <ol className="mt-2.5 grid grid-cols-3 gap-2 sm:gap-2.5">
            {HOW.map((step, i) => (
              <li key={step.title} className="rounded-[1.15rem] bg-card/90 px-3 py-3 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:px-4 sm:py-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">{i + 1}</span>
                  <step.icon className="h-4 w-4 text-primary" aria-hidden />
                </div>
                <p className="mt-2.5 text-[12.5px] font-bold leading-tight tracking-[-0.01em] sm:text-[13.5px]">{step.title}</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground sm:text-[12px]">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ── AI CREDITS & USAGE ───────────────────────────────────────────── */}
        <section aria-labelledby="ai-credits-title" className="mt-7">
          <h2 id="ai-credits-title" className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Your AI balance
          </h2>
          <Link
            href={usageHref}
            className={cn(
              "group mt-2.5 flex items-center gap-3 rounded-[1.25rem] bg-card/95 p-3.5 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-4",
              "shadow-[0_12px_30px_-22px_rgba(15,23,42,0.35)] transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.995]",
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.8rem] bg-primary/[0.09] text-primary">
              <Wallet className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-bold leading-tight tracking-[-0.01em]">AI Credits &amp; Usage</span>
              <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground sm:text-[12px]">
                Each AI tool uses credits based on processing requirements. Check your balance before creating.
              </span>
            </span>
            <FrenzAITierLabel entitlement={entitlement} className="hidden shrink-0 sm:inline-flex" />
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/70 transition group-hover:bg-secondary/80">
              <ChevronRight className="h-4 w-4" aria-hidden />
            </span>
            <LinkPendingStripe />
          </Link>
          {/*
            Kept, explicitly (owner, 2026-09-09: "Do not remove the existing plan
            description and the amount left and used"). The bar draws nothing for a
            balance-funded product and the chip only for a paid plan — so nothing
            here is ever an empty box.
          */}
          <FrenzAIAllowanceBar entitlement={entitlement} className="mt-2.5" />
          <FrenzAITierLabel entitlement={entitlement} variant="row" className="mt-2.5 sm:hidden" />
        </section>
      </div>
    </FrenzAIEnvironment>
  );
}

function ToolCardView({ tool }: { tool: ToolCard }) {
  const { icon: Icon, href, name, blurb, tint } = tool;
  return (
    <Link
      href={href}
      className={cn(
        "group flex h-full min-h-[6.5rem] flex-col rounded-[1.2rem] bg-card/95 p-3 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-3.5",
        "shadow-[0_10px_28px_-22px_rgba(15,23,42,0.4)] transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem]", tint)}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/80 text-foreground/60 transition group-hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <h3 className="mt-2.5 text-[13.5px] font-bold leading-tight tracking-[-0.01em]">{name}</h3>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{blurb}</p>
      <LinkPendingStripe />
    </Link>
  );
}

/*
  The hero figure: three gradient "screens" and three chips, in CSS alone.
  Decorative, hidden from assistive technology, and hidden on the narrowest
  phones where the headline is the hero.
*/
function HeroFigure() {
  return (
    <div aria-hidden className="relative hidden h-[9.75rem] w-[8.5rem] shrink-0 min-[380px]:block sm:h-[12rem] sm:w-[11.5rem]">
      <span
        className="absolute left-0 top-5 h-[6.25rem] w-[3.5rem] -rotate-[9deg] rounded-[0.9rem] ring-1 ring-inset ring-black/[0.06] dark:opacity-80 dark:ring-white/10 sm:h-[7.5rem] sm:w-[4.25rem]"
        style={{ background: "linear-gradient(165deg, #e0e7ff 0%, #c7d2fe 100%)" }}
      />
      <span
        className="absolute right-0 top-5 h-[6.25rem] w-[3.5rem] rotate-[9deg] rounded-[0.9rem] ring-1 ring-inset ring-black/[0.06] dark:opacity-80 dark:ring-white/10 sm:h-[7.5rem] sm:w-[4.25rem]"
        style={{ background: "linear-gradient(165deg, #f5e8ff 0%, #e9d5ff 100%)" }}
      />
      <span
        className="absolute left-1/2 top-0 h-[8.25rem] w-[4.6rem] -translate-x-1/2 overflow-hidden rounded-[1.1rem] shadow-[0_18px_36px_-18px_rgba(30,27,75,0.7)] ring-1 ring-inset ring-white/30 sm:h-[10rem] sm:w-[5.6rem]"
        style={{ background: "linear-gradient(160deg, #0b0f1a 0%, #1e1b4b 55%, #4c1d95 100%)" }}
      >
        <span
          className="absolute left-1/2 top-[18%] h-10 w-8 -translate-x-1/2 rounded-full"
          style={{ background: "radial-gradient(50% 45% at 50% 35%, rgba(251,191,36,0.85) 0%, rgba(251,191,36,0.22) 70%, transparent 100%)" }}
        />
        <span className="absolute bottom-3 left-1/2 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full bg-white/90 shadow-sm">
          <Play className="ml-0.5 h-3 w-3 fill-[#1e1b4b] text-[#1e1b4b]" />
        </span>
      </span>
      <Chip icon={ScanFace} label="Face" className="-right-1 top-0" />
      <Chip icon={Captions} label="Lip Sync" className="-left-2 bottom-7" />
      <Chip icon={AudioLines} label="Voice" className="-right-2 bottom-1" />
    </div>
  );
}

function Chip({ icon: Icon, label, className }: { icon: typeof ScanFace; label: string; className?: string }) {
  return (
    <span
      className={cn(
        "absolute inline-flex items-center gap-1 rounded-full bg-white/[0.92] px-2 py-1 text-[10px] font-semibold text-foreground shadow-[0_6px_16px_-8px_rgba(15,23,42,0.45)] ring-1 ring-inset ring-black/[0.06]",
        "dark:bg-white/10 dark:text-white dark:ring-white/10 dark:backdrop-blur-sm",
        className,
      )}
    >
      <Icon className="h-3 w-3 text-primary" />
      {label}
    </span>
  );
}
