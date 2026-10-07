"use client";

import {
  ArrowRight,
  AudioLines,
  History,
  Image as ImageIcon,
  Mic,
  Mic2,
  Sparkles,
  Type,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
import type { ShowcaseImage } from "@/lib/ai/showcase/slides";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  AI TOOLS — one compact card per door, on the welcome page AND the studio
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-20: "Put the entire AI tool section down to AI credits and
 * usage in the Explore AI Studio page… use the grid that has all AI features,
 * including the ones that will be built in the next session." So this grid is
 * the studio's table of contents: one row per feature in `aiToolCards`, and
 * a feature built later is one more row. The four scopes open the workspace on
 * that scope (`/create?mode=`); Voice Replace is a step of every creation, so
 * on the Explore page it is a button that hands the intent back — the page
 * shows where the tool is chosen and brings the scope cards into view — never
 * a link to the page it is on (a same-route link is a dead tap). History is
 * history.
 *
 * 2026-09-21 (the standalone-tools brief §7, §11): three GROUPS — Audio tools
 * (Text to Audio, the Audio Library), Video tools (Lip Sync Pro) and the
 * Transformation tools (the four scopes) — each a first-class door. Text to
 * Audio is not a prerequisite for Lip Sync, and Lip Sync is not a sub-feature
 * of Character Replace: the old "Lip Sync" / "Text to Speech" scroll-to-scope
 * buttons are gone; Voice Replace stays a step of a creation. No provider or
 * model is named. AI Clean is not a card.
 *
 * 2026-09-27: VOICE CLONING is an Audio tool with a door of its own, and the
 * member's Voice Library sits beside it. This note used to say cloning was not
 * offered; the owner asked for it and it shipped as its own standalone tool.
 */
export type AiToolId =
  | "text_to_audio"
  | "audio_library"
  | "voice_clone"
  | "voice_library"
  | "lip_sync_pro"
  | "text_to_video"
  | "image_to_video"
  | "history";

export type AiToolGroup = "create" | "audio" | "video" | "library";
/**
 * The category names from the owner's reference.
 *
 * They were "Audio tools" / "Video tools" / "Transformation tools" — accurate,
 * and written from the implementation's point of view rather than the member's.
 * The reference names them by what you DO: Create Audio, Transform Video. §47
 * asks every page to answer "what can I do?", and a verb answers it faster than
 * a noun.
 *
 * ⚠️ The reference also shows a GENERATE section (Text to Video, Image + Video
 * References). It is deliberately absent: neither tool exists in this product,
 * and §7 is explicit — "Do not blindly add tools that do not exist. Only expose
 * functionality actually implemented." A card leading to a 404 would read as a
 * feature that broke.
 */
export const AI_TOOL_GROUP_LABEL: Record<AiToolGroup, { title: string; hint: string }> = {
  create: { title: "Create Video", hint: "Make something new from a description or a photo." },
  audio: { title: "Create Audio", hint: "Sound only — no video is touched." },
  video: { title: "Transform Video", hint: "One operation on a video you already have." },
  library: { title: "Yours", hint: "Everything you have made." },
};

export interface AiToolCard {
  id: AiToolId;
  icon: typeof Sparkles;
  tint: string;
  name: string;
  blurb: string;
  href: string;
  /** True for the four replacement scopes — the studio page already draws these as its own cards. */
  scope: boolean;
  /** True for a step inside every creation (chosen after the scope, in the Voice step). */
  flow: boolean;
  group: AiToolGroup;
}

/**
 * A tool that is a STEP inside another creation rather than a door of its own.
 *
 * 🔴 Empty since 2026-09-28 (Part 5). Its only member was Voice Replace, a step
 * of the Character Replace flow — and that tool is retired, because the direct
 * Kling API has no endpoint that accepts a video plus a character. The type is
 * kept so the grid's flow handling stays intact for the next tool that needs
 * it; `never` means no card can currently claim to be one.
 */
export type FlowToolId = never;
export const FLOW_TOOL_HINT: Record<string, string> = {};

/** The Audio tools' doors open with their pages (the Text to Audio commit); a card never links to a page that does not exist yet. */
const AUDIO_TOOLS_OPEN = true;

export function aiToolCards(
  characterReplaceHref: string,
  historyHref: string,
  /** 2026-09-21: the standalone tools' doors, derived from the Character Replace href's root (`/ai` or `/studio/ai`) when a host does not pass them. */
  doors: { lipSyncHref?: string; textToAudioHref?: string; audioLibraryHref?: string; voiceCloneHref?: string; voiceLibraryHref?: string; textToVideoHref?: string; imageToVideoHref?: string } = {},
): AiToolCard[] {
  const root = characterReplaceHref.replace(/\/character-replace$/, "");
  const lipSyncHref = doors.lipSyncHref ?? `${root}/lip-sync`;
  const textToAudioHref = doors.textToAudioHref ?? `${root}/text-to-audio`;
  const audioLibraryHref = doors.audioLibraryHref ?? `${root}/audio`;
  const voiceCloneHref = doors.voiceCloneHref ?? `${root}/voice-cloning`;
  const voiceLibraryHref = doors.voiceLibraryHref ?? `${root}/voices`;
  const textToVideoHref = doors.textToVideoHref ?? `${root}/text-to-video`;
  const imageToVideoHref = doors.imageToVideoHref ?? `${root}/image-to-video`;
  const audio: AiToolCard[] = AUDIO_TOOLS_OPEN
    ? [
        {
          id: "text_to_audio",
          icon: Type,
          tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300",
          name: "Text to Audio",
          blurb: "Turn your words into natural AI audio.",
          href: textToAudioHref,
          scope: false,
          flow: false,
          group: "audio",
        },
        {
          id: "voice_clone",
          icon: Mic2,
          tint: "bg-rose-500/[0.10] text-rose-600 dark:text-rose-300",
          name: "Voice Cloning",
          blurb: "Clone a voice you own and type with it anywhere.",
          href: voiceCloneHref,
          scope: false,
          flow: false,
          group: "audio",
        },
        {
          id: "audio_library",
          icon: AudioLines,
          tint: "bg-teal-500/[0.10] text-teal-600 dark:text-teal-300",
          name: "Audio Library",
          blurb: "Your saved audio — play, download, reuse in Lip Sync Pro.",
          href: audioLibraryHref,
          scope: false,
          flow: false,
          group: "audio",
        },
        {
          id: "voice_library",
          icon: UserRoundCheck,
          tint: "bg-emerald-500/[0.10] text-emerald-600 dark:text-emerald-300",
          name: "Your Voices",
          blurb: "The voices you have cloned, ready to speak.",
          href: voiceLibraryHref,
          scope: false,
          flow: false,
          group: "library",
        },
      ]
    : [];
  return [
    ...audio,
    {
      id: "lip_sync_pro",
      icon: Mic,
      tint: "bg-cyan-500/[0.10] text-cyan-600 dark:text-cyan-300",
      name: "Lip Sync Pro",
      blurb: "Give an existing video natural lip synchronization using any audio.",
      href: lipSyncHref,
      scope: false,
      flow: false,
      group: "video",
    },
    {
      id: "text_to_video",
      icon: Sparkles,
      tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300",
      name: "Text to Video",
      /*
        🔴 The style belongs in the blurb (owner, 2026-10-04: "make the text to
        video and image to video says realistic, cartoon or anyhow described").
        "Create a video from a written description" is true and says nothing —
        it reads like a constrained tool. The model takes the style FROM the
        prompt, so the card has to say that the look is the member's to choose,
        or nobody discovers it.
      */
      blurb: "Describe it and watch it film — realistic, cartoon, anime, any style.",
      href: textToVideoHref,
      scope: false,
      flow: false,
      group: "create",
    },
    {
      id: "image_to_video",
      icon: ImageIcon,
      tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300",
      name: "Image to Video",
      /* Same reason as Text to Video above: the style is described, not fixed. */
      blurb: "Bring a photo to life — realistic, cartoon, anime, however you describe it.",
      href: imageToVideoHref,
      scope: false,
      flow: false,
      group: "create",
    },
    {
      id: "history",
      icon: History,
      tint: "bg-amber-500/[0.12] text-amber-600 dark:text-amber-300",
      name: "Your AI Videos",
      blurb: "Everything you have created, in one place.",
      href: historyHref,
      scope: false,
      flow: false,
      group: "library",
    },
  ];
}

export function FrenzAIToolsGrid({
  characterReplaceHref,
  historyHref,
  include = "all",
  onFlowTool,
  disabled,
  images,
  clips,
  className,
}: {
  characterReplaceHref: string;
  historyHref: string;
  /** A real picture per tool, from the admin's showcase uploads (see ToolCardView). */
  images?: Partial<Record<AiToolId, ShowcaseImage>>;
  /** A short muted clip per tool (Admin → Frenz AI → Tool cards); plays only while its card is on screen. */
  clips?: Partial<Record<AiToolId, string>>;
  /** "all" — the Explore page; "beyond-scopes" is kept for a host that draws the scopes itself. */
  include?: "all" | "beyond-scopes";
  /** When given, a flow tool (Voice Replace) is a button that hands its id back instead of a link. */
  onFlowTool?: (id: FlowToolId) => void;
  /** Tools the operator has switched off, with the sentence to show instead of a door. */
  disabled?: Partial<Record<AiToolId, string>>;
  className?: string;
}) {
  const cards = aiToolCards(characterReplaceHref, historyHref).filter(
    (c) => include === "all" || !c.scope,
  );
  const groups: AiToolGroup[] = ["create", "video", "audio", "library"];
  return (
    <section aria-labelledby="ai-tools-title" className={className}>
      {/*
        §1 of the brief: "avoid excessive uppercase labels". This was an
        11px all-caps tracked-out label — the SaaS-dashboard tell the brief
        names — over a one-line hint on the same row. The reference states it
        plainly instead: a real heading, and the instruction under it.
      */}
      <div className="px-1">
        <h2 id="ai-tools-title" className="text-[1.05rem] font-bold tracking-[-0.02em]">
          AI Tools
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Choose a category and start creating.
        </p>
      </div>
      {groups.map((group) => {
        const rows = cards.filter((c) => c.group === group);
        if (!rows.length) return null;
        const label = AI_TOOL_GROUP_LABEL[group];
        return (
          <div key={group} className="mt-6 first:mt-5">
            <div className="px-1">
              <h3 className="text-[14.5px] font-bold tracking-[-0.015em]">{label.title}</h3>
              <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{label.hint}</p>
            </div>
            <ul
              className={cn(
                "mt-2.5 grid grid-cols-2 gap-2.5 sm:gap-3",
                // §34: tablets get three, not the phone's two stretched wide
                include === "all" ? "sm:grid-cols-3 lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-4",
              )}
            >
              {rows.map((tool, i) => (
                /*
                  🔴 NO HOLES (2026-09-27). Owner: "This page is not properly
                  arranged in grid." A group with an ODD number of cards left a
                  gap beside its last one — three Audio tools sat 2 + 1, and the
                  single Video tool sat alone in half a row with nothing next to
                  it. The last card of an odd group spans both columns instead,
                  so every group ends on a full edge and a one-card group reads
                  as a banner rather than as a mistake. Two columns is the phone
                  layout; at md the grid is four wide and the rule lifts.
                */
                <li key={tool.id} className={cn("min-w-0", rows.length % 2 === 1 && i === rows.length - 1 && "col-span-2 md:col-span-1")}>
                  <ToolCardView
                    tool={tool}
                    onFlowTool={onFlowTool}
                    disabledNote={disabled?.[tool.id] ?? null}
                    image={images?.[tool.id] ?? null}
                    clip={clips?.[tool.id] ?? null}
                    wide={rows.length % 2 === 1 && i === rows.length - 1}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE TOOL CARD — a media card, like the AI platforms the owner points at
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-05, on the Explore grid: "these cards … were supposed to be
 * upgraded and evolved to look more like professional AI platforms with a
 * clear premium view."
 *
 * The tinted-ground cards (2026-09-28) answered the brief of that day — no
 * identical white bordered rectangles — but they were still an icon and two
 * lines of text in a pale box. Every AI product the reference is drawn from
 * leads with a PICTURE of what the tool makes. So each card now has:
 *
 *   · a VISUAL HEADER — the tool's own art (the showcase's navy, lit in the
 *     tool's colour), a glass icon tile, and a scrim;
 *   · a real IMAGE in that header when the admin has uploaded one for that
 *     tool in the showcase (Admin → Frenz AI → Welcome showcase). Nothing new
 *     to manage and nothing fetched: the slides are already in the page, and
 *     their ~720 px webp copy is ample for a card;
 *   · a white body — title, one line, and "Open →".
 *
 * The art is CSS (two radial lights on the brand navy), so a card with no
 * upload costs zero image bytes. A group with one card gets the wide
 * banner shape so it never reads as a gap.
 */
const TOOL_ART: Record<AiToolId, string> = {
  text_to_video: "radial-gradient(80% 90% at 85% 10%, rgba(139,92,246,.75), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(59,130,246,.6), transparent 62%), #131a4a",
  image_to_video: "radial-gradient(80% 90% at 85% 10%, rgba(99,102,241,.75), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(14,165,233,.55), transparent 62%), #131a4a",
  lip_sync_pro: "radial-gradient(80% 90% at 85% 10%, rgba(6,182,212,.6), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(99,102,241,.6), transparent 62%), #131a4a",
  text_to_audio: "radial-gradient(80% 90% at 85% 10%, rgba(129,140,248,.7), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(56,189,248,.5), transparent 62%), #131a4a",
  voice_clone: "radial-gradient(80% 90% at 85% 10%, rgba(217,70,239,.55), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(99,102,241,.6), transparent 62%), #131a4a",
  audio_library: "radial-gradient(80% 90% at 85% 10%, rgba(20,184,166,.55), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(59,130,246,.55), transparent 62%), #131a4a",
  voice_library: "radial-gradient(80% 90% at 85% 10%, rgba(16,185,129,.5), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(99,102,241,.55), transparent 62%), #131a4a",
  history: "radial-gradient(80% 90% at 85% 10%, rgba(245,158,11,.5), transparent 60%), radial-gradient(70% 80% at 0% 100%, rgba(139,92,246,.55), transparent 62%), #131a4a",
};

/*
  Hover (Brief A, Cards): the edge strengthens and the card lifts 1 px, on
  hover-capable pointers only; touch gets the 0.98 press. No growing shadow.
*/
const CARD =
  "group relative flex h-full w-full flex-col overflow-hidden rounded-[1.375rem] bg-card text-left " +
  "ring-1 ring-inset ring-black/[0.07] shadow-[0_8px_24px_-20px_rgba(30,40,90,0.45)] transition duration-150 " +
  "[@media(hover:hover)]:hover:ring-indigo-300/70 motion-safe:[@media(hover:hover)]:hover:-translate-y-px active:scale-[0.98] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function ToolCardView({
  tool,
  onFlowTool: _onFlowTool,
  disabledNote,
  image,
  clip,
  wide,
}: {
  tool: AiToolCard;
  onFlowTool?: (id: FlowToolId) => void;
  disabledNote: string | null;
  image?: ShowcaseImage | null;
  clip?: string | null;
  wide?: boolean;
}) {
  const { icon: Icon, href, name, blurb, id } = tool;

  const header = (
    <span
      className={cn("relative block overflow-hidden", wide ? "aspect-[2.6/1]" : "aspect-[16/10]")}
      style={{ background: TOOL_ART[id] }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- a pre-sized webp on the storage CDN; the optimizer would bill a second encode
        <img src={image.sm} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <Icon className="absolute -bottom-3 -right-2 h-20 w-20 text-white/[0.1]" strokeWidth={1.25} aria-hidden />
      )}
      {image && clip ? <CardClip src={clip} poster={image.sm} /> : null}
      <span className="absolute inset-0 bg-gradient-to-t from-[#0b1340]/45 to-transparent" aria-hidden />
      <span className="absolute left-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.18] text-white ring-1 ring-inset ring-white/35">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
    </span>
  );

  const body = (
    <span className="flex flex-1 flex-col px-3.5 pb-3 pt-3">
      <span className="block text-[14.5px] font-semibold leading-tight tracking-[-0.015em]">{name}</span>
      <span className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-muted-foreground">{disabledNote ?? blurb}</span>
      {disabledNote ? null : (
        <span className="mt-auto inline-flex items-center gap-1 pt-2.5 text-[12.5px] font-semibold text-indigo-600">
          Open
          <ArrowRight className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
        </span>
      )}
    </span>
  );

  if (disabledNote) {
    return (
      <div className={cn(CARD, "opacity-60")} aria-disabled>
        {header}
        <h3 className="sr-only">{name}</h3>
        {body}
      </div>
    );
  }

  /*
    🔴 No tool is a flow STEP any more (Part 5). Voice Replace was the only one —
    a step inside the Character Replace creation — and that tool is retired.
    `FlowToolId` is `never`, so `tool.flow` can no longer be true for any card
    and this branch is unreachable; it is removed rather than left as a
    condition that reads as though some card still behaves this way.
  */
  return (
    <Link href={href} className={CARD}>
      {header}
      {body}
      <LinkPendingStripe />
    </Link>
  );
}

/**
 * A card's clip (2026-10-07). Nothing is downloaded until the card is on
 * screen (`preload="none"`), it plays muted only while at least half of it is
 * visible, and it pauses the moment it is not — no timer, no request while the
 * page sits idle. Reduced motion or Save-Data keeps the still picture.
 */
function CardClip({ src, poster }: { src: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const c = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || c?.saveData) {
      v.style.display = "none";
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) v.play().catch(() => undefined);
        else v.pause();
      },
      { threshold: 0.5 },
    );
    io.observe(v);
    return () => {
      io.disconnect();
      v.pause();
    };
  }, []);
  return <video ref={ref} src={src} poster={poster} muted loop playsInline preload="none" aria-hidden className="absolute inset-0 h-full w-full object-cover" />;
}
