"use client";

/**
 * One tutorial step: its art, its title, its sentence.
 *
 * ── Why the art is inline SVG and not an image ────────────────────────────────
 *
 * Four illustrations would be four network requests on a screen that opens
 * automatically on a first visit — on the mobile connection the brief is written
 * for, that is the difference between the sheet arriving with its content and
 * arriving empty. These are a few hundred bytes each, they inherit the theme
 * (every colour is a token, so light and dark are correct with no second asset),
 * and they scale to any screen without a srcset.
 *
 * ── They are diagrams, not decoration ─────────────────────────────────────────
 *
 * Each one shows the actual mechanism of its step — text on a frame being
 * lifted, a file entering, a before/after split, a finished clip with a save
 * action — because an abstract gradient blob would take the same space and teach
 * nothing. They are `aria-hidden`: the step's heading and sentence carry the
 * meaning, and describing a decorative diagram twice is noise for a screen
 * reader, not access.
 */

export type AICleanTutorialArt = "clean" | "add" | "detect" | "save";

export interface AICleanTutorialStepDef {
  id: string;
  title: string;
  description: string;
  art: AICleanTutorialArt;
}

/**
 * The four steps, in the owner's order and words.
 *
 * 🔴 Step 3's sentence is the careful one. It says Frenz AI "detects visible
 * text and reconstructs the area underneath" — what the tool attempts. It does
 * not promise the result is invisible, because no inpainting model is perfect on
 * every clip and a tutorial that oversells is a support ticket with a delay on
 * it. The brief says so explicitly: "Do NOT claim perfect results."
 */
export const AI_CLEAN_TUTORIAL_STEPS: readonly AICleanTutorialStepDef[] = [
  {
    id: "meet",
    title: "Meet Frenz AI Clean",
    description: "Remove unwanted captions, subtitles and text overlays from your videos with AI.",
    art: "clean",
  },
  {
    id: "add",
    title: "Add your video",
    description: "Upload a video or provide a supported video source to get started.",
    art: "add",
  },
  {
    id: "detect",
    title: "AI does the cleanup",
    description: "Frenz AI detects visible text and intelligently reconstructs the area underneath it.",
    art: "detect",
  },
  {
    id: "save",
    title: "Preview and save",
    description: "Review the cleaned video and download your result when it's ready.",
    art: "save",
  },
];

export function AICleanTutorialStep({
  step,
  titleId,
  descriptionId,
}: {
  step: AICleanTutorialStepDef;
  /** The dialog's `aria-labelledby` target — one heading, re-used per step. */
  titleId: string;
  descriptionId: string;
}) {
  return (
    <div>
      <div className="mx-auto w-full max-w-[320px] overflow-hidden rounded-2xl bg-secondary/40 p-3">
        <StepArt art={step.art} />
      </div>

      <h2 id={titleId} className="mt-5 text-xl font-bold tracking-[-0.02em]">
        {step.title}
      </h2>
      <p id={descriptionId} className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {step.description}
      </p>
    </div>
  );
}

function StepArt({ art }: { art: AICleanTutorialArt }) {
  return (
    <svg viewBox="0 0 300 150" role="presentation" aria-hidden className="h-auto w-full">
      <defs>
        {/*
          🔴 `gradientUnits="userSpaceOnUse"`, not the default.

          The default resolves gradient coordinates against each shape's own
          bounding box — and an SVG gradient is NOT RENDERED AT ALL when that box
          has zero width or height. Every vertical stroke below is exactly that:
          the before/after divider and both arrow stems silently disappeared,
          which is only visible in a screenshot, not in the markup. Pinned to the
          frame's coordinates instead, so one gradient paints every shape.
        */}
        <linearGradient id="frenz-ai-art" gradientUnits="userSpaceOnUse" x1="34" y1="18" x2="266" y2="132">
          <stop offset="0%" stopColor="hsl(var(--brand-blue))" />
          <stop offset="100%" stopColor="hsl(var(--brand-purple))" />
        </linearGradient>
      </defs>

      {/* The frame every step shares, so the four read as one clip moving through a process. */}
      <rect x="34" y="18" width="232" height="114" rx="14" className="fill-card stroke-border" strokeWidth="2" />

      {art === "clean" ? (
        <>
          {/* A caption bar, half of it already lifted away. */}
          <rect x="66" y="98" width="80" height="12" rx="6" className="fill-muted-foreground/70" />
          <rect x="152" y="98" width="52" height="12" rx="6" className="fill-muted-foreground/25" />
          <rect x="210" y="98" width="24" height="12" rx="6" className="fill-muted-foreground/10" />
          <path d="M150 42 l6 14 14 6 -14 6 -6 14 -6 -14 -14 -6 14 -6 z" fill="url(#frenz-ai-art)" />
        </>
      ) : null}

      {art === "add" ? (
        <>
          <path d="M150 96 V54" stroke="url(#frenz-ai-art)" strokeWidth="4" strokeLinecap="round" />
          <path d="M136 68 L150 54 L164 68" stroke="url(#frenz-ai-art)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x="112" y="100" width="76" height="10" rx="5" className="fill-muted-foreground/25" />
        </>
      ) : null}

      {art === "detect" ? (
        <>
          {/* Before on the left, after on the right, one divider between them. */}
          <rect x="52" y="88" width="72" height="11" rx="5.5" className="fill-muted-foreground/70" />
          <rect x="52" y="105" width="44" height="11" rx="5.5" className="fill-muted-foreground/70" />
          <rect x="52" y="46" width="72" height="26" rx="8" className="fill-transparent stroke-primary" strokeWidth="2" strokeDasharray="5 4" />
          {/* The same two lines on the "after" side, all but gone — which is the
              claim the step makes, drawn rather than described. */}
          <rect x="176" y="88" width="72" height="11" rx="5.5" className="fill-muted-foreground/10" />
          <rect x="176" y="105" width="44" height="11" rx="5.5" className="fill-muted-foreground/10" />
          <path d="M150 18 V132" stroke="url(#frenz-ai-art)" strokeWidth="2" />
          <circle cx="150" cy="75" r="12" fill="url(#frenz-ai-art)" />
          <path d="M144 75 h12 M150 69 v12" stroke="hsl(var(--card))" strokeWidth="2" strokeLinecap="round" />
        </>
      ) : null}

      {art === "save" ? (
        <>
          <circle cx="150" cy="66" r="22" fill="url(#frenz-ai-art)" />
          <path d="M144 57 l16 9 -16 9 z" className="fill-white" />
          {/* The stem has to clear the chevron or the two overlap into a bare
              tick — it read as one on the first screenshot pass. */}
          <path d="M150 96 v26" stroke="url(#frenz-ai-art)" strokeWidth="4" strokeLinecap="round" />
          <path d="M138 110 L150 122 L162 110" stroke="url(#frenz-ai-art)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      ) : null}
    </svg>
  );
}
