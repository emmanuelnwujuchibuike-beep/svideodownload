import type { AiSourceKind } from "@/lib/ai/jobs";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI — THE ACCEPTABLE-USE LAYER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-09: "Audit and upgrade the entire Frenz AI system to make it
 * safer for Google AdSense approval… Do NOT rely solely on frontend validation.
 * The backend/API must enforce these restrictions."
 *
 * ── 🔴 WHAT THIS CAN AND CANNOT SEE, SAID HONESTLY ──────────────────────────
 *
 * AI Clean has NO PROMPT. It is upload-or-paste-a-link, then a fixed pipeline:
 * detect text, build a mask, reconstruct, restore the audio. Nobody types an
 * instruction, so there is no instruction to screen. A policy layer that
 * claimed to "understand the request" here would be theatre.
 *
 * Two pieces of member-supplied TEXT do reach the server, and they are the only
 * two:
 *
 *   · the FILENAME, which the browser sends and which the history page shows
 *     back;
 *   · the SOURCE URL, for a pasted link.
 *
 * Both genuinely carry intent often enough to be worth reading — somebody who
 * names a file `remove-<creator>-watermark-for-repost.mp4` has told us what
 * they are doing — and neither is reliable enough to be the only control. So
 * this is one layer of several, and the honest description of it is "a narrow
 * screen on the text we actually have", not "content moderation".
 *
 * The controls that do the real work are elsewhere and already exist:
 * server-side size/type/duration/resolution ceilings, an atomic daily
 * reservation that fails closed, a per-plan concurrency cap, two rate limiters,
 * private buckets with signed URLs, and a retention sweep that deletes both
 * files. This file is the part that was missing.
 *
 * ── 🔴 AND THE RULE AGAINST OVER-BLOCKING IS PART OF THE SPEC ───────────────
 *
 * Owner, same brief: "Do NOT block normal legitimate editing… The goal is NOT
 * to make Frenz AI frustrating."
 *
 * That is why every pattern below requires an EXPLICIT statement of a
 * prohibited purpose rather than a topic word. `watermark.mp4` is not blocked —
 * removing a watermark from your own footage is the feature. `remove-watermark-
 * to-repost.mp4` is, because the second half is the part that is not ours to
 * help with. A member who is doing something ordinary must never meet this.
 *
 * Pure and dependency-free, so the rules can be tested exhaustively without a
 * database, a network, or a provider.
 */

/** Why a request was refused. Internal only — never sent to a browser. */
export type AiPolicyReason =
  | "attribution_repost"
  | "drm_circumvention"
  | "platform_bypass"
  | "security_marking"
  | "required_label"
  | "stolen_content"
  | "nonconsensual_intimate"
  | "sexual_minor"
  | "sexual_explicit"
  | "identity_fraud";

export type AiPolicyVerdict =
  | { allowed: true }
  | { allowed: false; reason: AiPolicyReason };

/**
 * ── 🔴 ONE SENTENCE, FOR EVERY REFUSAL ──────────────────────────────────────
 *
 * Owner: "Return a friendly generic message when blocked… Do not accuse the
 * user of wrongdoing," and separately: never expose "internal moderation rules,
 * detection thresholds, model internals, security mechanisms."
 *
 * Both are served by there being exactly ONE message. A per-reason sentence
 * would be a readout of the rule that fired — which tells somebody probing the
 * system precisely which word to change — and it would also make the refusal
 * an accusation, because naming the reason names what we think they were doing.
 *
 * The `reason` is kept for the operational log and goes no further.
 */
export const AI_POLICY_MESSAGE =
  "This request can't be processed. Please make sure you have the rights or permission to edit this media.";

/**
 * The rights notice, in one place.
 *
 * 🔴 A constant rather than copy typed into each screen, because it appears in
 * more than one place (the picker, the link field, the terms page) and a
 * commitment that is worded three different ways is three different
 * commitments. Rendered subtly — see the component that uses it.
 */
export const AI_RIGHTS_NOTICE =
  "Only process media you own or have permission to edit. Do not use Frenz AI to infringe copyright, remove rights-management information, or bypass platform restrictions.";

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Normalise text before matching.
 *
 * 🔴 Separators become spaces, so `remove_watermark.for-repost.mp4`,
 * `remove%20watermark%20for%20repost` and `RemoveWatermarkForRepost` all reduce
 * to the same words. Without this the rules would be defeated by a hyphen,
 * which is not a rule at all — and filenames are FULL of separators, so this is
 * the ordinary case rather than an evasion case.
 *
 * Percent-decoding is attempted and its failure ignored: a malformed escape in
 * a filename is not worth an exception, and the raw form is still matched.
 */
