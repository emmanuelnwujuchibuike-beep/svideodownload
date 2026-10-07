"use client";

import {
  ArrowRight,
  AudioWaveform,
  Clapperboard,
  Film,
  ImagePlay,
  ListMusic,
  MicVocal,
  Sparkles,
  Speech,
  UsersRound,
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
          icon: AudioWaveform,
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
          icon: MicVocal,
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
          icon: ListMusic,
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
          icon: UsersRound,
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
      icon: Speech,
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
      icon: Clapperboard,
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
      icon: ImagePlay,
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
      icon: Film,
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
/*
  ── 🔴 GRADIENT ICON ART, NEVER A PICTURE (owner, 2026-10-07) ─────────────
  "they should show a premium professional gradient icon in respective of
  their features, icons must match features — so the page doesn't feel heavy
  and so images don't go through Vercel." Each card: a soft tinted panel, and
  a glossy two-tone "app icon" in the feature's own colours with a matching
  glow. Pure CSS — zero image bytes, nothing fetched, nothing optimised.
  Classes are literal so Tailwind keeps them.
*/
const TOOL_ART: Record<AiToolId, { panel: string; badge: string; glow: string; mark: string }> = {
  text_to_video: { panel: "from-violet-100 via-fuchsia-50 to-white dark:from-violet-950/70 dark:via-fuchsia-950/40 dark:to-slate-950", badge: "from-violet-500 to-fuchsia-500", glow: "shadow-[0_10px_28px_-8px_rgba(168,85,247,0.75)]", mark: "text-violet-500/[0.10]" },
  image_to_video: { panel: "from-sky-100 via-indigo-50 to-white dark:from-sky-950/70 dark:via-indigo-950/40 dark:to-slate-950", badge: "from-sky-500 to-indigo-500", glow: "shadow-[0_10px_28px_-8px_rgba(79,70,229,0.75)]", mark: "text-indigo-500/[0.10]" },
  lip_sync_pro: { panel: "from-cyan-100 via-blue-50 to-white dark:from-cyan-950/70 dark:via-blue-950/40 dark:to-slate-950", badge: "from-cyan-400 to-blue-600", glow: "shadow-[0_10px_28px_-8px_rgba(37,99,235,0.7)]", mark: "text-cyan-500/[0.12]" },
  text_to_audio: { panel: "from-indigo-100 via-violet-50 to-white dark:from-indigo-950/70 dark:via-violet-950/40 dark:to-slate-950", badge: "from-indigo-500 to-violet-500", glow: "shadow-[0_10px_28px_-8px_rgba(99,102,241,0.75)]", mark: "text-indigo-500/[0.10]" },
  voice_clone: { panel: "from-pink-100 via-rose-50 to-white dark:from-pink-950/70 dark:via-rose-950/40 dark:to-slate-950", badge: "from-pink-500 to-rose-500", glow: "shadow-[0_10px_28px_-8px_rgba(244,63,94,0.7)]", mark: "text-rose-500/[0.10]" },
  audio_library: { panel: "from-teal-100 via-emerald-50 to-white dark:from-teal-950/70 dark:via-emerald-950/40 dark:to-slate-950", badge: "from-teal-400 to-emerald-600", glow: "shadow-[0_10px_28px_-8px_rgba(16,185,129,0.7)]", mark: "text-teal-500/[0.12]" },
  voice_library: { panel: "from-emerald-100 via-green-50 to-white dark:from-emerald-950/70 dark:via-green-950/40 dark:to-slate-950", badge: "from-emerald-400 to-green-600", glow: "shadow-[0_10px_28px_-8px_rgba(22,163,74,0.7)]", mark: "text-emerald-500/[0.12]" },
  history: { panel: "from-amber-100 via-orange-50 to-white dark:from-amber-950/70 dark:via-orange-950/40 dark:to-slate-950", badge: "from-amber-400 to-orange-600", glow: "shadow-[0_10px_28px_-8px_rgba(234,88,12,0.7)]", mark: "text-amber-500/[0.14]" },
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
  wide,
}: {
  tool: AiToolCard;
  onFlowTool?: (id: FlowToolId) => void;
  disabledNote: string | null;
  wide?: boolean;
}) {
  const { icon: Icon, href, name, blurb, id } = tool;

  const art = TOOL_ART[id];
  const header = (
    <span className={cn("relative flex items-center justify-center overflow-hidden bg-gradient-to-br", art.panel, wide ? "aspect-[2.6/1]" : "aspect-[16/10]")}>
      {/* the feature's mark, large and faint — depth without a picture */}
      <Icon className={cn("absolute -bottom-4 -right-3 h-24 w-24", art.mark)} strokeWidth={1.25} aria-hidden />
      {/* the app-icon: two-tone gradient, a glossy top highlight, the feature's own glow */}
      <span className={cn("relative flex h-14 w-14 items-center justify-center rounded-[1.1rem] bg-gradient-to-br text-white ring-1 ring-inset ring-white/25", art.badge, art.glow)}>
        <span className="pointer-events-none absolute inset-x-1 top-1 h-1/2 rounded-t-[0.9rem] bg-gradient-to-b from-white/35 to-transparent" aria-hidden />
        <Icon className="relative h-7 w-7 drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]" strokeWidth={1.9} aria-hidden />
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
