"use client";

import { Plus, RefreshCw, Trash2, UserRound, X } from "lucide-react";

import { CharacterReplaceInputDirection } from "@/features/ai/character-replace/input-direction";
import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import { ReplacementModeSelector } from "@/features/ai/character-replace/mode-selector";
import { CharacterReplaceTutorialButton } from "@/features/ai/character-replace/tutorial-example";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import { REPLACEMENT_MODE_COPY, type ReplacementMode } from "@/lib/ai/character-replace/modes";
import type { AssetSlot, CharacterAsset } from "@/lib/ai/character-replace/types";
import { AI_IMAGE_ACCEPT, AI_IMAGE_FORMAT_LINE, formatResolution, type AiMediaErrorCode } from "@/lib/ai/media";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Step 1 — the replacement type, and the reference photo(s) it needs.
 *
 * Part 6: the mode selector sits above the picker because it decides what
 * the picker asks for. Face Only wants one clear face (a selfie is fine);
 * Skin + Face wants one to three photos of the same person; Full Character
 * wants the whole person. Empty: the picker with that mode's hint. Chosen:
 * the photo, shown large enough to judge, with its facts and two actions —
 * change it, or remove it — and, for Skin + Face, the extra references as
 * small tiles with an "add" tile up to the operator's maximum.
 */
export function CharacterReplacePhotoStep({
  mode,
  config,
  asset,
  references,
  maxReferences,
  slot,
  onMode,
  onPick,
  onClear,
  onAddReference,
  onRemoveReference,
}: {
  mode: ReplacementMode;
  config: CharacterReplacePublicConfig | null;
  asset: CharacterAsset | null;
  references: readonly CharacterAsset[];
  maxReferences: number;
  /** The picker's state machine (Part 2, §2): empty · validating · uploading · ready · invalid · error. */
  slot: AssetSlot;
  onMode: (mode: ReplacementMode) => void;
  onPick: (file: File) => void;
  onClear: () => void;
  onAddReference: (file: File) => void;
  onRemoveReference: (index: number) => void;
}) {
  const busy = slot.status === "validating" || slot.status === "uploading";
  const error = slot.status === "invalid" || slot.status === "error" ? (slot.code as AiMediaErrorCode) : null;
  const copy = REPLACEMENT_MODE_COPY[mode];
  const multi = mode === "skin_face" && maxReferences > 1;

  return (
    <div className="space-y-6">
      <ReplacementModeSelector mode={mode} config={config} onChange={onMode} />

      {/* the owner's red direction (2026-09-14): the exact kind of photo this mode wants, and the drawn example */}
      <div className="space-y-2">
        <CharacterReplaceInputDirection kind="photo" mode={mode} />
        <CharacterReplaceTutorialButton kind="photo" mode={mode} />
      </div>

      <section>
        <h3 className="text-[15px] font-bold tracking-[-0.01em]">{copy.reference.title}</h3>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{copy.reference.hint}</p>

        {!asset ? (
          <div className="mt-3">
            <CharacterReplaceMediaPicker
              kind="photo"
              accept={AI_IMAGE_ACCEPT}
              title={mode === "face_only" ? "Upload a face photo" : mode === "skin_face" ? "Upload an identity photo" : "Upload your photo"}
              hint={copy.reference.hint}
              formats={AI_IMAGE_FORMAT_LINE}
              busy={busy}
              error={error}
              onPick={onPick}
            />
          </div>
        ) : (
          <div className="mt-3">
            <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card">
              <div className="relative flex items-center justify-center bg-[#0b0f1a]">
                {/*
                  A plain <img>, not next/image: this is a blob URL the browser
                  already holds, and an optimiser would only re-fetch what it has.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.objectUrl} alt="Your chosen photo" className="max-h-[min(60vh,28rem)] w-full object-contain" />
              </div>
              <dl className="grid grid-cols-3 divide-x divide-border/60 border-t border-border/60">
                <Fact label="Photo" value={asset.name} truncate />
                <Fact label="Size" value={formatBytes(asset.size)} />
                <Fact label="Pixels" value={formatResolution(asset.width, asset.height) ?? "—"} />
              </dl>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="btn-lux cursor-pointer border border-border/70 bg-card text-foreground hover:border-foreground/25">
                <RefreshCw className="h-4 w-4" aria-hidden />
                Change photo
                <input
                  type="file"
                  accept={AI_IMAGE_ACCEPT}
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onPick(f);
                    e.target.value = "";
                  }}
                />
              </label>
              <button type="button" onClick={onClear} className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground">
                <Trash2 className="h-4 w-4" aria-hidden />
                Remove
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Skin + Face: more of the same person (§3) ─────────────────────── */}
      {multi && asset ? (
        <section aria-label="More reference photos">
          <h3 className="text-[15px] font-bold tracking-[-0.01em]">More photos of the same person</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            Optional — up to {maxReferences} in total. Different angles help the identity stay consistent.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {references.map((r, i) => (
              <li key={r.objectUrl} className="relative h-24 w-24 overflow-hidden rounded-2xl border border-border/70 bg-[#0b0f1a]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.objectUrl} alt={`Reference photo ${i + 2}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemoveReference(i)}
                  aria-label={`Remove reference photo ${i + 2}`}
                  className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition hover:bg-black/80"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
            {references.length < maxReferences - 1 ? (
              <li>
                <label
                  className={cn(
                    "flex h-24 w-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-border bg-card text-[11.5px] font-semibold text-muted-foreground transition hover:border-foreground/40 hover:text-foreground",
                  )}
                >
                  <Plus className="h-5 w-5" aria-hidden />
                  Add photo
                  <input
                    type="file"
                    accept={AI_IMAGE_ACCEPT}
                    className="sr-only"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onAddReference(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      <Guidance lines={copy.reference.guidance} />
    </div>
  );
}

/**
 * Part 2, §3 — concise, no guarantees; the mode's own lines (Part 6).
 * Part 9 §3: folded under one line. The owner's red direction box above
 * the picker already says what matters; four more sentences under the
 * picker made a phone page twice as long as it needed to be.
 */
function Guidance({ lines }: { lines: readonly string[] }) {
  return (
    <details className="group rounded-2xl border border-border/60 bg-card/60 px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-foreground/85 [&::-webkit-details-marker]:hidden">
        <UserRound className="h-3.5 w-3.5 text-primary/70" aria-hidden />
        Tips for the best result
        <span className="ml-auto text-[11px] font-medium text-muted-foreground group-open:hidden">Show</span>
        <span className="ml-auto hidden text-[11px] font-medium text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <ul className="mt-2.5 space-y-1.5">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
            {line}
          </li>
        ))}
        <li className="flex gap-2">
          <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/60" />
          Your photos stay on your device until you press Create.
        </li>
      </ul>
    </details>
  );
}

function Fact({ label, value, truncate = false }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="min-w-0 px-3 py-2.5 text-center">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">{label}</dt>
      <dd className={truncate ? "mt-0.5 truncate text-[13px] font-semibold" : "mt-0.5 text-[13px] font-semibold tabular-nums"} title={truncate ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}