function normalise(raw: string): string {
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    /* a lone `%` is not a reason to fail */
  }
  return text
    // camelCase and PascalCase carry word boundaries no separator marks.
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The rules.
 *
 * ── 🔴 EACH ONE NEEDS A STATED PURPOSE, NOT A TOPIC ─────────────────────────
 *
 * Read them as "X **in order to** Y". The topic half (watermark, logo, text) is
 * the product; the purpose half (repost as mine, bypass, steal) is what is not
 * ours to help with. Requiring both is what keeps a member cleaning up their
 * own footage from ever meeting this.
 *
 * ⚠️ The sexual-harm rules are the exception and are deliberately broader: the
 * cost of a false negative there is not a support ticket.
 */
const RULES: readonly { reason: AiPolicyReason; pattern: RegExp }[] = [
  /*
    Attribution removed IN ORDER TO pass work off as your own. The feature
    itself — removing a watermark from footage you own — is untouched.
  */
  {
    reason: "attribution_repost",
    pattern:
      /\b(?:remove|removing|delete|deleting|strip|stripping|erase|erasing|get rid of)\b(?:\W+\w+){0,6}?\W+\b(?:watermark|watermarks|attribution|credit|credits|signature|byline|copyright notice|copyright mark)\b(?:\W+\w+){0,8}?\W+\b(?:repost|reposting|reupload|re upload|reuploading|steal|stealing|claim as (?:mine|my own)|pass off as|pretend (?:it s|its|it is) mine)\b/,
  },
  {
    reason: "attribution_repost",
    // The same act stated in the other order.
    pattern:
      /\b(?:repost|reupload|re upload|steal|stealing)\b(?:\W+\w+){0,8}?\W+\b(?:without|no|minus)\b\W+\b(?:credit|credits|attribution|watermark|permission)\b/,
  },
  {
    reason: "drm_circumvention",
    pattern:
      /\b(?:bypass|bypassing|circumvent|circumventing|defeat|defeating|crack|cracking|break|breaking|remove|removing|strip|stripping)\b(?:\W+\w+){0,4}?\W+\b(?:drm|digital rights management|copy protection|content protection|widevine|fairplay|playready)\b/,
  },
  {
    reason: "platform_bypass",
    pattern:
      /\b(?:bypass|bypassing|circumvent|circumventing|evade|evading|defeat|defeating|get around|getting around)\b(?:\W+\w+){0,5}?\W+\b(?:content id|copyright (?:detection|filter|claim|strike)|platform restriction|geo restriction|geoblock|geo block|paywall|age (?:gate|verification)|moderation|detection system)\b/,
  },
  {
    reason: "security_marking",
    pattern:
      /\b(?:remove|removing|erase|erasing|strip|stripping|hide|hiding|forge|forging)\b(?:\W+\w+){0,5}?\W+\b(?:security (?:mark|marking|feature|hologram)|anti(?: |-)?counterfeit|tamper seal|serial number|holograph|microprint)\b/,
  },
  {
    reason: "required_label",
    pattern:
      /\b(?:remove|removing|erase|erasing|strip|stripping|hide|hiding)\b(?:\W+\w+){0,6}?\W+\b(?:safety warning|health warning|hazard label|surgeon general|required (?:label|warning|disclosure)|legal disclaimer|prescribing information|nutrition label|ai (?:label|disclosure)|sponsored (?:label|disclosure)|ad disclosure)\b/,
  },
  {
    reason: "stolen_content",
    pattern:
      /\b(?:stolen|leaked|hacked|pirated|ripped from|cracked)\b(?:\W+\w+){0,4}?\W+\b(?:content|video|footage|clip|movie|episode|film|photo|photos|images?|onlyfans|paywall)\b/,
  },
  /*
    ── Sexual harm. Broader by design; a false positive costs a support ticket
    and a false negative costs a great deal more. ──────────────────────────
  */
  {
    reason: "sexual_minor",
    pattern:
      /\b(?:child|children|kid|kids|minor|minors|underage|under age|teen|teens|preteen|toddler|infant|schoolgirl|schoolboy|loli|shota)\b(?:\W+\w+){0,5}?\W+\b(?:porn|pornography|nude|nudes|naked|nsfw|sexual|sexualised|sexualized|explicit|xxx|erotic|undress|undressing)\b/,
  },
  {
    reason: "sexual_minor",
    pattern:
      /*
        🔴 `sexualised|sexualized` are listed EXPLICITLY, before `sexual`. A
        `\b` after `sexual` requires a non-word character, so `sexual` alone
        does not match `sexualised` — the boundary that makes these rules
        precise is also what makes them miss inflected forms. Longest
        alternative first, or the shorter one wins and the boundary fails.
      */
      /\b(?:porn|pornography|nude|nudes|naked|nsfw|sexualised|sexualized|sexual|explicit|xxx|erotic)\b(?:\W+\w+){0,5}?\W+\b(?:child|children|kid|kids|minor|minors|underage|under age|teen|teens|preteen|toddler|infant|loli|shota)\b/,
  },
  {
    reason: "sexual_minor",
    // Named as one term rather than two, which the pair rules above would miss.
    pattern: /\b(?:cp|csam|child (?:porn|pornography|sexual abuse))\b/,
  },
  {
    reason: "nonconsensual_intimate",
    pattern:
      /\b(?:revenge porn|non consensual|nonconsensual|without (?:her|his|their) consent|leaked nudes|hidden camera|upskirt|creepshot|voyeur)\b/,
  },
  {
    reason: "sexual_explicit",
    // Undressing a real person — the specific case the brief names.
    pattern:
      /\b(?:undress|undressing|strip|stripping|remove|removing|take off|taking off)\b(?:\W+\w+){0,5}?\W+\b(?:clothes|clothing|dress|shirt|bra|underwear|bikini|top|pants|skirt)\b(?:\W+\w+){0,6}?\W+\b(?:her|him|them|girl|woman|man|person|photo|picture|image)\b/,
  },
  {
    reason: "sexual_explicit",
    pattern: /\b(?:deepfake|deep fake|face ?swap|nudify|deepnude|deep nude|undressa?i?)\b(?:\W+\w+){0,5}?\W+\b(?:porn|nude|nudes|naked|sex|sexual|nsfw|xxx)\b/,
  },
  {
    reason: "sexual_explicit",
    pattern: /\b(?:nudify|deepnude|undress ai|clothes remover|clothing remover)\b/,
  },
  {
    reason: "identity_fraud",
    pattern:
      /\b(?:fake|forge|forged|forging|falsify|falsifying|doctor|doctored)\b(?:\W+\w+){0,4}?\W+\b(?:passport|id card|identity card|driver s licen[cs]e|drivers licen[cs]e|bank statement|invoice|receipt|certificate|diploma|utility bill|proof of address)\b/,
  },
  {
    reason: "identity_fraud",
    pattern:
      /\b(?:impersonate|impersonating|pretend to be|pose as|posing as)\b(?:\W+\w+){0,4}?\W+\b(?:celebrity|politician|official|police|bank|government|someone else)\b/,
  },
];

