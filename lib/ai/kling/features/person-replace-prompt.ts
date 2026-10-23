/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CHARACTER REPLACE — who the member picked, in words Omni can act on
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Kling 3.0 Omni has NO field that selects a person: no mask, no box, no point,
 * no track (the 2026-10-19 audit of Kling's own API reference). The only
 * instrument is the prompt — Kling's documented template is "Change [describe
 * specified subject] in [@Video] to [@Element]". So the member's TAP on a
 * detected person is turned here into the most unambiguous sentence the
 * detection supports: where the person stands among the others, how many
 * people there are, the moment they were seen, and the member's own short
 * description of them.
 *
 * 🔴 This IMPROVES targeting; it does not guarantee it. The page says so, and
 * nothing here may be described anywhere as "selecting" a person at Kling.
 *
 * ── 🔴 THE PROMPT IS THE SERVER'S ──────────────────────────────────────────
 *
 * A member never types the instruction. They pick people, add photos and may
 * add a short description per person; the description is SANITISED here (no
 * placeholder syntax, no element tokens, no line breaks) and embedded as a
 * quoted noun phrase, so it can describe a person but cannot rewrite the
 * instruction around it.
 *
 * Pure: no network, no clock, no storage. Every rule is asserted in
 * person-replace.test.ts.
 */

/** A box as fractions (0–1) of the frame it was detected in. */
export interface PersonBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One person the worker's detector found on the inspection frame. */
export interface DetectedPerson {
  /** Stable within one inspection: "p1", "p2", … in left-to-right order. */
  id: string;
  box: PersonBox;
  /** The detector's confidence, 0–1. */
  score: number;
}

/** A person the member chose, and the references that should replace them. */
export interface PersonReplaceTargetPlan {
  personId: string;
  /** The member's own words ("the man in the blue shirt"), already sanitised or not — sanitised again here. */
  description?: string | null;
  /** How many reference images this person has. Their numbering is decided by `referenceLayout`. */
  imageCount: number;
}

export const PERSON_DESCRIPTION_MAX_CHARS = 80;

/** Two people closer than this (fraction of the frame width, centre to centre) cannot be told apart by position alone. */
export const AMBIGUOUS_CENTRE_GAP = 0.06;

/** The letter a member sees on a selected person. The UI and the prompt use the same one. */
export const TARGET_LETTERS = ["A", "B"] as const;

/**
 * The member's description, made safe to place inside an instruction.
 *
 * Removes what could change the instruction rather than describe a person:
 * Omni's placeholder syntax (`<<<image_1>>>`), its element syntax (`@Name`),
 * brackets, quotes, back-slashes and every line break or control character.
 * Then collapses the spaces and cuts at a word boundary.
 */
export function sanitizePersonDescription(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw)
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex -- the point is to remove control characters
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/[<>@{}[\]\\"`|#*_~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > PERSON_DESCRIPTION_MAX_CHARS) {
    const cut = s.slice(0, PERSON_DESCRIPTION_MAX_CHARS);
    const space = cut.lastIndexOf(" ");
    s = (space > PERSON_DESCRIPTION_MAX_CHARS * 0.6 ? cut.slice(0, space) : cut).trim();
  }
  // a description that is only punctuation describes nobody
  return /[\p{L}\p{N}]/u.test(s) ? s.replace(/[.,;:!?\s]+$/u, "") : "";
}

export const PERSON_REPLACE_INSTRUCTIONS_MAX_CHARS = 1000;

/**
 * The member's OPTIONAL extra changes, typed in Text to Video's prompt box
 * while characters are being replaced ("make it night time").
 *
 * 🔴 Free text is allowed here — it is the member's own edit — but it may not
 * re-point the references: the placeholder and element syntax is removed, so
 * a typed `<<<image_2>>>` cannot hand Person B's photo to Person A. It is
 * quoted and placed AFTER the replacement rules, never before them.
 */
