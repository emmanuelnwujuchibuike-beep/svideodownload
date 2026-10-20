"use client";

import { Cpu } from "lucide-react";

import { AiSettingRow } from "@/features/ai/design/ai-generate";
import { KLING_MODELS, KLING_OMNI_MODEL } from "@/lib/ai/kling/config";

/**
 * The "Model" row of the creation screens' Settings list (steps 18–19). The list is the real one — the
 * models the Kling seam will address (`KLING_MODELS`, lib/ai/kling/config.ts) — and the default is the real
 * default. Today that is Kling 3.0 Omni alone; a model added to that list (owner, 2026-10-19: Kling 4.0, once
 * its API is paid for and its id verified) needs a name here, and appears in the picker.
 *
 * Shown, not chosen: the generation request names no model of its own (the pipeline uses its configured one),
 * so the row reports the model and its picker offers exactly what can run.
 */
const MODEL_NAME: Record<string, string> = {
  [KLING_OMNI_MODEL]: "Kling 3.0 Omni",
};

export const VIDEO_MODEL_OPTIONS = KLING_MODELS.map((id) => ({ value: id, label: MODEL_NAME[id] ?? id }));

export function VideoModelRow({ disabled }: { disabled?: boolean }) {
  return <AiSettingRow icon={Cpu} label="Model" value={KLING_OMNI_MODEL} options={VIDEO_MODEL_OPTIONS} onChange={() => {}} disabled={disabled} />;
}
