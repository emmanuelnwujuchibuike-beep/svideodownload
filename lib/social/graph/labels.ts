/**
 * Relationship labels — "what is this person to me" (Feature 18 · Part 17).
 *
 * ── A label is PRIVATE and ONE-SIDED, and that is the whole design ────────
 * If A labels B "Mentor", B is never told. Three reasons, in order of how
 * badly each would bite:
 *
 *  1. A visible label is a claim about someone else, published without their
 *     consent, on a surface they cannot edit. "Ex", "Boss", "Client" — the
 *     harmless-looking version of this feature is a harassment vector.
 *  2. A two-sided label needs an accept/decline flow, which is a second
 *     friend-request system. Friendship already carries the consent; a label
 *     is only the labeller's private note on top of it.
 *  3. Private means it can be honest. A member will file someone under
 *     "Acquaintance" only when nobody can read it.
 *
 * So labels never leave the labeller's own client, and RLS in 0112 enforces
 * that at the row level rather than trusting every future query to remember.
 *
 * ── One label per person, deliberately ────────────────────────────────────
 * The obvious objection is that someone can be both Family and Colleague.
 * They can — and that is what Circles are for. Two overlapping many-to-many
 * grouping systems is the duplicate-source-of-truth problem again, one level
 * up: a member would file someone under the "Work" circle and the "Colleague"
 * label and reasonably expect changing one to change the other. So the split
 * is strict: a LABEL is the single answer to "who is this to me", a CIRCLE is
 * any number of groupings. Labels sort; circles gate.
 *
 * Pure: no React, no Supabase, no I/O.
 */

import { isEnforcementEdge } from "@/lib/social/graph/edges";

export type LabelKey =
  | "best_friend"
  | "close_friend"
  | "family"
  | "partner"
  | "classmate"
  | "colleague"
  | "mentor"
  | "mentee"
  | "creator"
  | "business_partner"
  | "client"
  | "neighbour"
  | "teammate"
  | "acquaintance";

export interface LabelSpec {
  key: LabelKey;
  label: string;
  /** Grouping used to order the picker — not stored, not meaningful to privacy. */
  group: "close" | "life" | "work" | "wider";
  /**
   * True when the label describes a relationship that only makes sense once
   * both people agreed — i.e. it requires an existing friendship. Following
   * someone does not make them your Family.
   */
  requiresFriendship: boolean;
}

export const RELATIONSHIP_LABELS: readonly LabelSpec[] = [
  { key: "best_friend", label: "Best friend", group: "close", requiresFriendship: true },
  { key: "close_friend", label: "Close friend", group: "close", requiresFriendship: true },
  { key: "partner", label: "Partner", group: "close", requiresFriendship: true },
  { key: "family", label: "Family", group: "life", requiresFriendship: true },
  { key: "neighbour", label: "Neighbour", group: "life", requiresFriendship: false },
  { key: "classmate", label: "Classmate", group: "life", requiresFriendship: false },
  { key: "teammate", label: "Teammate", group: "life", requiresFriendship: false },
  { key: "colleague", label: "Colleague", group: "work", requiresFriendship: false },
  { key: "mentor", label: "Mentor", group: "work", requiresFriendship: false },
  { key: "mentee", label: "Mentee", group: "work", requiresFriendship: false },
  { key: "business_partner", label: "Business partner", group: "work", requiresFriendship: false },
  { key: "client", label: "Client", group: "work", requiresFriendship: false },
  { key: "creator", label: "Creator I follow", group: "wider", requiresFriendship: false },
  { key: "acquaintance", label: "Acquaintance", group: "wider", requiresFriendship: false },
] as const;

const BY_KEY = new Map(RELATIONSHIP_LABELS.map((l) => [l.key, l]));

export function relationshipLabel(key: string): LabelSpec | undefined {
  return BY_KEY.get(key as LabelKey);
}

export function isBuiltInLabel(key: string): key is LabelKey {
  return BY_KEY.has(key as LabelKey);
}

/**
 * Words that must never become a label, whatever a member types.
 *
 * A custom label reading "Blocked" is the failure described in `edges.ts`:
 * decorative text that looks like protection. Rejecting it with a pointer to
 * the real control is the only outcome that leaves the member safer than it
 * found them.
 */
export const STRUCTURAL_WORDS: Readonly<Record<string, string>> = {
  blocked: "block",
  block: "block",
  muted: "mute",
  mute: "mute",
  restricted: "restrict",
  restrict: "restrict",
} as const;