export function sanitizeReplaceInstructions(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw)
    .normalize("NFKC")
    // eslint-disable-next-line no-control-regex -- the point is to remove control characters
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ")
    .replace(/<<<[^>]*>>>/g, " ")
    .replace(/[<>@{}\\"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length > PERSON_REPLACE_INSTRUCTIONS_MAX_CHARS) s = s.slice(0, PERSON_REPLACE_INSTRUCTIONS_MAX_CHARS).trim();
  return /[\p{L}\p{N}]/u.test(s) ? s : "";
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ordinal = (n: number): string => ORDINALS[n - 1] ?? `${n}th`;
const COUNT_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number): string => COUNT_WORDS[n] ?? String(n);

const centreX = (p: DetectedPerson) => p.box.x + p.box.w / 2;

/** The people, left to right on the frame. Ties keep the detector's order. */
export function peopleLeftToRight(people: readonly DetectedPerson[]): DetectedPerson[] {
  return people.map((p, i) => ({ p, i })).sort((a, b) => centreX(a.p) - centreX(b.p) || a.i - b.i).map(({ p }) => p);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface PersonDescriptor {
  id: string;
  /** "the person on the far left, in the foreground" */
  position: string;
  /** Left-to-right index, 1-based. */
  order: number;
  /** Another person stands so close that position alone cannot tell them apart. */
  ambiguous: boolean;
}

/**
 * Where each detected person stands, in words.
 *
 *   1 person   "the only person in the video"
 *   2 people   "the person on the left" / "on the right"
 *   3+         "far left" / "far right" / "in the middle" / "the second person
 *              from the left", always followed by "(the 2nd of 4 people,
 *              counting from the left)" so the count disambiguates too
 *
 * A person clearly taller on the frame than the others is "in the foreground",
 * clearly shorter "in the background" — the two cues a viewer would use.
 */
export function describePeople(people: readonly DetectedPerson[]): Map<string, PersonDescriptor> {
  const ordered = peopleLeftToRight(people);
  const n = ordered.length;
  const out = new Map<string, PersonDescriptor>();
  if (n === 0) return out;
  const typicalHeight = median(ordered.map((p) => p.box.h));

  ordered.forEach((p, i) => {
    let position: string;
    if (n === 1) position = "the only person in the video";
    else if (n === 2) position = i === 0 ? "the person on the left" : "the person on the right";
    else if (i === 0) position = "the person on the far left";
    else if (i === n - 1) position = "the person on the far right";
    else if (n % 2 === 1 && i === (n - 1) / 2) position = "the person in the middle";
    else if (i < n / 2) position = `the ${ordinal(i + 1)} person from the left`;
    else position = `the ${ordinal(n - i)} person from the right`;

    if (n >= 2) {
      if (p.box.h >= typicalHeight * 1.4) position += ", in the foreground";
      else if (p.box.h <= typicalHeight * 0.65) position += ", in the background";
    }
    if (n >= 3) position += ` (the ${ordinal(i + 1)} of ${countWord(n)} people, counting from the left)`;

    const neighbours = [ordered[i - 1], ordered[i + 1]].filter((q): q is DetectedPerson => !!q);
    const ambiguous = neighbours.some((q) => Math.abs(centreX(q) - centreX(p)) < AMBIGUOUS_CENTRE_GAP);
    out.set(p.id, { id: p.id, position, order: i + 1, ambiguous });
  });
  return out;
}

/**
 * 🔴 WHICH IMAGE BELONGS TO WHICH PERSON — one function, used by the request
 * builder AND the prompt, so the numbers can never disagree.
 *
 * Omni numbers `refer_image` items by their order in `contents`
 * (`<<<image_1>>>`, `<<<image_2>>>`, …). The builder sends target A's images
 * first, then target B's; this returns the 1-based numbers each target owns.
 */
export function referenceLayout(targets: readonly { imageCount: number }[]): number[][] {
  let next = 1;
  return targets.map((t) => {
    const mine: number[] = [];
    for (let k = 0; k < Math.max(0, Math.floor(t.imageCount)); k++) mine.push(next++);
    return mine;
  });
}

const imageRefs = (numbers: readonly number[]): string => {
  const tokens = numbers.map((n) => `<<<image_${n}>>>`);
  if (tokens.length <= 1) return tokens.join("");
  return `${tokens.slice(0, -1).join(", ")} and ${tokens[tokens.length - 1]}`;
};

const seconds = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  return s < 10 ? (Math.round(s * 10) / 10).toString() : Math.round(s).toString();
};

/**
 * The whole instruction.
 *
 * Uses `<<<video_1>>>` / `<<<image_N>>>` — the syntax PROVEN on this account by
 * generation (task 936598991629459463: "Replace the woman in <<<video_1>>> with
 * the man in <<<image_1>>>" → replaced, same scene). Kling's newer reference
 * page writes `@image_1`; that spelling has not been run here, and the
 * selection rests entirely on the prompt being read, so the proven one is used.
 */
export function buildPersonReplacePrompt(opts: {
  people: readonly DetectedPerson[];
  /** When, in the clip, the people were detected — the moment the positions describe. */
  frameMs: number;
  targets: readonly PersonReplaceTargetPlan[];
  /** The member's optional extra changes (sanitised again here). */
  instructions?: string | null;
}): string {
  const descriptors = describePeople(opts.people);
  const layout = referenceLayout(opts.targets);
  const at = `as seen at about ${seconds(opts.frameMs)} seconds`;
  const lines: string[] = [];
  const several = opts.targets.length > 1;

  lines.push(`Edit <<<video_1>>>. Replace ${several ? "only the two people described below" : "only the one person described below"}, and keep everything else in the video as it is.`);

  opts.targets.forEach((t, i) => {
    const d = descriptors.get(t.personId);
    const where = d?.position ?? "the selected person";
    const said = sanitizePersonDescription(t.description);
    const who = said ? `${where} — ${said}` : where;
    const letter = TARGET_LETTERS[i] ?? String(i + 1);
    lines.push(`Person ${letter}: replace ${who} (${at}) with the person shown in ${imageRefs(layout[i] ?? [])}.`);
  });

  lines.push(
    several
      ? "Each new person takes the place, pose, movements, actions and timing of the person they replace for the whole clip, and keeps their own face, hair, body and clothing from every angle as the camera moves. Person A must look only like their own reference images and Person B only like theirs; never mix the two."
      : "The new person takes the place, pose, movements, actions and timing of the person they replace for the whole clip, and keeps the same face, hair, body and clothing from every angle as the camera moves.",
  );
  const extra = sanitizeReplaceInstructions(opts.instructions);
  lines.push(
    extra
      ? "Keep every other person in <<<video_1>>> exactly as they are: the same face, hair, body, clothing, position and movement. Keep the camera movement, framing and timing, and change the rest of the scene only as asked below."
      : "Keep every other person in <<<video_1>>> exactly as they are: the same face, hair, body, clothing, position and movement. Do not change the background, lighting, camera movement, framing or timing.",
  );
  if (extra) lines.push(`Other changes the creator asked for: "${extra}".`);
  return lines.join(" ");
}
