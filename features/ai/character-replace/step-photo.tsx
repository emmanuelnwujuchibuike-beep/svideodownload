"use client";

import { RefreshCw, Trash2, UserRound } from "lucide-react";

import { CharacterReplaceMediaPicker } from "@/features/ai/character-replace/media-picker";
import type { CharacterAsset } from "@/lib/ai/character-replace/types";
import { AI_IMAGE_ACCEPT, AI_IMAGE_FORMAT_LINE, formatResolution, type AiMediaErrorCode } from "@/lib/ai/media";
import { formatBytes } from "@/lib/utils";

/**
 * Step 1 — the reference photo.
 *
 * Empty: the picker. Chosen: the photo, shown large enough to judge whether
 * the face is clear, with its facts and two actions — change it, or remove
 * it. The guidance under the picker is the owner's sentence, verbatim.
 */
export function CharacterReplacePhotoStep({
  asset,
  busy,
  error,
  onPick,
  onClear,
}: {
  asset: CharacterAsset | null;
  busy: boolean;
  error: AiMediaErrorCode | null;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  if (!asset) {
    return (
      <div>
        <CharacterReplaceMediaPicker
          kind="photo"
          accept={AI_IMAGE_ACCEPT}
          title="Upload your photo"
          hint="Use a clear photo with your face and upper body visible when possible."
          formats={AI_IMAGE_FORMAT_LINE}
          busy={busy}
          error={error}
          onPick={onPick}
        />
        <Guidance />
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-hidden rounded-[1.5rem] border border-border/70 bg-card">
        <div className="relative flex items-center justify-center bg-[#0b0f1a]">
          {/*
            A plain <img>, not next/image: this is a blob URL the browser
            already holds, and an optimiser would only re-fetch what it has.
          */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.objectUrl}
            alt="Your chosen photo"
            className="max-h-[min(60vh,28rem)] w-full object-contain"
          />
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
        <button
          type="button"
          onClick={onClear}
          className="btn-lux border border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Remove
        </button>
      </div>
      <Guidance />
    </div>
  );
}

function Guidance() {
  return (
    <ul className="mt-4 space-y-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
      <li className="flex gap-2">
        <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
        One person, facing the camera, in even light. Sunglasses and heavy filters make a likeness harder to carry across.
      </li>
      <li className="flex gap-2">
        <UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" aria-hidden />
        The photo stays on your device until you press Start.
      </li>
    </ul>
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
