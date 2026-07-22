/**
 * AI Capability Registry — the declared list of what the platform's AI can do.
 *
 * The brief's "AI Capability Registry™". Kept deliberately honest: the assistant is
 * a knowledge Q&A system whose facts are GENERATED from the platform registries
 * (see `lib/assistant/corpus.ts`, `knowledge.ts`), and its only user surface is
 * currently unmounted (the `smart` module is `internal`). So this registry declares
 * exactly two real capabilities and their true status — not a roadmap of models we
 * don't run.
 */

export type AiCapabilityStatus =
  /** Wired and used in a shipped path. */
  | "live"
  /** Real backend, but no user-facing surface mounted yet. */
  | "internal"
  /** Declared intent, not built. */
  | "planned";

export interface AiCapability {
  id: string;
  name: string;
  description: string;
  /** Repo-relative source of the capability. Empty only when `planned`. */
  source: string;
  status: AiCapabilityStatus;
  note?: string;
}

export const AI_CAPABILITIES: AiCapability[] = [
  {
    id: "knowledge-corpus",
    name: "Knowledge corpus generation",
    description: "Builds factual context for the assistant from the platform registries, so the bot can't contradict our own docs.",
    source: "lib/assistant/corpus.ts",
    status: "live",
  },
  {
    id: "assistant-qa",
    name: "Assistant Q&A",
    description: "Natural-language answers about the app over the knowledge corpus.",
    source: "app/api/assistant",
    status: "internal",
    note: "Backend live; the widget is unmounted (smart module veracity = internal). Gate its remount behind the smart-assistant-widget flag.",
  },
];

export function getAiCapabilities(): AiCapability[] {
  return AI_CAPABILITIES;
}
