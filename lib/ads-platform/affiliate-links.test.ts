import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { checkDestinationUrl } from "./creative-validation";
import { destinationHeuristics } from "./url-safety";

/*
  Owner, 2026-10-15: "https://tolt.link/httpsshopcarry1stcomaffemmanuelcr — this link
  doesn't want to work on the self ad, because of security, and this is a carry1st
  affiliate link. I want it to be able work on it and other affiliate links."
  The chain below was traced with HEAD requests on 2026-10-15.
*/
const CHAIN = [
  "https://tolt.link/httpsshopcarry1stcomaffemmanuelcr",
  "https://shop.carry1st.com/?aff=emmanuelcr",
  "https://carry1st.sng.link/Ez248/mzuf/9pbd?aff=emmanuelcr&_forward_params=1&_p=%7B%22aff%22%3A%22emmanuelcr%22%7D",
  "https://shop.carry1st.com?aff=emmanuelcr&referrer=singular_click_id%3D74cde64a-ac1d-4664-81eb-a3bdd4c7b1ed&sl_id=mzuf",
  "https://shop.carry1st.com/en/NG?aff=emmanuelcr&referrer=singular_click_id%3D74cde64a-ac1d-4664-81eb-a3bdd4c7b1ed&sl_id=mzuf",
];
const server = readFileSync(join(process.cwd(), "lib/ads-platform/server.ts"), "utf8");

describe("affiliate links work on self-serve ads", () => {
  it("every hop of the Carry1st affiliate chain passes the syntax and safety heuristics", () => {
    for (const url of CHAIN) {
      expect(checkDestinationUrl(url).status, url).toBe("valid");
      expect(destinationHeuristics(url).verdict, url).toBe("ok");
    }
  });

  it("the chain gets room for affiliate trackers: 10 hops in 8 s (it took 5 hops, ~3 s)", () => {
    expect(server).toContain("chaseRedirects(url, (hh) => blockedDomain(db, hh), { maxHops: 10, budgetMs: 8000 })");
    expect(CHAIN.length - 1).toBeLessThanOrEqual(10);
  });

  it("landing on another domain is no longer a reason to hold a link for review", () => {
    expect(server).not.toContain('review ??= "redirects_to_other_domain"');
    // the final page still gets the reputation check, and an unavailable check still means a person looks
    expect(server).toContain("const rep2 = await reputationLookup(chase.final);");
    expect(server).toContain('if (rep2 === "unavailable") review ??= "reputation_unavailable";');
  });

  it("teeth: the real dangers are still refused on any hop", () => {
    expect(destinationHeuristics("https://www.google.com/url?q=https://evil.example").verdict).toBe("block");
    expect(destinationHeuristics("https://track.example/go?url=https%3A%2F%2Fevil.example").verdict).toBe("block");
    expect(destinationHeuristics("https://paypal-login.example.com/").verdict).toBe("review");
  });
});
