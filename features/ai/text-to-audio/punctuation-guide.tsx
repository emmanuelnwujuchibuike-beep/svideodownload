"use client";

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  HOW PUNCTUATION SHAPES THE VOICE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-28: "add a punctuation dictionary so users can follow to know
 * how to make a realistic conversation voice."
 *
 * This is the single highest-leverage thing a member can learn here. The model
 * does not read stage directions — it reads PUNCTUATION, and the difference
 * between "sounds like AI" and "sounds like a person" is usually a comma, an
 * ellipsis and a full stop in the right places. The same session that fixed the
 * missing `voice_settings` found that out: the model was never the problem.
 *
 * ── 🔴 EVERY ROW HERE WORKS ON EVERY MODEL WE RUN ───────────────────────────
 *
 * Deliberately punctuation ONLY. ElevenLabs v3 also understands inline audio
 * tags — `[laughs]`, `[whispers]` — and they are NOT documented here, because
 * the model is operator-configurable (Admin → AI → Text to Audio) and on v2
 * those tags are read aloud as literal words. A guide that teaches a member to
 * type `[whispers]` and have the voice say "open bracket whispers" is worse
 * than no guide: it produces a bad result AND spends their characters.
 *
 * If the tool is ever pinned to v3, tags become a second section — with the
 * model gate visible, not assumed.
 *
 * ── A DISCLOSURE, NOT A PANEL ───────────────────────────────────────────────
 *
 * §14 and §48: progressive disclosure, and do not make people scroll past
 * explanation to reach the action. It is a native `<details>` — no state, no
 * JavaScript for the toggle, keyboard-operable for free, and closed by default
 * so it costs one line of height to anybody who already knows this.
 */

interface Mark {
  mark: string;
  does: string;
  example: string;
}

/**
 * The dictionary.
 *
 * Ordered by how often it matters, not alphabetically: the first three fix most
 * robotic-sounding scripts on their own.
 */
const MARKS: Mark[] = [
  {
    mark: ",",
    does: "A short breath. The most under-used mark — speech has far more of these than writing.",
    example: "Look, I told you, it is fine.",
  },
  {
    mark: ".",
    does: "A full stop, and a real pause. Short sentences sound human; long ones run on.",
    example: "I tried. It did not work.",
  },
  {
    mark: "…",
    does: "Hesitation — the voice trails off and picks up again. Three dots, not a dash.",
    example: "I mean… maybe? I am not sure.",
  },
  {
    mark: "—",
    does: "An interruption. The line breaks off sharply instead of fading.",
    example: "Wait — that is not what I said.",
  },
  {
    mark: "?",
    does: "Lifts the end of the line. Works on fragments too, not just full questions.",
    example: "Right? You saw it as well?",
  },
  {
    mark: "!",
    does: "Raises energy across the whole sentence, not just the last word. Use sparingly.",
    example: "No way! That is brilliant!",
  },
  {
    mark: "CAPITALS",
    does: "Stress on one word. A whole sentence in capitals mostly reads as shouting.",
    example: "I said I would NEVER do that.",
  },
  {
    mark: '" "',
    does: "Marks speech inside narration, so the voice shifts between the two.",
    example: 'She said, "come back tomorrow."',
  },
  {
    mark: "Line break",
    does: "A longer beat than a full stop. Use it between paragraphs and scene changes.",
    example: "That was the plan.\n\nIt did not survive.",
  },
];

export function PunctuationGuide({ className }: { className?: string }) {
  return (
    <details className={cn("group rounded-2xl bg-secondary/40", className)}>
      <summary
        className={cn(
          // 44px, and `list-none` because Safari still draws its own marker.
          "flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-3.5 text-[13px] font-semibold",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        How punctuation changes the voice
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          aria-hidden
        />
      </summary>

      <div className="px-3.5 pb-3.5">
        <p className="mb-3 text-[12px] leading-snug text-muted-foreground">
          The voice reads your punctuation, not your instructions. These are the marks it responds to —
          getting the commas and pauses right is most of what makes a line sound spoken rather than read.
        </p>

        <dl className="space-y-2.5">
          {MARKS.map((m) => (
            <div key={m.mark} className="rounded-xl bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <dt className="flex items-baseline gap-2">
                <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[12.5px] font-bold text-primary">
                  {m.mark}
                </span>
                <span className="text-[12px] leading-snug text-foreground/70">{m.does}</span>
              </dt>
              {/*
                `whitespace-pre-line` so the line-break row can actually SHOW a
                line break rather than describing one.
              */}
              <dd className="mt-1.5 whitespace-pre-line border-l-2 border-primary/20 pl-2.5 text-[12.5px] italic leading-snug text-foreground/80">
                {m.example}
              </dd>
            </div>
          ))}
        </dl>

        <p className="mt-3 text-[11.5px] leading-snug text-muted-foreground">
          Write it the way you would say it out loud. If you would pause, put a mark there.
        </p>
      </div>
    </details>
  );
}
