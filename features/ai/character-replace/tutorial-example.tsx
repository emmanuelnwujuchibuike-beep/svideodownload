"use client";

import { Check, GraduationCap, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useId, useState } from "react";

import { REPLACEMENT_MODE_COPY, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import { haptic } from "@/lib/motion/haptics";
import { cn } from "@/lib/utils";

const GlassSheetShell = dynamic(() => import("@/features/ui/glass-sheet-shell").then((m) => m.GlassSheetShell), { ssr: false });

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  "VIEW TUTORIAL EXAMPLE" — what to upload for each model, drawn and animated
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-14: "create clear HD animated images on how to upload on
 * each of the AI models, put the example image in a button that is clear
 * that means view tutorial example for more perfect result."
 *
 * The examples are VECTOR illustrations — crisp at any pixel density, a few
 * kilobytes, animated with CSS only (a framing guide draws itself and the
 * good/avoid marks land), paused under reduced motion. They show framing,
 * not a person: no stock face is borrowed and nothing pretends to be a
 * member's photo. Each mode gets its own pair for the PHOTO and one for the
 * VIDEO, with the sentence under each saying why.
 */
export function CharacterReplaceTutorialButton({ mode, kind, className }: { mode: ReplacementMode; kind: "photo" | "video"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const label = REPLACEMENT_MODE_COPY[mode].label;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          haptic("selection");
          setMounted(true);
          setOpen(true);
        }}
        className={cn(
          "inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/50 bg-primary/[0.05] px-4 text-[13.5px] font-bold text-primary transition hover:bg-primary/[0.1] active:scale-[0.99]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      >
        <GraduationCap className="h-4 w-4" aria-hidden />
        View tutorial example — {kind === "photo" ? `the right photo for ${label}` : `the right video for ${label}`}
      </button>
      {mounted ? <CharacterReplaceTutorialSheet open={open} onClose={() => setOpen(false)} mode={mode} kind={kind} /> : null}
    </>
  );
}

function CharacterReplaceTutorialSheet({ open, onClose, mode, kind }: { open: boolean; onClose: () => void; mode: ReplacementMode; kind: "photo" | "video" }) {
  const copy = TUTORIALS[mode][kind];
  return (
    <GlassSheetShell open={open} onClose={onClose} title={copy.title} fitContent defaultHeightVh={88}>
      <div className="px-4 pb-8">
        <p className="text-[13px] leading-relaxed text-muted-foreground">{copy.intro}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Example tone="good" caption={copy.good.caption} points={copy.good.points}>
            {copy.good.art}
          </Example>
          <Example tone="avoid" caption={copy.avoid.caption} points={copy.avoid.points}>
            {copy.avoid.art}
          </Example>
        </div>
        <p className="mt-4 rounded-2xl bg-secondary/60 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">{copy.footer}</p>
      </div>
    </GlassSheetShell>
  );
}

function Example({ tone, caption, points, children }: { tone: "good" | "avoid"; caption: string; points: readonly string[]; children: React.ReactNode }) {
  return (
    <figure className={cn("overflow-hidden rounded-[1.25rem] border-2", tone === "good" ? "border-emerald-500/60" : "border-rose-500/50")}>
      <div className="relative bg-[#0b0f1a]">
        {children}
        <span
          className={cn(
            "absolute left-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.08em] text-white",
            tone === "good" ? "bg-emerald-600" : "bg-rose-600",
          )}
        >
          {tone === "good" ? <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> : <X className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />}
          {tone === "good" ? "Do this" : "Avoid this"}
        </span>
      </div>
      <figcaption className="px-3.5 py-3">
        <p className={cn("text-[13.5px] font-bold", tone === "good" ? "text-emerald-700 dark:text-emerald-300" : "text-rose-600 dark:text-rose-300")}>{caption}</p>
        <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-muted-foreground">
          {points.map((p) => (
            <li key={p} className="flex gap-1.5">
              <span aria-hidden className={cn("mt-[7px] h-1 w-1 shrink-0 rounded-full", tone === "good" ? "bg-emerald-500" : "bg-rose-500")} />
              {p}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

/* ───────────────────────────── the drawings ──────────────────────────────── */

/**
 * A phone-shaped frame with a figure inside. `figure` chooses the framing;
 * the guide (dashed) draws itself in, and a soft highlight sweeps once —
 * enough motion to read as "this is how to frame it", none under reduced
 * motion (globals.css `.cr-tut-*`).
 */
function Art({ figure, dim = false, children }: { figure: "full" | "face" | "crop" | "side" | "group" | "video-full" | "video-cut"; dim?: boolean; children?: React.ReactNode }) {
  const id = useId();
  return (
    <svg viewBox="0 0 240 320" role="img" aria-hidden className="block h-auto w-full">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2340" />
          <stop offset="1" stopColor="#0b0f1a" />
        </linearGradient>
        <linearGradient id={`${id}-skin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f2c9a8" />
          <stop offset="1" stopColor="#c98e6b" />
        </linearGradient>
        <linearGradient id={`${id}-shirt`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6d8dff" />
          <stop offset="1" stopColor="#c05cff" />
        </linearGradient>
        <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="240" height="320" fill={`url(#${id}-bg)`} />
      {/* the phone frame */}
      <rect x="28" y="14" width="184" height="292" rx="22" fill="#0b0f1a" stroke="#2b3556" strokeWidth="3" />
      <rect x="36" y="22" width="168" height="276" rx="16" fill="#111a2f" />
      <g opacity={dim ? 0.55 : 1}>
        {figure === "full" ? <FullFigure id={id} /> : null}
        {figure === "face" ? <FaceFigure id={id} /> : null}
        {figure === "crop" ? <CropFigure id={id} /> : null}
        {figure === "side" ? <SideFigure id={id} /> : null}
        {figure === "group" ? <GroupFigure id={id} /> : null}
        {figure === "video-full" ? <FullFigure id={id} /> : null}
        {figure === "video-cut" ? <CutFigure id={id} /> : null}
      </g>
      {children}
      {/* the framing guide draws itself */}
      <rect x="44" y="30" width="152" height="260" rx="12" fill="none" stroke="#7dd3fc" strokeWidth="2" strokeDasharray="8 6" className="cr-tut-guide" />
      {/* the sweep */}
      <rect x="36" y="22" width="168" height="276" rx="16" fill={`url(#${id}-sweep)`} className="cr-tut-sweep" />
      {figure.startsWith("video") ? (
        <g className="cr-tut-rec">
          <circle cx="60" cy="46" r="5" fill="#ef4444" />
          <text x="70" y="50" fontSize="11" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
            REC
          </text>
        </g>
      ) : null}
    </svg>
  );
}

/** Head to feet, centred, facing the camera. */
function FullFigure({ id }: { id: string }) {
  return (
    <g>
      <circle cx="120" cy="78" r="22" fill={`url(#${id}-skin)`} />
      <rect x="92" y="104" width="56" height="80" rx="16" fill={`url(#${id}-shirt)`} />
      <rect x="78" y="112" width="16" height="64" rx="8" fill={`url(#${id}-skin)`} />
      <rect x="146" y="112" width="16" height="64" rx="8" fill={`url(#${id}-skin)`} />
      <rect x="96" y="184" width="20" height="82" rx="9" fill="#2f3b66" />
      <rect x="124" y="184" width="20" height="82" rx="9" fill="#2f3b66" />
      <rect x="92" y="262" width="26" height="12" rx="6" fill="#0f172a" />
      <rect x="122" y="262" width="26" height="12" rx="6" fill="#0f172a" />
      {/* a light on the face */}
      <circle cx="112" cy="72" r="6" fill="#fff" opacity="0.25" />
    </g>
  );
}

/** The face filling most of the frame, straight on. */
function FaceFigure({ id }: { id: string }) {
  return (
    <g>
      <rect x="60" y="230" width="120" height="70" rx="30" fill={`url(#${id}-shirt)`} />
      <rect x="100" y="196" width="40" height="46" rx="14" fill={`url(#${id}-skin)`} />
      <ellipse cx="120" cy="140" rx="58" ry="70" fill={`url(#${id}-skin)`} />
      <ellipse cx="97" cy="132" rx="8" ry="5" fill="#1f2937" />
      <ellipse cx="143" cy="132" rx="8" ry="5" fill="#1f2937" />
      <path d="M100 170 Q120 186 140 170" stroke="#7f3b2f" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M78 96 Q120 60 162 96" stroke="#2a1b12" strokeWidth="18" fill="none" strokeLinecap="round" />
      <circle cx="104" cy="112" r="10" fill="#fff" opacity="0.2" />
    </g>
  );
}

/** A face crop where a full figure was wanted — the body is missing. */
function CropFigure({ id }: { id: string }) {
  return (
    <g>
      <ellipse cx="120" cy="150" rx="62" ry="74" fill={`url(#${id}-skin)`} />
      <ellipse cx="96" cy="142" rx="8" ry="5" fill="#1f2937" />
      <ellipse cx="144" cy="142" rx="8" ry="5" fill="#1f2937" />
      <path d="M100 182 Q120 196 140 182" stroke="#7f3b2f" strokeWidth="4" fill="none" strokeLinecap="round" />
      {/* sunglasses + hat: the things that hide the face */}
      <rect x="78" y="128" width="36" height="20" rx="8" fill="#0f172a" />
      <rect x="126" y="128" width="36" height="20" rx="8" fill="#0f172a" />
      <path d="M62 96 Q120 40 178 96 L 186 100 L 54 100 Z" fill="#334155" />
      <text x="120" y="290" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fda4af" fontFamily="system-ui, sans-serif">
        no body · hat · sunglasses
      </text>
    </g>
  );
}

/** A face turned away, small in the frame, dark. */
function SideFigure({ id }: { id: string }) {
  return (
    <g>
      <rect x="36" y="22" width="168" height="276" rx="16" fill="#0a0d18" />
      <ellipse cx="150" cy="150" rx="26" ry="32" fill={`url(#${id}-skin)`} opacity="0.7" />
      <path d="M176 140 Q184 150 176 162" stroke="#7f3b2f" strokeWidth="3" fill="none" />
      <path d="M126 130 Q150 100 174 128" stroke="#2a1b12" strokeWidth="12" fill="none" strokeLinecap="round" />
      <text x="120" y="290" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fda4af" fontFamily="system-ui, sans-serif">
        turned away · small · dark
      </text>
    </g>
  );
}

/** Two people in one frame — the model cannot know which one. */
function GroupFigure({ id }: { id: string }) {
  return (
    <g>
      <circle cx="86" cy="96" r="20" fill={`url(#${id}-skin)`} />
      <rect x="62" y="120" width="48" height="70" rx="14" fill={`url(#${id}-shirt)`} />
      <circle cx="156" cy="100" r="20" fill={`url(#${id}-skin)`} />
      <rect x="132" y="124" width="48" height="70" rx="14" fill="#475569" />
      <rect x="66" y="188" width="18" height="70" rx="8" fill="#2f3b66" />
      <rect x="88" y="188" width="18" height="70" rx="8" fill="#2f3b66" />
      <rect x="136" y="192" width="18" height="66" rx="8" fill="#2f3b66" />
      <rect x="158" y="192" width="18" height="66" rx="8" fill="#2f3b66" />
      <text x="120" y="290" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fda4af" fontFamily="system-ui, sans-serif">
        two people · which one?
      </text>
    </g>
  );
}

/** A video where the person is cut off by the edge and the camera shakes. */
function CutFigure({ id }: { id: string }) {
  return (
    <g>
      <g transform="translate(70 0) skewX(-6)">
        <circle cx="120" cy="78" r="22" fill={`url(#${id}-skin)`} opacity="0.8" />
        <rect x="92" y="104" width="56" height="80" rx="16" fill={`url(#${id}-shirt)`} opacity="0.8" />
        <rect x="96" y="184" width="20" height="82" rx="9" fill="#2f3b66" opacity="0.8" />
      </g>
      <text x="120" y="290" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fda4af" fontFamily="system-ui, sans-serif">
        cut off · shaky · blurred
      </text>
    </g>
  );
}

/* ───────────────────────────── the copy ──────────────────────────────────── */

interface TutorialCopy {
  title: string;
  intro: string;
  good: { art: React.ReactNode; caption: string; points: readonly string[] };
  avoid: { art: React.ReactNode; caption: string; points: readonly string[] };
  footer: string;
}

const TUTORIALS: Record<ReplacementMode, Record<"photo" | "video", TutorialCopy>> = {
  full_character: {
    photo: {
      title: "The right photo for Full Character",
      intro: "Full Character puts the WHOLE person from your photo into the video — face, body and clothes. The photo decides how the character looks; the video decides how they move.",
      good: {
        art: <Art figure="full" />,
        caption: "Full body, facing the camera",
        points: ["Head to feet inside the frame, standing straight.", "Wearing the clothes you want in the video.", "Plain background, even light, no filter."],
      },
      avoid: {
        art: <Art figure="crop" dim />,
        caption: "A selfie or a face crop",
        points: ["The model has to invent a body and an outfit.", "A hat or sunglasses hide what it needs most.", "Group photos: it cannot know who you mean."],
      },
      footer: "A beach selfie will put a beach outfit into a kitchen video — the whole look carries across. For a face-only change, choose Face Only instead.",
    },
    video: {
      title: "The right video for Full Character",
      intro: "The person in the video is replaced from head to toe, so the video must show that person clearly.",
      good: {
        art: <Art figure="video-full" />,
        caption: "One person, whole body, steady",
        points: ["The person in frame the whole time, not cut off.", "Steady camera, good light, body visible.", "Short: trim to the part that matters. Choose 720p."],
      },
      avoid: {
        art: <Art figure="video-cut" dim />,
        caption: "Cut off, shaky, crowded",
        points: ["Fast cuts and motion blur confuse the tracking.", "Mirrors and crowds add people the model may pick.", "Very dark scenes lose the body's edges."],
      },
      footer: "480p renders the whole video at a lower resolution and faces come out softer — 720p is the clean choice.",
    },
  },
  face_only: {
    photo: {
      title: "The right photo for Face Only",
      intro: "Face Only swaps just the face. The body, clothes, background and camera of the video stay as they are, so the photo only needs to give a clear face.",
      good: {
        art: <Art figure="face" />,
        caption: "A clear, front-facing face",
        points: ["The face fills most of the frame — a good selfie is ideal.", "Looking at the camera, even light on the face.", "No sunglasses, no hat, nothing over the mouth."],
      },
      avoid: {
        art: <Art figure="side" dim />,
        caption: "Turned away, tiny or dark",
        points: ["A profile view gives the model half a face.", "A small or blurry face gives a blurry swap.", "Heavy filters change the features it copies."],
      },
      footer: "Only the face is used. If you want your clothes and body in the video too, choose Full Character.",
    },
    video: {
      title: "The right video for Face Only",
      intro: "The face in the video is replaced frame by frame, so the face must be easy to find in every frame.",
      good: {
        art: <Art figure="video-full" />,
        caption: "Face towards the camera, well lit",
        points: ["One person, face visible most of the time.", "Steady camera; the face not too small.", "Short: trim to the part that matters."],
      },
      avoid: {
        art: <Art figure="video-cut" dim />,
        caption: "Hidden, sideways or blurred faces",
        points: ["Hands over the face and hard profiles break the swap.", "Fast motion blur smears the result.", "Deep shadow hides the features."],
      },
      footer: "The body, clothes and scene stay exactly as they are in your video.",
    },
  },
  skin_face: {
    photo: {
      title: "The right photos for Skin + Face",
      intro: "Skin + Face brings the person's identity and skin into the video while keeping the video's clothes and scene. One to three photos of the SAME person work best.",
      good: {
        art: <Art figure="face" />,
        caption: "1–3 clear photos of one person",
        points: ["Face clearly visible in every photo; different angles help.", "Some neck, arms or shoulders so the skin tone carries across.", "Good light, sharp, no filters."],
      },
      avoid: {
        art: <Art figure="group" dim />,
        caption: "Different people, or hidden faces",
        points: ["Photos of two people mix two identities.", "Sunglasses and hats hide the face.", "Heavy filters change the skin the model copies."],
      },
      footer: "The clothes, logos and text in the video stay wherever the model can keep them — it is generative, so small changes can still happen.",
    },
    video: {
      title: "The right video for Skin + Face",
      intro: "The person's face and exposed skin are re-rendered across the whole clip, so the person must be clearly visible.",
      good: {
        art: <Art figure="video-full" />,
        caption: "One person, clearly visible, steady",
        points: ["Face visible most of the time, good light.", "Steady camera, the person not cut off.", "Short: trim to the part that matters."],
      },
      avoid: {
        art: <Art figure="video-cut" dim />,
        caption: "Crowds, mirrors, fast cuts",
        points: ["Extra people give the model extra faces.", "Mirrors duplicate the person.", "Very dark scenes lose skin detail."],
      },
      footer: "Clothing, logos and text stay as they are wherever technically possible.",
    },
  },
};
