import type { CharacterReplacePublicConfig, CharacterReplaceQualityId } from "@/lib/ai/character-replace/config";
import type {
  CharacterAsset,
  CharacterReplaceProject,
  PricingLine,
  PricingState,
  SourceVideo,
} from "@/lib/ai/character-replace/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — the workspace's state, as a pure reducer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every decision the workspace makes about its own draft lives here, with no
 * React and no DOM, so the whole flow — which step may be entered, what the
 * selected duration is, whether Start may be pressed — is testable without a
 * browser. The hook (features/ai/character-replace/use-character-replace-
 * workspace.ts) owns the side effects: decoding files, fetching the config
 * and the balance, revoking object URLs.
 *
 * ── The steps, in the owner's order ──────────────────────────────────────────
 *
 *   photo → video → settings → voice → review
 *
 * "Price", "Confirm" and "Start" (the owner's steps 5–7) are the review step:
 * the price, the balance, the consent line and the one button live together
 * on the screen where a member decides, because separating a price from the
 * button that spends it is how people get surprised.
 */

export type WorkspaceStep = "photo" | "video" | "settings" | "voice" | "review";

export const WORKSPACE_STEPS: readonly { id: WorkspaceStep; label: string; title: string }[] = [
  { id: "photo", label: "Photo", title: "Your photo" },
  { id: "video", label: "Video", title: "Your video" },
  { id: "settings", label: "Settings", title: "Output settings" },
  { id: "voice", label: "Voice", title: "Voice & language" },
  { id: "review", label: "Review", title: "Review & confirm" },
] as const;

export function stepIndex(step: WorkspaceStep): number {
  return WORKSPACE_STEPS.findIndex((s) => s.id === step);
}

export interface WorkspaceState {
  step: WorkspaceStep;
  project: CharacterReplaceProject;
  pricing: PricingState;
  /** Which picker is decoding a file right now, if any. */
  decoding: "photo" | "video" | null;
  /** The last refusal, per picker, in the media error vocabulary. */
  errors: { photo: string | null; video: string | null };
}

export const EMPTY_PROJECT: CharacterReplaceProject = {
  character: null,
  video: null,
  settings: { quality: "720p", trim: null },
  voice: { mode: "original", languageCode: null, voiceId: null },
  lipSync: { tier: null },
  consent: false,
};

export const INITIAL_STATE: WorkspaceState = {
  step: "photo",
  project: EMPTY_PROJECT,
  pricing: { status: "idle" },
  decoding: null,
  errors: { photo: null, video: null },
};

export type WorkspaceAction =
  | { type: "go"; step: WorkspaceStep }
  | { type: "decoding"; which: "photo" | "video" }
  | { type: "photo/set"; asset: CharacterAsset }
  | { type: "photo/clear" }
  | { type: "photo/error"; code: string }
  | { type: "video/set"; video: SourceVideo; maxDurationSeconds: number }
  | { type: "video/clear" }
  | { type: "video/error"; code: string }
  | { type: "quality"; quality: CharacterReplaceQualityId }
  | { type: "trim"; start: number; end: number }
  | { type: "trim/clear" }
  | { type: "voice/mode"; mode: "original" | "new_voice"; defaults: { languageCode: string | null; voiceId: string | null; tier: "standard" | "studio" | null } }
  | { type: "voice/language"; code: string }
  | { type: "voice/voice"; id: string }
  | { type: "lipsync/tier"; tier: "standard" | "studio" }
  | { type: "consent"; value: boolean }
  | { type: "pricing"; pricing: PricingState }
  | { type: "reset" };

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "go":
      return canEnterStep(state.project, action.step) ? { ...state, step: action.step } : state;
    case "decoding":
      return { ...state, decoding: action.which, errors: { ...state.errors, [action.which]: null } };
    case "photo/set":
      return {
        ...state,
        decoding: null,
        errors: { ...state.errors, photo: null },
        project: { ...state.project, character: action.asset },
      };
    case "photo/clear":
      return { ...state, decoding: null, project: { ...state.project, character: null } };
    case "photo/error":
      return { ...state, decoding: null, errors: { ...state.errors, photo: action.code }, project: { ...state.project, character: null } };
    case "video/set": {
      /*
        A video longer than the tool allows is not refused — it is accepted
        with the kept range pre-trimmed to the ceiling, so the member sees
        their video, sees the limit, and chooses which part to keep. The
        "continue" gate below holds until the kept range fits.
      */
      const duration = action.video.durationSeconds;
      const trim =
        duration !== null && duration > action.maxDurationSeconds ? { start: 0, end: action.maxDurationSeconds } : null;
      return {
        ...state,
        decoding: null,
        errors: { ...state.errors, video: null },
        pricing: markStale(state.pricing),
        project: { ...state.project, video: action.video, settings: { ...state.project.settings, trim } },
      };
    }
    case "video/clear":
      return {
        ...state,
        decoding: null,
        pricing: { status: "idle" },
        project: { ...state.project, video: null, settings: { ...state.project.settings, trim: null } },
      };
    case "video/error":
      return { ...state, decoding: null, errors: { ...state.errors, video: action.code }, project: { ...state.project, video: null } };
    case "quality":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, settings: { ...state.project.settings, quality: action.quality } } };
    case "trim": {
      const duration = state.project.video?.durationSeconds ?? null;
      const start = Math.max(0, Math.min(action.start, action.end));
      const end = duration === null ? Math.max(action.end, start) : Math.min(duration, Math.max(action.end, start));
      // Keeping the whole video is "no trim", not a trim of everything.
      const whole = start === 0 && duration !== null && end >= duration;
      return {
        ...state,
        pricing: markStale(state.pricing),
        project: { ...state.project, settings: { ...state.project.settings, trim: whole ? null : { start, end } } },
      };
    }
    case "trim/clear":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, settings: { ...state.project.settings, trim: null } } };
    case "voice/mode":
      return {
        ...state,
        pricing: markStale(state.pricing),
        project: {
          ...state.project,
          voice:
            action.mode === "original"
              ? { mode: "original", languageCode: null, voiceId: null }
              : { mode: "new_voice", languageCode: action.defaults.languageCode, voiceId: action.defaults.voiceId },
          lipSync: { tier: action.mode === "original" ? null : action.defaults.tier },
        },
      };
    case "voice/language":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, languageCode: action.code } } };
    case "voice/voice":
      return { ...state, project: { ...state.project, voice: { ...state.project.voice, voiceId: action.id } } };
    case "lipsync/tier":
      return { ...state, pricing: markStale(state.pricing), project: { ...state.project, lipSync: { tier: action.tier } } };
    case "consent":
      return { ...state, project: { ...state.project, consent: action.value } };
    case "pricing":
      return { ...state, pricing: action.pricing };
    case "reset":
      return INITIAL_STATE;
  }
}

