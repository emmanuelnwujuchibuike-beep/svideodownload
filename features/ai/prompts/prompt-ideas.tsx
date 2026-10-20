"use client";

import { ArrowRight, Info, Loader2, X, PenLine } from "lucide-react";
import Link from "next/link";
import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";

import { aiButtonClass } from "@/features/ai/design/ai-button";
import { readiness, type PromptMode, type PromptSuggestion, type WorkspaceAssets } from "@/lib/ai/prompts/schema";
import { cn } from "@/lib/utils";

import type { PromptLibraryProps } from "./prompt-library";

/**
 * "What do you want to create?" — the prompt-suggestion entry on Text to Video and Image to
 * Video (owner's brief, 2026-10-15).
 *
 * Compact on purpose: a heading, one line and an "Explore Prompts" button. The library itself
 * (search, categories, ~190 complete prompts) is a dynamic import fetched on the first tap, or
 * when the button is hovered or focused, so the workspace's first load carries none of it.
 *
 * Choosing a prompt only changes the text in the prompt field: no generation, no quote, no
 * credit, no request (the price never depends on the prompt — use-video-generation.ts). The
 * attached photo, references, model and settings are never touched. What the prompt needs that
 * is not attached yet is said here, with a way to fix it, and nothing is switched for the member.
 */

type Library = ComponentType<PromptLibraryProps>;

let libraryModule: Promise<Library> | null = null;
const loadLibrary = () => (libraryModule ??= import("./prompt-library").then((m) => m.PromptLibrary));

/** Where a prompt waits while the member moves to the other tool (sessionStorage, read once). */
const HANDOFF_KEY = "frenz:ai:prompt-handoff";

const MODE_NAME: Record<PromptMode, string> = { text_to_video: "Text to Video", image_to_video: "Image to Video" };
const MODE_PATH: Record<PromptMode, string> = { text_to_video: "text-to-video", image_to_video: "image-to-video" };

export interface PromptIdeasProps {
  mode: PromptMode;
  /** the prompt field's current text */
  prompt: string;
  /** set the prompt field (the workspace's own setter) */
  onPromptChange: (next: string) => void;
  /** the field's character limit */
  max: number;
  /** what is attached now — for the requirement notice */
  assets: WorkspaceAssets;
  /** scroll the reference slots (or the photo) into view */
  onShowReferences: () => void;
  /** Text to Video: switch the reference video to "Edit this video" — offered, never done for the member */
  onUseEditMode?: () => void;
  /** "/ai" or "/studio/ai" */
  base: string;
  /** focus the prompt field and show the whole inserted prompt */
  onInserted?: () => void;
  disabled?: boolean;
  className?: string;
  /** "inline" (steps 18–19): only the "Explore prompts" button, for the prompt box's own footer; its notice wraps onto its own row. */
  variant?: "card" | "inline";
}

