"use client";

import {
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
 * Owner, 2026-09-20: "make this AI tool section in the landing page be in the
 * AI studio page." One component, two hosts:
 *
 *   · the welcome page shows all eight — the four scopes open the workspace on
 *     that scope (`/create?mode=`), Lip Sync / Voice Replace / Text to Speech
 *     open the studio (they are steps of every creation), history is history;
 *   · the studio (scope) page shows the four that are NOT its own scope cards —
 *     the scopes are already the page, and a second door to each three inches
 *     lower is the "cluster" the owner has ruled out. There, the three flow
 *     tools cannot link to the page they are on (a same-route link is a dead
 *     tap), so they are buttons that hand the intent back to the page, which
 *     scrolls the scopes into view and says where the tool is chosen.
 *
 * Voice CLONING is not offered (lib/ai/voice/tts-provider.ts §6) and there is
 * no text-to-audio tool, so neither is a card. No provider or model is named.
 */
export type AiToolId =
  | "face_only"
  | "skin_face"
  | "upper_body"
  | "full_character"
  | "lip_sync"
  | "voice_replace"
  | "tts"
  | "history";

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
}

export const FLOW_TOOL_HINT: Record<
  Extract<AiToolId, "lip_sync" | "voice_replace" | "tts">,
  string
> = {
  lip_sync:
    "Choose a scope to start. Lip Sync is set up in the Voice step of your creation.",
  voice_replace:
    "Choose a scope to start. Your own recording is added in the Voice step of your creation.",
  tts: "Choose a scope to start. Speech from text is generated in the Voice step of your creation.",
};

export function aiToolCards(
  characterReplaceHref: string,
  historyHref: string,
): AiToolCard[] {
  const create = `${characterReplaceHref}/create`;
  return [
    {
      id: "face_only",
      icon: ScanFace,
      tint: "bg-violet-500/[0.10] text-violet-600 dark:text-violet-300",
      name: "Face Only",
      blurb: "Replace the face, keep the performance.",
      href: `${create}?mode=face_only`,
      scope: true,
      flow: false,
    },
    {
      id: "skin_face",
      icon: UserRound,
      tint: "bg-purple-500/[0.10] text-purple-600 dark:text-purple-300",
      name: "Face + Head",
      blurb: "Replace the face and head appearance.",
      href: `${create}?mode=skin_face`,
      scope: true,
      flow: false,
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
    },
    {
      id: "full_character",
      icon: PersonStanding,
      tint: "bg-pink-500/[0.10] text-pink-600 dark:text-pink-300",
      name: "Full Character",
      blurb: "Transform the complete character.",
      href: `${create}?mode=full_character`,
      scope: true,
      flow: false,
    },
    {
      id: "lip_sync",
      icon: Captions,
      tint: "bg-blue-500/[0.10] text-blue-600 dark:text-blue-300",
      name: "Lip Sync",
      blurb: "Sync speech with video.",
      href: characterReplaceHref,
      scope: false,
      flow: true,
    },
    {
      id: "voice_replace",
      icon: Mic,
      tint: "bg-sky-500/[0.10] text-sky-600 dark:text-sky-300",
      name: "Voice Replace",
      blurb: "Use your own recording as the voice.",
      href: characterReplaceHref,
      scope: false,
      flow: true,
    },
    {
      id: "tts",
      icon: Type,
      tint: "bg-indigo-500/[0.10] text-indigo-600 dark:text-indigo-300",
      name: "Text to Speech",
      blurb: "Turn text into realistic speech.",
      href: characterReplaceHref,
      scope: false,
      flow: true,
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
    },
  ];
}

export function FrenzAIToolsGrid({
  characterReplaceHref,
  historyHref,
  include = "all",
  onFlowTool,
  className,
}: {
  characterReplaceHref: string;
  historyHref: string;
  /** "all" on the welcome page; "beyond-scopes" on the studio page, whose own cards are the scopes. */
  include?: "all" | "beyond-scopes";
  /** When given, a flow tool (Lip Sync, Voice Replace, Text to Speech) is a button that hands its id back instead of a link. */
  onFlowTool?: (id: "lip_sync" | "voice_replace" | "tts") => void;
  className?: string;
}) {
  const cards = aiToolCards(characterReplaceHref, historyHref).filter(
    (c) => include === "all" || !c.scope,
  );
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
          Tap a tool to start
        </p>
      </div>
      <ul
        className={cn(
          "mt-2.5 grid grid-cols-2 gap-2.5",
          include === "all" ? "md:grid-cols-4" : "sm:grid-cols-4",
        )}
      >
        {cards.map((tool) => (
          <li key={tool.id} className="min-w-0">
            <ToolCardView tool={tool} onFlowTool={onFlowTool} />
          </li>
        ))}
      </ul>
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
}: {
  tool: AiToolCard;
  onFlowTool?: (id: "lip_sync" | "voice_replace" | "tts") => void;
}) {
  const { icon: Icon, href, name, blurb, tint } = tool;
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
  if (
    onFlowTool &&
    (tool.id === "lip_sync" || tool.id === "voice_replace" || tool.id === "tts")
  ) {
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