/** A quote the inputs have moved away from is stale, not gone. */
function markStale(pricing: PricingState): PricingState {
  if (pricing.status === "quoted") return { status: "stale", snapshot: pricing.snapshot };
  return pricing;
}

/* ───────────────────────────── derived facts ─────────────────────────────── */

/** Seconds the job would process: the kept range, or the whole video. */
export function selectedDurationSeconds(project: CharacterReplaceProject): number | null {
  const duration = project.video?.durationSeconds ?? null;
  if (duration === null) return null;
  const trim = project.settings.trim;
  if (!trim) return duration;
  return Math.max(0, Math.min(duration, trim.end) - Math.max(0, trim.start));
}

/**
 * Seconds the member's trim has REMOVED — original minus kept. Zero with no
 * trim. The interface says "Trimmed by 4.0 sec" from it; what a further trim
 * would save in money is the pricing engine's sentence (§10), not this one's.
 */
export function trimmedSeconds(project: CharacterReplaceProject): number | null {
  const duration = project.video?.durationSeconds ?? null;
  const selected = selectedDurationSeconds(project);
  if (duration === null || selected === null) return null;
  return Math.max(0, duration - selected);
}

/**
 * Whether the kept range fits the tool. A video longer than the ceiling is
 * fine once trimmed; one that cannot be measured is refused here rather than
 * at the server, because the ceiling is a cost control and "unknown" must not
 * pass it.
 */