export type CustomLabelResult =
  | { ok: true; value: string }
  | { ok: false; error: string; useInstead?: "block" | "mute" | "restrict" };

export const MAX_CUSTOM_LABEL_LENGTH = 24;

/**
 * Remove everything that can render as nothing or reorder the text around it:
 * C0/C1 controls, the zero-width family, the bidi overrides, and the word
 * joiner / BOM. Written as a codepoint test rather than a character class so
 * the source file itself contains no invisible characters — a regex literal
 * full of them is unreviewable and survives exactly one careless edit.
 */
function stripInvisible(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    const invisible =
      c < 0x20 || // C0 controls
      (c >= 0x7f && c <= 0x9f) || // DEL + C1 controls
      (c >= 0x200b && c <= 0x200f) || // ZWSP..RLM
      (c >= 0x202a && c <= 0x202e) || // bidi embedding/override
      (c >= 0x2066 && c <= 0x2069) || // bidi isolates
      c === 0x2060 || // word joiner
      c === 0xfeff; // BOM / ZWNBSP
    if (!invisible) out += ch;
  }
  // Tabs and newlines are already gone as controls. The caller collapses what
  // remains with its whitespace pass, which in JS also matches NBSP.
  return out;
}

/**
 * Validate a member-authored label.
 *
 * Control characters are stripped rather than rejected — a paste from a rich
 * text editor should not read as an error — but zero-width characters are
 * removed too, because a label that renders as empty is indistinguishable from
 * having no label and makes the row impossible to find again.
 */
export function validateCustomLabel(raw: string): CustomLabelResult {
  const cleaned = stripInvisible(raw).replace(/\s+/g, " ").trim();
  if (!cleaned) return { ok: false, error: "Give the label a name." };
  if (cleaned.length > MAX_CUSTOM_LABEL_LENGTH) {
    return { ok: false, error: `Keep it under ${MAX_CUSTOM_LABEL_LENGTH} characters.` };
  }

  const lowered = cleaned.toLowerCase();
  const structural = STRUCTURAL_WORDS[lowered];
  if (structural && isEnforcementEdge(structural)) {
    return {
      ok: false,
      error: `"${cleaned}" is an action, not a label — a label here would look like protection without being any.`,
      useInstead: structural as "block" | "mute" | "restrict",
    };
  }

  return { ok: true, value: cleaned };
}

/**
 * Resolve what to store for a label choice: a built-in key, or a custom string.
 * Returns `null` for "no label", which is how a label is cleared.
 */
export type ResolvedLabel = { kind: "builtin"; key: LabelKey } | { kind: "custom"; value: string } | null;

export function resolveLabelInput(raw: string | null | undefined): ResolvedLabel | { error: string } {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (isBuiltInLabel(trimmed)) return { kind: "builtin", key: trimmed };
  const custom = validateCustomLabel(trimmed);
  if (!custom.ok) return { error: custom.error };
  return { kind: "custom", value: custom.value };
}

/** The human string for a stored label value, built-in or custom. */
export function labelDisplay(stored: string | null | undefined): string | null {
  if (!stored) return null;
  return relationshipLabel(stored)?.label ?? stored;
}

/**
 * Can this label be applied given the relationship that actually exists?
 *
 * Labels that assert closeness ("Family", "Partner") require a real, mutual
 * friendship. Not for tidiness — it stops a one-way follow from being
 * privately reframed as intimacy and then feeding the reconnect prompts and
 * the connection map, where it would look like a relationship that both people
 * are in when only one of them is.
 */
export function canApplyLabel(key: string, ctx: { isFriend: boolean }): boolean {
  const spec = relationshipLabel(key);
  if (!spec) return true; // custom labels carry no such claim
  return spec.requiresFriendship ? ctx.isFriend : true;
}

/** Picker order: closest first, then life, work, wider. */
export function labelsByGroup(): { group: LabelSpec["group"]; title: string; items: LabelSpec[] }[] {
  const titles: Record<LabelSpec["group"], string> = {
    close: "Close",
    life: "Life",
    work: "Work",
    wider: "Wider circle",
  };
  return (["close", "life", "work", "wider"] as const).map((group) => ({
    group,
    title: titles[group],
    items: RELATIONSHIP_LABELS.filter((l) => l.group === group),
  }));
}
