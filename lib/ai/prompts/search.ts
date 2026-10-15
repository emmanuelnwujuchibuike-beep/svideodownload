/**
 * Prompt library search — instant and local: no request per keystroke, no analytics per
 * keystroke. Every word typed must match the suggestion somewhere (title, description, its
 * category, its tags, what it needs), with a few everyday synonyms so "advert", "cartoon" or
 * "African movie" find what people mean. Title matches rank first.
 */

import type { PromptCategory, PromptSuggestion } from "./schema";

const SYNONYMS: Record<string, string[]> = {
  advert: ["advertisement", "commercial", "ad", "advertising", "promo"],
  ad: ["advertisement", "commercial", "advertising"],
  ads: ["advertisement", "commercial", "advertising"],
  commercial: ["advertisement", "advert"],
  cartoon: ["animated", "animation", "cartoons"],
  movie: ["film", "cinematic", "movies"],
  film: ["movie", "cinematic"],
  replace: ["replacement", "swap"],
  swap: ["replace", "replacement"],
  product: ["products", "e-commerce", "ecommerce"],
  animal: ["animals", "wildlife", "pet"],
  animals: ["animal", "wildlife"],
  pet: ["pets", "dog", "cat"],
  funny: ["comedy", "humor"],
  comedy: ["funny"],
  scary: ["horror"],
  music: ["song", "dance", "performance"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export interface IndexedSuggestion {
  s: PromptSuggestion;
  title: string;
  hay: string;
}

/** Build once per open — every field a person might search, lower-cased. */
export function indexSuggestions(list: readonly PromptSuggestion[], categories: readonly PromptCategory[]): IndexedSuggestion[] {
  const cat = new Map(categories.map((c) => [c.id, c.title]));
  return list.map((s) => {
    const need = s.requiredAssets === "none" ? "" : `needs ${s.requiredAssets.replace(/-/g, " ")} reference${s.supportedModelCapabilities.includes("reference_video_edit") ? " reference video edit" : ""}`;
    return {
      s,
      title: norm(s.title),
      hay: norm([s.title, s.description, cat.get(s.category) ?? "", s.tags.join(" "), need, s.mode.replace(/_/g, " ")].join(" ")),
    };
  });
}

/** 2 = the whole word is there, 1 = a word starts with it (still typing), 0 = absent */
function wordMatch(hay: string, word: string): number {
  const at = ` ${hay} `;
  if (at.includes(` ${word} `)) return 2;
  return at.includes(` ${word}`) ? 1 : 0;
}

/** Suggestions matching every word of `query` (all of them for an empty query), best first. */
export function searchSuggestions(index: readonly IndexedSuggestion[], query: string): PromptSuggestion[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return index.map((x) => x.s);
  const hits: { s: PromptSuggestion; score: number }[] = [];
  for (const x of index) {
    let score = 0;
    let ok = true;
    for (const w of words) {
      const alts = [w, ...(SYNONYMS[w] ?? [])];
      // a title hit counts most, a whole word more than a word that merely starts with it ("advert" ≠ "adventure")
      const inTitle = Math.max(...alts.map((a) => wordMatch(x.title, a)));
      const inHay = Math.max(...alts.map((a) => wordMatch(x.hay, a)));
      if (!inTitle && !inHay) {
        ok = false;
        break;
      }
      score += inTitle * 3 + inHay;
    }
    if (ok) hits.push({ s: x.s, score });
  }
  return hits.sort((a, b) => b.score - a.score || a.s.sortOrder - b.s.sortOrder).map((h) => h.s);
}
