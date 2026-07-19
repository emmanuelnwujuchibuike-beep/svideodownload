import { describe, expect, it } from "vitest";

import { SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { claimableProducts, unclaimableProducts } from "@/lib/content/reality-ledger";
import { SUPPORT_ARTICLES } from "@/lib/support/articles";

import { generatedFacts } from "./corpus";
import { ASSISTANT_SYSTEM_PROMPT } from "./knowledge";

/**
 * Frenz Assistant knowledge gates.
 *
 * The assistant is the one surface that ANSWERS rather than displays, so a wrong
 * fact here is repeated to a user as though it were checked. These pin the
 * generated half against its sources.
 */

describe("generated facts", () => {
  it("names every supported platform, from the registry", () => {
    const facts = generatedFacts();
    for (const p of SHOWCASE_PLATFORMS) {
      expect(facts, `${p.name} missing from assistant knowledge`).toContain(p.name);
    }
  });

  it("names every product that exists", () => {
    const facts = generatedFacts();
    for (const p of claimableProducts()) {
      expect(facts, `${p.name} missing`).toContain(p.name);
    }
  });

  it("explicitly marks unbuilt products as not existing", () => {
    /*
     * Omission is not enough. A model asked "does Frenzsave have cloud storage?"
     * with no information either way will often say yes — plausible-sounding
     * features invite confident invention. Naming them as NOT built converts a
     * silence the model would fill into an instruction it can follow.
     */
    const facts = generatedFacts();
    const unbuilt = unclaimableProducts().filter((p) => p.id !== "admin");
    expect(unbuilt.length).toBeGreaterThan(0);

    expect(facts).toContain("DO NOT EXIST");
    for (const p of unbuilt) {
      expect(facts, `${p.name} not declared unbuilt`).toContain(p.name);
    }
  });

  it("carries the trust summaries verbatim", () => {
    // Account security, privacy and deletion are where improvisation does real
    // harm, so the assistant gets the exact summary rather than a paraphrase.
    const facts = generatedFacts();
    for (const a of SUPPORT_ARTICLES) {
      expect(facts, `${a.slug} summary missing`).toContain(a.summary);
    }
  });
});

describe("system prompt", () => {
  it("embeds the generated facts", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain(generatedFacts());
  });

  it("keeps the authored persona and boundaries", () => {
    // The half that is deliberately NOT generated.
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("Frenz Assistant");
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/never call yourself an AI assistant/i);
  });

  it("does not retype a platform list beside the generated one", () => {
    /*
     * The failure this prevents is subtle: a hand-written list that agrees today
     * and silently diverges later, leaving the prompt self-contradictory with no
     * error anywhere. There must be exactly one list.
     */
    const occurrences = ASSISTANT_SYSTEM_PROMPT.split("Supported platforms").length - 1;
    expect(occurrences, "More than one platform list in the prompt").toBe(1);
  });

  it("states no platform count that disagrees with the registry", () => {
    /*
     * "20+ platforms" reached production against a real 11, and a prompt is
     * exactly where such a number rots unnoticed because nobody re-reads it.
     *
     * The first version of this test banned counts outright and failed — the
     * prompt does contain one, inside the Download tagline. But that is DERIVED
     * from the registry, so banning it would have been banning the correct
     * behaviour. What matters is not whether a count appears; it is whether it
     * is true. So: any count present must equal the real one.
     */
    const real = SHOWCASE_PLATFORMS.length;
    const counts = [...ASSISTANT_SYSTEM_PROMPT.matchAll(/(\d+)\s*\+?\s*(?:social\s+)?platforms/gi)];

    for (const match of counts) {
      expect(
        Number(match[1]),
        `Prompt claims ${match[1]} platforms; registry has ${real}`,
      ).toBe(real);
    }
  });
});
