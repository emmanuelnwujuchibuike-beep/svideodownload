"use client";

import {
  AudioLines,
  ChevronRight,
  History,
  Image as ImageIcon,
  Mic,
  Mic2,
  Sparkles,
  Type,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";

import { LinkPendingStripe } from "@/features/navigation/link-pending-stripe";
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
  className,
}: {
  characterReplaceHref: string;
  historyHref: string;
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
 * The tool card's ground, tinted by category.
 *
 * ── 🔴 WHY THIS CHANGED (owner, 2026-09-28) ─────────────────────────────────
 *
 * "the Ai features page, and every page still looks fucking the same."
 *
 * Every card was `bg-card/95` with a ring: eleven identical white bordered
 * rectangles in a grid. The brief says it twice — §8 "Do not make every tool
 * an identical large white bordered rectangle", and §25 "Reduce visible
 * borders. Current UI relies too heavily on bordered containers." The
 * reference carries the category in the CARD'S OWN GROUND: audio reads cool
 * blue/cyan, transformation purple, voice pink.
 *
 * So the border goes and the tint arrives. The icon keeps its stronger tint
 * on top, which is what still separates one tool from its neighbour inside a
 * category.
 *
 * ⚠️ Kept extremely restrained, per §2 and §49: these are 4–6% washes, not
 * saturated panels. Side by side they read as a family with a hue, not as a
 * colour-blocked dashboard.
 */
const GROUP_GROUND: Record<AiToolGroup, string> = {
  create: "bg-violet-50/70",
  audio: "bg-sky-50",
  video: "bg-indigo-50/70",
  library: "bg-slate-50",
};

const CARD =
  "group relative flex h-full min-h-[7rem] w-full flex-col rounded-[1.25rem] p-3.5 text-left sm:p-4 " +
  "shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition duration-200 " +
  "motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)] active:scale-[0.99] " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function ToolCardView({
  tool,
  onFlowTool,
  disabledNote,
}: {
  tool: AiToolCard;
  onFlowTool?: (id: FlowToolId) => void;
  disabledNote: string | null;
}) {
  const { icon: Icon, href, name, blurb, tint } = tool;
  if (disabledNote) {
    return (
      <div className={cn(CARD, GROUP_GROUND[tool.group], "opacity-60")} aria-disabled>
        <div className="flex items-start justify-between gap-2">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem]",
              tint,
            )}
          >
            <Icon className="h-[18px] w-[18px]" aria-hidden />
          </span>
        </div>
        <h3 className="mt-2.5 text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
          {name}
        </h3>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
          {disabledNote}
        </p>
      </div>
    );
  }
  /*
    The arrow sits at the FOOT, on the trailing edge, under the description —
    where the reference puts it. In the corner beside the icon it competed
    with the icon for the same glance and made every card read top-heavy.
    `mt-auto` pins it to the bottom so a two-line and a three-line card still
    line their arrows up across a row.
  */
  const body = (
    <>
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem]",
          tint,
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <h3 className="mt-2.5 text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
        {name}
      </h3>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        {blurb}
      </p>
      <span className="mt-auto flex justify-end pt-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/70 text-foreground/50 transition group-hover:bg-white group-hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </span>
    </>
  );
  /*
    🔴 No tool is a flow STEP any more (Part 5). Voice Replace was the only one —
    a step inside the Character Replace creation — and that tool is retired.
    `FlowToolId` is `never`, so `tool.flow` can no longer be true for any card
    and this branch is unreachable; it is removed rather than left as a
    condition that reads as though some card still behaves this way.
  */
  return (
    <Link href={href} className={cn(CARD, GROUP_GROUND[tool.group])}>
      {body}
      <LinkPendingStripe />
    </Link>
  );
}
