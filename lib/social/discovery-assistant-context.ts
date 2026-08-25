import { categoryLabel } from "./categories";
import { getFrenzDna } from "./frenz-dna";
import { getFeed } from "./feed";
import { getNewCreators } from "./suggest";
import { listTrendingSounds } from "./sounds";

/**
 * Smart Discovery Assistant grounding data (Feature 15 Part 8) — a compact,
 * plain-text block of REAL facts about this viewer, built server-side from
 * data functions that already exist elsewhere in this Part (FrenzDNA, new
 * creators, trending). Passed to /api/assistant as `context`. Deliberately
 * short and entirely factual: every line here is something the assistant is
 * allowed to state as true, and nothing it isn't given here should be
 * treated as true — see the system-prompt instruction in
 * app/api/assistant/route.ts.
 */
export async function buildDiscoveryContext(viewerId: string | null): Promise<string> {
  const [interests, creators, trending, sounds] = await Promise.all([
    getFrenzDna(viewerId),
    getNewCreators(viewerId, 4),
    getFeed({ sort: "trending", viewerId, limit: 5 }),
    listTrendingSounds({ limit: 3 }),
  ]);

  const lines: string[] = [];

  if (interests.length > 0) {
    lines.push(`Viewer's top interests (from their own likes/saves/watch history, strongest first): ${interests.slice(0, 5).map((i) => categoryLabel(i.category)).join(", ")}.`);
  } else {
    lines.push("Viewer has no recorded interests yet (too new, or hasn't engaged with much content).");
  }

  if (creators.length > 0) {
    lines.push(
      `New/emerging creators not yet followed by the viewer: ${creators.map((c) => `@${c.handle} (${c.followersCount} followers)`).join(", ")}.`,
    );
  }

  if (trending.length > 0) {
    lines.push(`Currently trending posts: ${trending.map((p) => `"${p.title}"${p.category ? ` (${categoryLabel(p.category)})` : ""}`).join("; ")}.`);
  }

  if (sounds.length > 0) {
    lines.push(`Trending sounds: ${sounds.map((s) => `"${s.title}" by ${s.artistLabel}`).join("; ")}.`);
  }

  return lines.join("\n");
}
