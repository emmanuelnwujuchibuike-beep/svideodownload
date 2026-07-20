import type { Availability } from "@/lib/platform/availability";

/**
 * Frenzsave Academy™ types. See `docs/ACADEMY_RFC.md`.
 *
 * The Academy is the reader-facing surface over content infrastructure that
 * already exists (editorial workflow, localization, versioning, media library —
 * migrations 0085/0086). Nothing here duplicates that; these are the learning
 * shapes those systems did not have.
 */

/* ---------------------------------- schools --------------------------------- */

export type SchoolId =
  | "creator"
  | "community"
  | "editing"
  | "security"
  | "developer"
  | "business"
  | "marketplace"
  | "ai"
  | "cloud"
  | "professional"
  | "enterprise";

/**
 * What a school teaches, which is NOT the same question as whether a product
 * exists. This distinction is the heart of the Academy's truth model.
 *
 * - `product` — the school teaches a Frenzsave product. Its lessons describe our
 *   software, so they may only exist if that product exists. Availability is
 *   derived from the Product Genome.
 *
 * - `practice` — the school teaches a SUBJECT: editing technique, security
 *   hygiene, community craft. This knowledge is true regardless of what we ship,
 *   so the school is always publishable. Its lessons are still gated — they may
 *   teach a technique, but they may not claim Frenzsave ships a tool that performs
 *   it (see `lib/content/reality-ledger.ts`).
 *
 * Collapsing these two into one flag was the first design I tried and it forced a
 * false choice: either Editing School™ claims an editor we don't ship, or we
 * refuse to publish genuinely useful editing knowledge. Both are wrong. Two axes
 * dissolve it.
 */
export type SchoolKind = "product" | "practice";

export interface School {
  id: SchoolId;
  slug: string;
  name: string;
  /** One line, present tense for `live`, future tense for `planned`. */
  tagline: string;
  /** Longer description for the school homepage and its meta description. */
  summary: string;
  kind: SchoolKind;
  /**
   * Product Genome id this school teaches, for `kind: "product"`.
   * `null` for practice schools, which are not about a product at all.
   *
   * NEVER paired with a hand-written availability field — availability is derived
   * from this id at read time so it cannot drift. See `lib/platform/availability`.
   */
  productId: string | null;
  /** Ordering on the campus index. */
  order: number;
  /** Lucide icon name, resolved by the UI layer (keeps this module render-free). */
  icon: string;
}

/** A school joined to its derived state — what every surface actually renders. */
export interface SchoolView extends School {
  availability: Availability;
  /**
   * Whether lesson BODIES may exist for this school.
   *
   * A school may always be DECLARED (so the campus is complete and a visitor can
   * see where the platform is going). A lesson is a different artefact: it is prose
   * asserting how something works, and fabricating that for unbuilt software
   * poisons the support assistant, publishes false schema.org entities, and
   * generates the support load the Academy exists to deflect.
   */
  teachable: boolean;
}

/* --------------------------------- curriculum -------------------------------- */

export type Level = "intro" | "core" | "advanced";

export interface Course {
  slug: string;
  schoolId: SchoolId;
  title: string;
  description: string;
  level: Level;
  /** Lesson slugs, in teaching order. Bodies live in the lesson corpus. */
  lessonSlugs: string[];
  /** What a learner can do after finishing. Concrete, checkable outcomes. */
  outcomes: string[];
  order: number;
}

/* -------------------------------- pathways ----------------------------------- */

export type PathId =
  | "new-user"
  | "creator"
  | "business"
  | "marketplace-seller"
  | "community-manager"
  | "developer"
  | "administrator"
  | "educator"
  | "student"
  | "enterprise";

export interface PathStep {
  /** Either a course or a single lesson — journeys mix both. */
  kind: "course" | "lesson";
  slug: string;
  /** Why this step is here, shown as the step's rationale. */
  reason: string;
}

export interface LearningPath {
  id: PathId;
  slug: string;
  title: string;
  description: string;
  /** Who this is for, in their own words. */
  audience: string;
  steps: PathStep[];
  order: number;
}

/** A path joined to its derived state. */
export interface PathView extends LearningPath {
  /** Steps whose content genuinely exists today. */
  availableSteps: PathStep[];
  /** True when every step is teachable — the path can be completed end to end. */
  complete: boolean;
}

/* -------------------------------- assessments -------------------------------- */

export interface Choice {
  id: string;
  text: string;
}

export interface Question {
  id: string;
  /**
   * The lesson this question is drawn from.
   *
   * Not decoration and not analytics: it is what lets a wrong answer send the
   * reader back to the exact lesson that covers it, and it is what
   * `assessments.test.ts` uses to prove no question tests material the course
   * never taught. A question outside its course's lessons is a trick question,
   * and a trick question in a self-check teaches nothing except that the check
   * is not worth taking.
   */
  lessonSlug: string;
  prompt: string;
  choices: Choice[];
  correctChoiceId: string;
  /**
   * Why the right answer is right — shown after answering, whether the reader
   * got it right or wrong. This is the actual teaching surface; the score is
   * just the excuse to display it.
   */
  explanation: string;
}

export interface Assessment {
  /** The course this checks. One assessment per course, at most. */
  courseSlug: string;
  title: string;
  /**
   * Fraction of questions needed to pass, 0–1.
   *
   * A threshold at all is arguable for a self-check. It stays because a bare
   * score with no interpretation invites the reader to invent their own, and
   * "5/7" means nothing without knowing whether that is fine.
   */
  passMark: number;
  questions: Question[];
}

/** One graded answer. `chosenChoiceId` is null when the reader skipped it. */
export interface GradedAnswer {
  questionId: string;
  chosenChoiceId: string | null;
  correct: boolean;
  /** Where to go and read the thing this question was about. */
  lessonSlug: string;
  lessonHref: string;
}

export interface AssessmentResult {
  courseSlug: string;
  answers: GradedAnswer[];
  score: number;
  total: number;
  passed: boolean;
  /**
   * Lessons behind the questions the reader got wrong, de-duplicated and in
   * teaching order — the whole point of the exercise. A score tells someone how
   * they did; this tells them what to do about it.
   */
  reviewLessonSlugs: string[];
}
