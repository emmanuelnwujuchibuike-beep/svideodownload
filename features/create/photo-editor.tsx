"use client";

import { motion } from "framer-motion";
import { Check, FlipHorizontal2, Loader2, RotateCcw, RotateCw, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";

import {
  composeParams,
  FILTER_PRESETS,
  NEUTRAL_PARAMS,
  bakePhoto,
  previewStyles,
  type PhotoParams,
} from "@/lib/media/photo-adjust";
import { cn } from "@/lib/utils";

export interface PhotoEdit {
  manual: PhotoParams;
  presetId: string;
  intensity: number;
}

export const NEUTRAL_EDIT: PhotoEdit = { manual: NEUTRAL_PARAMS, presetId: "original", intensity: 1 };

const SLIDERS: { key: keyof PhotoParams; label: string; min: number; max: number; step: number }[] = [
  { key: "brightness", label: "Brightness", min: -0.3, max: 0.3, step: 0.01 },
  { key: "contrast", label: "Contrast", min: -0.3, max: 0.3, step: 0.01 },
  { key: "saturation", label: "Saturation", min: -1, max: 1, step: 0.02 },
  { key: "warmth", label: "Warmth", min: -0.35, max: 0.35, step: 0.01 },
  { key: "fade", label: "Fade", min: 0, max: 0.3, step: 0.01 },
  { key: "vignette", label: "Vignette", min: 0, max: 0.5, step: 0.01 },
];

/**
 * The Studio photo editor — non-destructive: the edit is a parameter object
 * over the ORIGINAL file, so reopening the editor resumes exactly where you
 * left off and nothing is lost between sessions. Preview is pure GPU (CSS
 * filter + blend overlays, instant at any image size); Apply bakes once.
 * Press-and-hold the image to compare with the original.
 */
export function PhotoEditor({
  src,
  original,
  initial,
  onCancel,
  onApply,
}: {
  /** Object URL of the ORIGINAL image (edits always derive from it). */
  src: string;
  original: Blob;
  initial: PhotoEdit;
  onCancel: () => void;
  onApply: (result: { blob: Blob; edit: PhotoEdit }) => void;
}) {
  const [tab, setTab] = useState<"filters" | "adjust">("filters");
  const [manual, setManual] = useState<PhotoParams>(initial.manual);
  const [presetId, setPresetId] = useState(initial.presetId);
  const [intensity, setIntensity] = useState(initial.intensity);
  const [comparing, setComparing] = useState(false);
  const [saving, setSaving] = useState(false);

  const preset = FILTER_PRESETS.find((f) => f.id === presetId) ?? FILTER_PRESETS[0]!;
  const params = useMemo(() => composeParams(manual, preset, intensity), [manual, preset, intensity]);
  const view = previewStyles(comparing ? NEUTRAL_PARAMS : params);

  const isNeutral =
    presetId === "original" &&
    JSON.stringify({ ...manual, rotate: 0, flipH: false }) === JSON.stringify({ ...NEUTRAL_PARAMS, rotate: 0, flipH: false }) &&
    manual.rotate === 0 &&
    !manual.flipH;

  const apply = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const blob = await bakePhoto(original, params);
      onApply({ blob, edit: { manual, presetId, intensity } });
    } catch {
      onCancel();
    } finally {
      setSaving(false);
    }
  };

  const setParam = (key: keyof PhotoParams, value: number) => setManual((m) => ({ ...m, [key]: value }));

  return (
    <motion.div key="editor" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3 pt-1">
      {/* Preview — hold to compare with the original */}
      <div
        className="relative touch-none select-none overflow-hidden rounded-3xl bg-neutral-950 ring-1 ring-white/10"
        onPointerDown={() => setComparing(true)}
        onPointerUp={() => setComparing(false)}
        onPointerLeave={() => setComparing(false)}
      >
        <div className="relative mx-auto max-h-72 w-full" style={{ transform: view.transform }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" draggable={false} className="max-h-72 w-full object-contain" style={{ filter: view.filter }} />
          {/* Warmth / fade / vignette overlays — match the bake visually */}
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-[#ff8a4c] mix-blend-soft-light" style={{ opacity: view.warmOpacity }} />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-[#4c94ff] mix-blend-soft-light" style={{ opacity: view.coolOpacity }} />
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-white" style={{ opacity: view.fadeOpacity }} />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ opacity: view.vignetteOpacity, background: "radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,0.75) 100%)" }}
          />
        </div>
        <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-lg bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur">
          {comparing ? "Original" : "Hold to compare"}
        </span>
      </div>

      {/* Orientation + reset */}
      <div className="flex items-center justify-center gap-2">
        <ToolButton icon={RotateCw} label="Rotate" onClick={() => setManual((m) => ({ ...m, rotate: (m.rotate + 90) % 360 }))} />
        <ToolButton icon={FlipHorizontal2} label="Flip" active={manual.flipH} onClick={() => setManual((m) => ({ ...m, flipH: !m.flipH }))} />
        <ToolButton
          icon={RotateCcw}
          label="Reset"
          disabled={isNeutral}
          onClick={() => {
            setManual(NEUTRAL_PARAMS);
            setPresetId("original");
            setIntensity(1);
          }}
        />
      </div>

      {/* Filters | Adjust */}
      <div className="flex items-center justify-center gap-1 rounded-2xl bg-secondary/40 p-1">
        {(
          [
            { id: "filters" as const, label: "Filters", icon: Sparkles },
            { id: "adjust" as const, label: "Adjust", icon: SlidersHorizontal },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-semibold transition",
              tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "filters" ? (
        <div>
          <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTER_PRESETS.map((f) => {
              const thumb = previewStyles(composeParams(NEUTRAL_PARAMS, f, 1));
              const active = presetId === f.id;
              return (
                <button key={f.id} type="button" onClick={() => setPresetId(f.id)} aria-pressed={active} className="shrink-0 text-center">
                  <span
                    className={cn(
                      "relative block h-16 w-16 overflow-hidden rounded-2xl ring-2 transition",
                      active ? "ring-violet-500" : "ring-transparent",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" draggable={false} className="h-full w-full object-cover" style={{ filter: thumb.filter }} />
                    <span aria-hidden className="pointer-events-none absolute inset-0 bg-[#ff8a4c] mix-blend-soft-light" style={{ opacity: thumb.warmOpacity }} />
                    <span aria-hidden className="pointer-events-none absolute inset-0 bg-[#4c94ff] mix-blend-soft-light" style={{ opacity: thumb.coolOpacity }} />
                  </span>
                  <span className={cn("mt-1 block w-16 truncate text-[10px] font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                    {f.label}
                  </span>
                </button>
              );
            })}
          </div>
          {presetId !== "original" ? (
            <label className="mt-2 flex items-center gap-3 text-xs font-medium text-muted-foreground">
              Intensity
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={intensity}
                onChange={(e) => setIntensity(Number(e.target.value))}
                className="h-1.5 flex-1 accent-violet-500"
                aria-label="Filter intensity"
              />
              <span className="w-8 text-right tabular-nums">{Math.round(intensity * 100)}</span>
            </label>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2.5">
          {SLIDERS.map((s) => (
            <label key={s.key} className="flex items-center gap-3 text-xs font-medium text-muted-foreground">
              <span className="w-20 shrink-0">{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={manual[s.key] as number}
                onChange={(e) => setParam(s.key, Number(e.target.value))}
                className="h-1.5 flex-1 accent-violet-500"
                aria-label={s.label}
              />
              <span className="w-8 text-right tabular-nums">
                {Math.round(((manual[s.key] as number) / (s.max === s.min ? 1 : s.max)) * 100)}
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={apply}
          disabled={saving}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95 active:scale-[0.99] disabled:opacity-60"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? "Applying…" : "Apply"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-3 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
      </div>
    </motion.div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  active,
  disabled,
}: {
  icon: typeof RotateCw;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2 text-xs font-semibold transition hover:bg-secondary active:scale-95 disabled:opacity-40",
        active && "border-violet-500/50 text-violet-500",
      )}
    >
      <Icon className="h-4 w-4" /> {label}
    </button>
  );
}