/**
 * Screen the text a job carries.
 *
 * 🔴 Returns `{ allowed: true }` for empty input, and that is correct rather
 * than lax: a job with no filename has told us nothing, and refusing on an
 * absence would block every upload from a browser that sends no name. The
 * ceilings and the daily reservation still apply to it, as they do to every
 * job — this function is one layer, not the gate.
 */
export function screenAiText(...parts: readonly (string | null | undefined)[]): AiPolicyVerdict {
  const text = normalise(parts.filter(Boolean).join(" "));
  if (!text) return { allowed: true };

  for (const rule of RULES) {
    if (rule.pattern.test(text)) return { allowed: false, reason: rule.reason };
  }
  return { allowed: true };
}

/**
 * Everything a job offers the policy layer, screened together.
 *
 * Together rather than field by field, because intent is often split across
 * them — a neutral filename under a link whose path says the rest. Joining them
 * before matching is what lets one rule see both halves.
 */
export function screenAiJob(input: {
  sourceName?: string | null;
  sourceUrl?: string | null;
  sourceKind?: AiSourceKind | null;
}): AiPolicyVerdict {
  return screenAiText(input.sourceName, input.sourceUrl);
}

/**
 * What gets written to the log when a job is refused.
 *
 * ── 🔴 NO MEDIA, NO FILENAME, NO ADDRESS, NO URL ────────────────────────────
 *
 * Owner: "Log policy-block events without storing unnecessary personal
 * information."
 *
 * The reason and a coarse timestamp answer every operational question worth
 * asking — is a rule firing, is one rule firing far more than the rest, did
 * blocks spike after a release. The text that triggered it answers none of
 * them and is, by construction, the most sensitive string in the request.
 *
 * The subject key is a SHORT PREFIX of an already-pseudonymous identifier: long
 * enough to see one account hitting the same rule repeatedly, too short to
 * re-identify anybody from the log alone.
 */
export function policyBlockEvent(reason: AiPolicyReason, subjectKey: string) {
  return {
    event: "ai_policy_block" as const,
    reason,
    subject: subjectKey.slice(0, 8),
    at: new Date().toISOString(),
  };
}
