import "server-only";

import { ADVERTISING_RULES } from "./rules";

/**
 * Part 8 — content safety for ad creatives, reusing the repo's existing
 * moderation integration (lib/moderation/risk-score.ts): the same Anthropic
 * key, the same MODERATION_MODEL and the same direct-fetch pattern. No new
 * vendor, no SDK dependency.
 *
 *   image    the IMAGE is passed BY URL (a short-lived signed URL on Supabase
 *            Storage). The model's service fetches it from storage, so the
 *            bytes never pass through Vercel or Railway.
 *   video    its poster frame is checked. A video without a poster goes to a
 *            person (`review`) - frames beyond the poster are NOT inspected
 *            (a recorded limitation).
 *   text     headline, description, business name and the link's host,
 *            against the Advertising Rules.
 *
 * Outcomes:
 *   passed    automated checks are fine
 *   review    a person decides. Activation holds in validating
 *             (`safety_review`), and an edit or replacement is refused.
 *   rejected  a clear violation. The creative is blocked, and the advertiser
 *             is told it broke the rules (never the classifier's reasoning).
 *   skipped   no moderation key is configured. This is a coverage gap
 *             recorded in docs/AD_PLATFORM.md, never a pass.
 *
 * SAFE-FAILURE: configured but unreachable or unparseable → `review`. A
 * failed check never approves anything.
 */

const KEY = () => process.env.ANTHROPIC_API_KEY?.trim() || null;
const MODEL = () => process.env.MODERATION_MODEL?.trim() || "claude-haiku-4-5";

export type ModerationStatus = "passed" | "review" | "rejected" | "skipped";
export interface ModerationOutcome {
  status: ModerationStatus;
  labels: string[];
}

const LABELS = [
  "sexual", "nudity", "violence", "gore", "hate", "harassment", "weapons", "drugs", "self_harm",
  "scam", "fake_giveaway", "investment_fraud", "phishing", "credential_request", "impersonation",
  "misleading_ui", "fake_urgency", "malware_download", "deceptive_claims", "illegal", "other",
] as const;

const RULES_TEXT = ADVERTISING_RULES.map((r) => `${r.title}: ${r.intro} ${r.items.join("; ")}`).join("\n");

const SYSTEM = `You review advertisements for Frenzsave, a general-audience media and social app, against its Advertising Rules:
${RULES_TEXT}
Also not allowed: sexual content or nudity, graphic violence or gore, hate, and sales of weapons or illegal drugs.

Decide one of:
- "allow": nothing breaks the rules.
- "review": unclear, borderline, or you cannot see enough to be sure.
- "reject": a clear violation.
Respond with ONLY a JSON object: {"decision": "allow" | "review" | "reject", "labels": [zero or more of ${JSON.stringify(LABELS)}]}`;

export function parseModeration(text: string): ModerationOutcome | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as { decision?: unknown; labels?: unknown };
    const status: ModerationStatus | null = v.decision === "allow" ? "passed" : v.decision === "review" ? "review" : v.decision === "reject" ? "rejected" : null;
    if (!status) return null;
    const labels = Array.isArray(v.labels) ? v.labels.filter((l): l is string => typeof l === "string" && (LABELS as readonly string[]).includes(l)).slice(0, 6) : [];
    return { status, labels };
  } catch {
    return null;
  }
}

export interface ModerationInput {
  /** a short-lived signed URL to the stored image or poster - never bytes */
  imageUrl?: string | null;
  /** true for a video with no poster frame: always a person */
  videoWithoutPoster?: boolean;
  texts?: (string | null | undefined)[];
  destinationHost?: string | null;
}

export async function moderateCreative(input: ModerationInput, fetchImpl: typeof fetch = fetch): Promise<ModerationOutcome> {
  const key = KEY();
  if (!key) return { status: "skipped", labels: [] };
  const texts = (input.texts ?? []).filter((t): t is string => !!t && !!t.trim());
  if (!input.imageUrl && texts.length === 0 && !input.destinationHost) {
    return input.videoWithoutPoster ? { status: "review", labels: ["video_frames_unchecked"] } : { status: "passed", labels: [] };
  }
  const content: unknown[] = [];
  if (input.imageUrl) content.push({ type: "image", source: { type: "url", url: input.imageUrl } });
  content.push({
    type: "text",
    text: [
      input.imageUrl ? "The image above is the advertisement creative." : "Advertisement text only (no image).",
      texts.length ? `Ad text:\n"""${texts.join("\n").slice(0, 1500)}"""` : "",
      input.destinationHost ? `It links to the website: ${input.destinationHost}` : "",
    ].filter(Boolean).join("\n\n"),
  });
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 256, system: SYSTEM, messages: [{ role: "user", content }] }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: "review", labels: ["moderation_unavailable"] };
    const data = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (data.stop_reason === "refusal") return { status: "review", labels: ["moderation_refused"] };
    const text = data.content?.find((b) => b.type === "text")?.text;
    const out = text ? parseModeration(text) : null;
    if (!out) return { status: "review", labels: ["moderation_unparseable"] };
    if (out.status === "passed" && input.videoWithoutPoster) return { status: "review", labels: ["video_frames_unchecked"] };
    return out;
  } catch {
    return { status: "review", labels: ["moderation_unavailable"] };
  }
}

/** The stricter of two outcomes (rejected > review > passed > skipped). */
export function worse(a: ModerationOutcome, b: ModerationOutcome): ModerationOutcome {
  const rank: Record<ModerationStatus, number> = { skipped: 0, passed: 1, review: 2, rejected: 3 };
  const top = rank[a.status] >= rank[b.status] ? a : b;
  return { status: top.status, labels: [...new Set([...a.labels, ...b.labels])] };
}
