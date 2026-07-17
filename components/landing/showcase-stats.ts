/**
 * Illustrative engagement numbers for the hero mockup (owner request: 30k–50k).
 *
 * Lives in its own non-client module so the SERVER component (PhoneMockup) can call
 * it directly — a `"use client"` file's exports can't be invoked from the server.
 *
 * Deliberately DETERMINISTIC (seeded off the post id): a random value would differ
 * between the server render and hydration (a mismatch), and a number that reshuffles
 * every regeneration reads as broken.
 *
 * Scope note — this is the one place the no-fake-engagement rule bends: these numbers
 * live ONLY inside the decorative phone illustration, next to the other illustrative
 * chips ("128", "3.2K"). They are not attached to any real post's page, not written
 * to the database, and not counted anywhere. Real engagement stays real everywhere it
 * is presented AS real. Do not propagate these to a surface that reports actual numbers.
 */
export function showcaseStats(id: string): { views: number; likes: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = Math.abs(h);
  const views = 30_000 + (h % 20_001); // 30k–50k
  const likes = Math.round(views * (0.07 + ((h >> 7) % 60) / 1000)); // ~7–13% of views
  return { views, likes };
}