export function videoFits(project: CharacterReplaceProject, config: Pick<CharacterReplacePublicConfig, "maximumDurationSeconds" | "trim">): boolean {
  const selected = selectedDurationSeconds(project);
  if (selected === null) return false;
  if (selected > config.maximumDurationSeconds + 0.05) return false;
  if (selected < config.trim.minimumSeconds - 0.05) return false;
  return true;
}

/** Whether a step may be opened, given what has been provided so far. */
export function canEnterStep(project: CharacterReplaceProject, step: WorkspaceStep): boolean {
  switch (step) {
    case "photo":
      return true;
    case "video":
      return !!project.character;
    case "settings":
    case "voice":
    case "review":
      return !!project.character && !!project.video;
  }
}

/** The furthest step the member has earned. Drives which stepper items are live. */
export function furthestStep(project: CharacterReplaceProject): WorkspaceStep {
  if (!project.character) return "photo";
  if (!project.video) return "video";
  return "review";
}

/**
 * Whether Start may be pressed. Every clause is a fact the interface can
 * verify locally; the SERVER re-verifies all of them and the balance at
 * /start. In Part 1 `pricing` is never `quoted`, so this is false everywhere
 * — deliberately, and the review step says why.
 */
export function canStart(input: {
  project: CharacterReplaceProject;
  pricing: PricingState;
  config: CharacterReplacePublicConfig | null;
  available: boolean;
  balanceCents: number | null;
}): boolean {
  const { project, pricing, config } = input;
  if (!config || !input.available) return false;
  if (!project.character || !project.video || !project.consent) return false;
  if (!videoFits(project, config)) return false;
  if (project.voice.mode === "new_voice" && (!project.voice.languageCode || !project.voice.voiceId || !project.lipSync.tier)) return false;
  if (pricing.status !== "quoted") return false;
  if (input.balanceCents === null || input.balanceCents < pricing.snapshot.totalCents) return false;
  return true;
}

/* ───────────────────────────── the summary lines ─────────────────────────── */

/** "10.0 sec" — one decimal, always, so 10 and 10.04 read the same. */
export function formatSeconds(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  return `${(Math.round(seconds * 10) / 10).toFixed(1)} sec`;
}

/**
 * The summary card's rows, from the draft alone. They carry NO amounts —
 * `amountCents` is null on every line until a server snapshot replaces them —
 * which is what keeps the browser from ever implying a price it did not get.
 */
export function summaryLines(project: CharacterReplaceProject, config: CharacterReplacePublicConfig | null): PricingLine[] {
  const quality = config?.qualities.find((q) => q.id === project.settings.quality);
  const language = config?.languages.find((l) => l.code === project.voice.languageCode);
  const voice = config?.voices.find((v) => v.id === project.voice.voiceId);
  const tier = config?.lipSync.find((l) => l.id === project.lipSync.tier);
  const newVoice = project.voice.mode === "new_voice";
  return [
    { key: "video", label: "Video", value: formatSeconds(selectedDurationSeconds(project)), amountCents: null },
    { key: "quality", label: "Quality", value: quality?.label ?? project.settings.quality, amountCents: null },
    { key: "character", label: "Character replacement", value: "Included", amountCents: null },
    {
      key: "voice",
      label: "Voice",
      value: newVoice ? [language?.label, voice?.label].filter(Boolean).join(" · ") || "New voice" : "Original audio",
      amountCents: null,
    },
    { key: "lipSync", label: "Lip sync", value: newVoice && tier ? tier.label : "Not selected", amountCents: null },
  ];
}
