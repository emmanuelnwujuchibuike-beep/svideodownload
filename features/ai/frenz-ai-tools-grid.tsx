"use client";

import {
  AudioLines,
  Captions,
  ChevronRight,
  History,
  Mic,
  PersonStanding,
  ScanFace,
  Shirt,
  Type,
  UserRound,
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
 * buttons are gone; Voice Replace stays a step of a creation. Voice CLONING is
 * not offered. No provider or model is named. AI Clean is not a card.
 */
export type AiToolId =
  | "text_to_audio"
  | "audio_library"
  | "lip_sync_pro"
  | "face_only"
  | "skin_face"
  | "upper_body"
  | "full_character"
  | "voice_replace"
  | "history";

export type AiToolGroup = "audio" | "video" | "transform" | "library";
export const AI_TOOL_GROUP_LABEL: Record<AiToolGroup, { title: string; hint: string }> = {
  audio: { title: "Audio tools", hint: "Sound only — no video is touched." },
  video: { title: "Video tools", hint: "One operation on a video you already have." },
  transform: { title: "Transformation tools", hint: "Integrated workflows that change who is in the video." },
  library: { title: "Yours", hint: "Everything you have made." },
};

export interface AiToolCard {
  id: AiToolId;
  icon: typeof ScanFace;
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

export type FlowToolId = Extract<AiToolId, "voice_replace">;
export const FLOW_TOOL_HINT: Record<FlowToolId, string> = {
  voice_replace:
    "Choose a scope to start. Your own recording is added in the Voice step of your creation.",
};

/** The Audio tools' doors open with their pages (the Text to Audio commit); a card never links to a page that does not exist yet. */
const AUDIO_TOOLS_OPEN = false;

export function aiToolCards(
  characterReplaceHref: string,
  historyHref: string,
  /** 2026-09-21: the standalone tools' doors, derived from the Character Replace href's root (`/ai` or `/studio/ai`) when a host does not pass them. */
  doors: { lipSyncHref?: string; textToAudioHref?: string; audioLibraryHref?: string } = {},
): AiToolCard[] {
  const root = characterReplaceHref.replace(/\/character-replace$/, "");
  const lipSyncHref = doors.lipSyncHref ?? `${root}/lip-sync`;
  const textToAudioHref = doors.textToAudioHref ?? `${root}/text-to-audio`;
  const audioLibraryHref = doors.audioLibraryHref ?? `${root}/audio`;
  const create = `${characterReplaceHref}/create`;
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
      id: "face_only",
      icon: ScanFace,
      tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300",
      name: "Face Only",
      blurb: "Replace a face while preserving the rest of the video.",
      href: `${create}?mode=face_only`,
      scope: true,
      flow: false,
      group: "transform",
    },
    {
      id: "skin_face",
      icon: UserRound,
      tint: "bg-purple-500/[0.10] text-purple-600 dark:text-purple-300",
      name: "Face + Head",
      blurb: "Replace the face and skin appearance.",
      href: `${create}?mode=skin_face`,
      scope: true,
      flow: false,
      group: "transform",
    },
    {
      id: "upper_body",
      icon: Shirt,
      tint: "bg-fuchsia-500/[0.10] text-fuchsia-600 dark:text-fuchsia-300",
      name: "Upper Body",
      blurb: "Replace the face, torso and clothing.",
      href: `${create}?mode=upper_body`,
      scope: true,
      flow: false,
      group: "transform",
    },
    {
      id: "full_character",
      icon: PersonStanding,
      tint: "bg-pink-500/[0.10] text-pink-600 dark:text-pink-300",
      name: "Full Character",
      blurb: "Transform the complete character in your video.",
      href: `${create}?mode=full_character`,
      scope: true,
      flow: false,
      group: "transform",
    },
    {
      id: "voice_replace",
      icon: Captions,
      tint: "bg-sky-500/[0.10] text-sky-600 dark:text-sky-300",
      name: "Voice Replace",
      blurb: "Use your own recording as the voice of a transformation.",
      href: characterReplaceHref,
      scope: false,
      flow: true,
      group: "transform",
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
  const groups: AiToolGroup[] = ["audio", "video", "transform", "library"];
  return (
    <section aria-labelledby="ai-tools-title" className={className}>
      <div className="flex items-end justify-between gap-3 px-1">
        <h2
          id="ai-tools-title"
          className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground"
        >
          AI Tools
        </h2>
        <p className="text-[11.5px] text-muted-foreground">
          Choose exactly what you need
        </p>
      </div>
      {groups.map((group) => {
        const rows = cards.filter((c) => c.group === group);
        if (!rows.length) return null;
        const label = AI_TOOL_GROUP_LABEL[group];
        return (
          <div key={group} className="mt-4 first:mt-2.5">
            <div className="flex items-baseline gap-2 px-1">
              <h3 className="text-[12.5px] font-bold tracking-[-0.01em]">{label.title}</h3>
              <p className="text-[11px] text-muted-foreground">{label.hint}</p>
            </div>
            <ul
              className={cn(
                "mt-2 grid grid-cols-2 gap-2.5",
                include === "all" ? "md:grid-cols-4" : "sm:grid-cols-4",
              )}
            >
              {rows.map((tool) => (
                <li key={tool.id} className="min-w-0">
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

const CARD =
  "group flex h-full min-h-[6.5rem] w-full flex-col rounded-[1.2rem] bg-card/95 p-3 text-left ring-1 ring-inset ring-black/[0.05] dark:ring-white/10 sm:p-3.5 " +
  "shadow-[0_10px_28px_-22px_rgba(15,23,42,0.4)] transition duration-200 motion-safe:hover:-translate-y-0.5 active:scale-[0.99] " +
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
      <div className={cn(CARD, "opacity-60")} aria-disabled>
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
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.7rem]",
            tint,
          )}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary/80 text-foreground/60 transition group-hover:text-foreground">
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      </div>
      <h3 className="mt-2.5 text-[13.5px] font-bold leading-tight tracking-[-0.01em]">
        {name}
      </h3>
      <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">
        {blurb}
      </p>
    </>
  );
  if (onFlowTool && tool.flow && tool.id === "voice_replace") {
    const id = tool.id;
    return (
      <button type="button" onClick={() => onFlowTool(id)} className={CARD}>
        {body}
      </button>
    );
  }
  return (
    <Link href={href} className={CARD}>
      {body}
      <LinkPendingStripe />
    </Link>
  );
}
