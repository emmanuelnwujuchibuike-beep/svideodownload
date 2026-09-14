"use client";

import { Check, PersonStanding, ScanFace, UserRound } from "lucide-react";
import { useId } from "react";

import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { ReplacementMode } from "@/lib/ai/character-replace/modes";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REPLACEMENT TYPE — Face Only · Skin + Face · Full Character
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Face Only brief §1–§2: "Add a clean selector before processing… Replacement
 * Type: [ Face Only ] [ Skin + Face ] [ Full Character ]." Drawn from the
 * server's public config — every row is one the operator has on, with the
 * copy from lib/ai/character-replace/modes.ts — and the one sentence the
 * brief requires (§9 / Skin + Face §11) sits under the chosen card: what
 * changes, what is kept "wherever possible", never "pixel-perfect".
 *
 * A mode the operator switched off is drawn disabled with "Not available
 * right now" rather than hidden, so the member sees the whole product and
 * nothing silently disappears.
 */
export function ReplacementModeSelector({
  mode,
  config,
  onChange,
  className,
}: {
  mode: ReplacementMode;
  config: CharacterReplacePublicConfig | null;
  onChange: (mode: ReplacementMode) => void;
  className?: string;
}) {
  const id = useId();
  const modes = config?.modes ?? [];
  const chosen = modes.find((m) => m.id === mode) ?? null;
  return (
    <section aria-labelledby={`${id}-title`} className={className}>
      <h3 id={`${id}-title`} className="text-[15px] font-bold tracking-[-0.01em]">
        Replacement type
      </h3>
      <div role="radiogroup" aria-labelledby={`${id}-title`} className="mt-3 grid gap-2 sm:grid-cols-3">
        {(modes.length ? modes : FALLBACK).map((m) => {
          const active = m.id === mode;
          // Owner, 2026-09-14: a FULL-BODY figure for Full Character — it is the whole person that goes in.
          const Icon = m.id === "face_only" ? ScanFace : m.id === "skin_face" ? UserRound : PersonStanding;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!m.enabled}
              onClick={() => onChange(m.id)}
              className={cn(
                "relative flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition sm:flex-col sm:gap-2",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                "disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-foreground bg-card shadow-[0_12px_28px_-18px_rgba(15,23,42,0.6)]"
                  : "border-border/70 bg-card hover:border-foreground/30",
              )}
            >
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", active ? "bg-gradient-to-br from-blue-600 via-indigo-500 to-fuchsia-500 text-white" : "bg-secondary text-foreground/80")}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[14.5px] font-bold">
                  {m.label}
                  {active ? <Check className="h-3.5 w-3.5 text-primary" strokeWidth={3} aria-hidden /> : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">{m.tagline}</span>
                {!m.enabled ? (
                  <span className="mt-1.5 inline-block rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Not available right now</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {chosen ? (
        <p className="mt-3 rounded-2xl border border-border/60 bg-secondary/40 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground" aria-live="polite">
          {chosen.explanation}
        </p>
      ) : null}
    </section>
  );
}

/** Drawn before the config answers — labels only, nothing selectable but the default. */
const FALLBACK: CharacterReplacePublicConfig["modes"] = [
  { id: "face_only", label: "Face Only", tagline: "Swap the face. Keep the body, clothes and scene.", explanation: "", enabled: false, tiers: [], defaultTier: null, maximumDurationSeconds: 60, maximumUploadBytes: 0, maximumPixels: 0, maximumReferenceImages: 1 },
  { id: "skin_face", label: "Skin + Face", tagline: "Bring the person's identity and skin. Keep the clothes and scene.", explanation: "", enabled: false, tiers: [], defaultTier: null, maximumDurationSeconds: 60, maximumUploadBytes: 0, maximumPixels: 0, maximumReferenceImages: 3 },
  { id: "full_character", label: "Full Character", tagline: "Replace the whole person — face, body and clothes.", explanation: "", enabled: true, tiers: [], defaultTier: null, maximumDurationSeconds: 60, maximumUploadBytes: 0, maximumPixels: 0, maximumReferenceImages: 1 },
];
