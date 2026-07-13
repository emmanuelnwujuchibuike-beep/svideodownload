import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Real (not simulated) content risk scoring for the moderation queue — reuses
 * the same Anthropic key + direct-fetch pattern as `/api/assistant/route.ts`
 * (no SDK dependency). Runs ONLY after a target is already auto-hidden by
 * the existing report-threshold trigger (migration 0010) — this never gates
 * publishing itself, it just gives the admin a fast, informed starting point
 * instead of reading raw text cold. Best-effort: any failure (no key
 * configured, API error, unparseable response) leaves the target with no
 * assessment row rather than a wrong one — the admin queue works fine
 * without it, same as before this round.
 */

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY?.trim();
const MODEL = process.env.MODERATION_MODEL?.trim() || "claude-haiku-4-5";

const CATEGORIES = ["harassment", "hate", "violence", "sexual", "spam", "self_harm", "other", "none"] as const;
export type RiskCategory = (typeof CATEGORIES)[number];

export interface RiskAssessment {
  category: RiskCategory;
  severity: number; // 0-100
  rationale: string;
}

const SYSTEM_PROMPT = `You are a content moderation classifier for a social app. You will be given reported text content and the reasons it was reported. Respond with ONLY a JSON object, no other text, in this exact shape:
{"category": one of ${JSON.stringify(CATEGORIES)}, "severity": integer 0-100, "rationale": a one-sentence explanation under 200 characters}
"severity" is how likely this genuinely violates community guidelines (0 = clearly fine/false report, 100 = clearly severe violation). Be conservative — this only assists a human reviewer who makes the final call, it does not take any action itself.`;

function parseAssessment(text: string): RiskAssessment | null {
  try {
    // Models occasionally wrap JSON in a code fence despite instructions —
    // strip one if present rather than failing the whole assessment.
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(cleaned) as Partial<RiskAssessment>;
    if (!parsed.category || !CATEGORIES.includes(parsed.category as RiskCategory)) return null;
    const severity = Math.round(Number(parsed.severity));
    if (!Number.isFinite(severity) || severity < 0 || severity > 100) return null;
    const rationale = String(parsed.rationale ?? "").slice(0, 200) || "No rationale provided.";
    return { category: parsed.category as RiskCategory, severity, rationale };
  } catch {
    return null;
  }
}

async function classify(content: string, reasons: string[]): Promise<RiskAssessment | null> {
  if (!ANTHROPIC_API_KEY || !content.trim()) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Reported content:\n"""${content.slice(0, 4000)}"""\n\nReport reasons: ${reasons.join(", ") || "none given"}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === "text")?.text;
    return text ? parseAssessment(text) : null;
  } catch {
    return null;
  }
}

/**
 * Scores a reported target's text and upserts the result. Safe to call
 * repeatedly (e.g. re-scored on a later report) — overwrites the prior
 * assessment for that target.
 */
export async function scoreReportedTarget(
  targetType: "post" | "comment" | "user",
  targetId: string,
  content: string,
  reasons: string[],
): Promise<void> {
  const assessment = await classify(content, reasons);
  if (!assessment) return;
  try {
    const db = createAdminClient();
    await db.from("moderation_ai_assessments").upsert(
      {
        target_type: targetType,
        target_id: targetId,
        category: assessment.category,
        severity: assessment.severity,
        rationale: assessment.rationale,
        model: MODEL,
        created_at: new Date().toISOString(),
      },
      { onConflict: "target_type,target_id" },
    );
  } catch {
    /* best-effort — the queue just shows no assessment for this target */
  }
}
