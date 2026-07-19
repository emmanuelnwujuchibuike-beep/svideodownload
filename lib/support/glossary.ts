import type { GlossaryTerm } from "./types";

/**
 * Glossary — plain definitions, and the entity anchors of the knowledge graph.
 *
 * ── Two jobs, one corpus ──────────────────────────────────────────────────────
 *
 * For readers: this product sits on top of a pile of jargon people are expected
 * to already know — rendition, sidecar captions, generation loss, watermark-free.
 * A guide that uses those terms without defining them anywhere is only readable
 * by someone who did not need it.
 *
 * For machines: each term becomes a schema.org `DefinedTerm`, which is what makes
 * a knowledge graph legible rather than just linked. Search engines and AI
 * crawlers use defined terms to work out what a site is ABOUT, not merely what it
 * mentions — the difference between being indexed and being understood.
 *
 * ── The rule for writing one ──────────────────────────────────────────────────
 *
 * A definition may not require another definition to parse. Jargon defined by
 * more jargon is the failure mode of every glossary ever written, and it is worse
 * than no glossary because it looks like help.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────────
 *
 * Terms that appear in OUR corpus and would genuinely stop someone. Not a
 * dictionary of video technology — an unused entry is a page with no inbound
 * links and nothing to say, which is exactly the thin content the Discovery work
 * exists to avoid.
 */
export const GLOSSARY: GlossaryTerm[] = [
  {
    slug: "rendition",
    term: "Rendition",
    definition:
      "One of several versions of the same video that a platform stores, differing in resolution and file size. When you pick a quality, you are choosing a rendition — not changing the video.",
    aliases: ["quality", "resolution", "format"],
    related: ["bitrate", "generation-loss"],
  },
  {
    slug: "generation-loss",
    term: "Generation loss",
    definition:
      "Quality lost each time a video is re-encoded. Every save after an edit throws away detail permanently, so repeated rounds of editing and re-uploading degrade a clip even if nothing visible was changed.",
    aliases: ["re-encoding", "recompression", "transcoding loss"],
    related: ["rendition", "bitrate", "lossless"],
  },
  {
    slug: "bitrate",
    term: "Bitrate",
    definition:
      "How much data is used per second of video. Higher bitrate means more detail and a bigger file. It matters more than resolution: a 1080p video at a low bitrate looks worse than a well-encoded 720p one.",
    aliases: ["bit rate", "kbps", "mbps"],
    related: ["rendition", "generation-loss"],
  },
  {
    slug: "lossless",
    term: "Lossless",
    definition:
      "A way of storing media that discards nothing, so quality never degrades. Most video you encounter is the opposite — lossy — which is why re-saving it repeatedly costs quality.",
    aliases: ["lossy"],
    related: ["generation-loss", "bitrate"],
  },
  {
    slug: "sidecar-captions",
    term: "Sidecar captions",
    definition:
      "Captions kept in a separate file alongside the video rather than drawn into the picture. They can be switched off, translated and read by search engines — but only where the player supports them.",
    aliases: ["srt", "vtt", "subtitle file", "closed captions"],
    related: ["burned-in-captions"],
  },
  {
    slug: "burned-in-captions",
    term: "Burned-in captions",
    definition:
      "Captions drawn permanently into the video picture. They appear everywhere, including players that ignore subtitle files, but they cannot be turned off, restyled or translated afterwards.",
    aliases: ["hardcoded subtitles", "open captions", "hardsubs"],
    related: ["sidecar-captions"],
  },
  {
    slug: "watermark-free",
    term: "Watermark-free",
    definition:
      "A saved file without the overlay a platform adds to identify itself. It refers to the platform's badge, not to any watermark the original creator put there — and it does not change who owns the video.",
    aliases: ["no watermark", "without watermark"],
    related: ["public-post"],
  },
  {
    slug: "public-post",
    term: "Public post",
    definition:
      "A post anyone can open without signing in or being approved. It is the boundary for what can be saved: private, follower-only, deleted and expired content cannot be retrieved by any tool.",
    aliases: ["public content", "publicly visible"],
    related: ["watermark-free", "hidden-account"],
  },
  {
    slug: "hidden-account",
    term: "Hidden account",
    definition:
      "An account whose profile and posts are narrowed to friends. It is a visibility choice you make and reverse at will — distinct from suspension, which is an enforcement action taken about an account.",
    aliases: ["private account", "hide my account"],
    related: ["public-post", "step-up-check"],
  },
  {
    slug: "step-up-check",
    term: "Step-up check",
    definition:
      "Being asked to confirm who you are again during an already signed-in session, before something sensitive. It exists because the realistic risk is someone reaching an unlocked device, not breaking your sign-in.",
    aliases: ["re-authentication", "reauth", "confirm identity"],
    related: ["passkey", "hidden-account"],
  },
  {
    slug: "passkey",
    term: "Passkey",
    definition:
      "A sign-in method tied to a device you unlock with a fingerprint, face or device PIN. The secret never leaves the device, so there is nothing for a fake sign-in page to capture.",
    aliases: ["webauthn", "biometric login", "face id login"],
    related: ["step-up-check", "recovery-code"],
  },
  {
    slug: "recovery-code",
    term: "Recovery code",
    definition:
      "A single-use code that gets you in when your usual method is unavailable. Each works once, and they must be stored somewhere that does not depend on the account they recover.",
    aliases: ["backup code", "recovery key"],
    related: ["passkey", "step-up-check"],
  },
];

/* ----------------------------------- reads ----------------------------------- */

const BY_SLUG = new Map(GLOSSARY.map((t) => [t.slug, t]));

export const GLOSSARY_SLUGS: string[] = GLOSSARY.map((t) => t.slug);

export function getTerm(slug: string): GlossaryTerm | undefined {
  return BY_SLUG.get(slug);
}

/** Alphabetical by term, which is the only order a glossary may sensibly use. */
export function sortedGlossary(): GlossaryTerm[] {
  return [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
}

export function relatedTerms(slug: string): GlossaryTerm[] {
  const term = BY_SLUG.get(slug);
  if (!term) return [];
  return term.related.map((s) => BY_SLUG.get(s)).filter((t): t is GlossaryTerm => Boolean(t));
}