export function PromptIdeas({ mode, prompt, onPromptChange, max, assets, onShowReferences, onUseEditMode, base, onInserted, disabled, className, variant = "card" }: PromptIdeasProps) {
  const [Library, setLibrary] = useState<Library | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [chosen, setChosen] = useState<PromptSuggestion | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  // a prompt handed over from the other tool ("Open in Text to Video") lands in an EMPTY field only
  const handoffRead = useRef(false);
  useEffect(() => {
    if (handoffRead.current) return;
    handoffRead.current = true;
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return;
      const h = JSON.parse(raw) as { mode?: string; prompt?: string };
      if (h.mode !== mode || typeof h.prompt !== "string") return;
      sessionStorage.removeItem(HANDOFF_KEY);
      if (!prompt.trim()) onPromptChange(h.prompt.slice(0, max));
    } catch {
      /* storage blocked — nothing to carry over */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const warm = useCallback(() => void loadLibrary().catch(() => {}), []);

  const openLibrary = async () => {
    if (disabled) return;
    if (!Library) {
      setLoading(true);
      try {
        const L = await loadLibrary();
        setLibrary(() => L);
      } catch {
        setLoading(false);
        return; // chunk failed — the field still works as before
      }
      setLoading(false);
    }
    setOpen(true);
  };

  const close = useCallback(() => {
    setOpen(false);
    // focus goes back where it came from
    requestAnimationFrame(() => trigger.current?.focus());
  }, []);

  const onChoose = useCallback(
    (s: PromptSuggestion, next: string) => {
      setOpen(false);
      onPromptChange(next);
      setChosen(s);
      requestAnimationFrame(() => onInserted?.());
    },
    [onPromptChange, onInserted],
  );

  const state = chosen ? readiness(chosen, mode, assets) : null;
  const handOver = (to: PromptMode) => {
    try {
      sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ mode: to, prompt: chosen?.prompt ?? prompt }));
    } catch {
      /* the link still opens the other tool */
    }
  };

  // what the chosen prompt still needs — said plainly, with the way to fix it; nothing changes by itself
  const notice = chosen && state && state.kind !== "ready" ? (
        <div role="status" className="mt-3 flex basis-full gap-2.5 rounded-xl bg-card/90 p-3 text-[12.5px] leading-snug ring-1 ring-inset ring-amber-500/30">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">“{chosen.title}”</p>
            {state.kind === "missing" ? (
              <>
                <p className="mt-0.5 text-muted-foreground">
                  This prompt needs {listWords(state.needs.map((n) => (n === "photo" ? "your photo" : `a ${n}`)))}. Add {state.needs.length > 1 ? "them" : "it"} before you generate.
                </p>
                <button type="button" onClick={onShowReferences} className="mt-2 inline-flex min-h-[2.25rem] items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
                  {state.needs.includes("photo") ? "Add your photo" : "Go to references"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            ) : state.kind === "switch-to-edit" ? (
              <>
                <p className="mt-0.5 text-muted-foreground">
                  Your reference video is set to copy its motion. To replace the character inside it, choose “Edit this video”. The price may change, and you&apos;ll see it before you generate.
                </p>
                {onUseEditMode ? (
                  <button type="button" onClick={onUseEditMode} className="mt-2 inline-flex min-h-[2.25rem] items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
                    Use “Edit this video” <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <p className="mt-0.5 text-muted-foreground">
                  {MODE_NAME[mode]} can&apos;t do this: here a reference video only guides motion, so a character inside a video can&apos;t be replaced.
                  {state.alternative ? ` ${MODE_NAME[state.alternative]} can, with the same prompt.` : " Choose another prompt."}
                </p>
                {state.alternative ? (
                  <Link
                    href={`${base}/${MODE_PATH[state.alternative]}`}
                    onClick={() => handOver(state.alternative!)}
                    className="mt-2 inline-flex min-h-[2.25rem] items-center gap-1 font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    Open in {MODE_NAME[state.alternative]} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </Link>
                ) : null}
                {state.alternative ? <p className="mt-1 text-[11.5px] text-muted-foreground">Your prompt goes with you; files attached here stay on this page.</p> : null}
              </>
            )}
          </div>
          <button type="button" onClick={() => setChosen(null)} aria-label="Dismiss" className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null;

  if (variant === "inline") {
    return (
      <>
        <button
          ref={trigger}
          type="button"
          onClick={() => void openLibrary()}
          onPointerEnter={warm}
          onFocus={warm}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-frenz-violet/10 px-3.5 text-[13.5px] font-bold text-frenz-violet transition active:scale-95 disabled:opacity-50", className)}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
          Explore prompts
        </button>
        {notice}
        {open && Library ? <Library mode={mode} currentPrompt={prompt} max={max} assets={assets} onChoose={onChoose} onClose={close} /> : null}
      </>
    );
  }

  return (
    <section aria-labelledby="prompt-ideas-title" className={cn("rounded-2xl bg-gradient-to-br from-blue-500/[0.07] via-indigo-500/[0.06] to-violet-500/[0.07] p-3.5 ring-1 ring-inset ring-indigo-500/15 dark:from-blue-400/[0.08] dark:via-indigo-400/[0.07] dark:to-violet-400/[0.08] dark:ring-indigo-300/15", className)}>
      {/* on a phone the button takes its own full-width row, so the heading reads on one or two lines */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/70 text-indigo-600 ring-1 ring-inset ring-indigo-500/15 dark:bg-white/[0.06] dark:text-indigo-300" aria-hidden>
          <PenLine className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-[11rem] flex-1">
          <h2 id="prompt-ideas-title" className="text-[14.5px] font-bold tracking-[-0.01em]">
            What do you want to create?
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">Choose an idea and we&apos;ll write the prompt for you.</p>
        </div>
        <button
          ref={trigger}
          type="button"
          onClick={() => void openLibrary()}
          onPointerEnter={warm}
          onFocus={warm}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={aiButtonClass({ variant: "secondary", size: "sm", className: "min-h-[2.75rem] w-full shrink-0 px-3.5 sm:w-auto" })}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
          <span>Explore Prompts</span>
        </button>
      </div>

      {notice}

      {open && Library ? <Library mode={mode} currentPrompt={prompt} max={max} assets={assets} onChoose={onChoose} onClose={close} /> : null}
    </section>
  );
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
