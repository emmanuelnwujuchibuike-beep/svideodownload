import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments stripped, so prose ABOUT a rule cannot satisfy a test of the rule. */
const code = (p: string) =>
  src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SURFACE = "features/ai/design/ai-surface.tsx";

/**
 * The Frenz AI surface — one definition of the language.
 *
 * Owner, 2026-09-27: "the instruction and design style should also apply for
 * the ai welcome page and all pages, including the character replace pages and
 * text to audio and voice cloning page."
 *
 * Every assertion here pins something that had already drifted once, or that
 * would drift silently: a page inventing its own background, a headline with
 * two gradient words, a CTA that a specificity accident can shrink, or a
 * breadcrumb that names a retired product.
 */
describe("the Frenz AI design surface", () => {
  it("stays free of client-only APIs, so composing it cannot pull a page across the boundary", () => {
    /*
      These render inside workspaces that are already client components. Marking
      a shared primitive "use client" would drag every page that composes it
      over the boundary — a mistake this project has paid for before.
    */
    const body = code(SURFACE);
    expect(body).not.toMatch(/^"use client"/m);
    expect(body).not.toMatch(/\buseState\b|\buseEffect\b|\buseRef\b|onClick=/);
  });

  it("carries no dark-mode variants — the brief is light only", () => {
    expect(code(SURFACE)).not.toMatch(/dark:/);
  });

  it("requires the tool name on the hero, so no page can announce a retired product", () => {
    /*
      🔴 The component this replaces hard-coded its breadcrumb to "AI Clean" — a
      product that is RETIRED and must never be re-added — and defaulted its
      headline to that tool's copy. It was rendered nowhere, which is the only
      reason it never shipped. A required prop makes the same mistake impossible
      rather than unlikely.
    */
    const body = code(SURFACE);
    expect(body).toMatch(/tool: string;/);
    // no default value for it
    expect(body).not.toMatch(/tool = "/);
    // and the retired product is not named anywhere in the surface
    expect(body).not.toMatch(/AI Clean/i);
  });

  it("holds the primary action at 56px in two independent ways", () => {
    /*
      A global `a[href] { min-height: var(--tap) }` once clamped every link's
      utility `min-h-*` because (0,1,1) beats (0,1,0): a CTA that measured 56px
      in the markup rendered at 26px on the device. Setting the height twice
      means a specificity accident cannot silently shrink it again.
    */
    const body = code(SURFACE);
    expect(body).toMatch(/h-14 min-h-\[3\.5rem\]/);
  });

  it("keeps exactly one gradient action — the secondary is glass, never a gradient", () => {
    const body = code(SURFACE);
    // Bounded to the function itself. Slicing to end-of-file was always
    // fragile and broke the moment AiHeroStage was appended below it — a test
    // that fails on unrelated growth teaches people to delete tests.
    const from = body.indexOf("function AiSecondaryAction");
    const secondary = body.slice(from, body.indexOf("\n}", from));
    expect(secondary).not.toMatch(/ai-cta|bg-gradient-to/);
  });
});

describe("the AI ground is defined once", () => {
  it("lives in globals.css as .ai-wash", () => {
    expect(src("app/globals.css")).toMatch(/\.ai-wash \{/);
  });

  it("is not re-invented inline by the page that adopts the surface", () => {
    /*
      🔴 THE DRIFT THIS EXISTS TO STOP. Before this, every AI screen hand-rolled
      its own background: the welcome page alone carried four `radial-gradient`
      strings inline, so two pages a member moves between in one tap were
      literally different colours.
    */
    /*
      Every page-level surface, now that the migration is finished. A page-level
      wash is a background behind a whole screen; the soft blurred corner glow
      inside a CARD is not one — the references have those too — so
      `bg-[radial-gradient(closest-side,...)]` on a card is deliberately allowed.

      `frenz-ai-core` and `frenz-ai-environment` are also exempt by omission:
      they are the ambient visual system (the orbs and the glow driven by
      --ai-orbit / --ai-breath / --ai-intensity / --ai-play), not a page
      background, and rewriting them would gut the thing the wash sits under.
    */
    const pages = [
      "features/ai/text-to-audio/text-to-audio-workspace.tsx",
      "features/ai/frenz-ai-welcome.tsx",
      "features/ai/frenz-ai-explore.tsx",
      "features/ai/frenz-ai-history-page.tsx",
      "features/ai/frenz-ai-usage-page.tsx",
      "features/ai/voice-clone/voice-cloning-workspace.tsx",
      "features/ai/lip-sync/lip-sync-workspace.tsx",
    ];
    for (const f of pages) {
      const body = code(f);
      // a FULL-BLEED wash of its own — the `inset-0 -z-10` shape every one of
      // these used to carry
      expect(body, `${f} still hand-rolls a page wash`).not.toMatch(
        /absolute inset-0 -z-10[^]{0,200}radial-gradient/,
      );
    }
  });
});

describe("every migrated tool opens with the breadcrumb pill", () => {
  /*
    Each of these opened with a hand-rolled uppercase eyebrow where both
    references put the pill — so a tool reached from the studio looked like a
    different product from the one just left.

    ⚠️ Voice Cloning's eyebrow read "Frenz AI · Audio": copied from Text to
    Audio and never corrected, so it announced itself as the wrong tool
    entirely. A required `tool` prop cannot be wrong by omission the way a
    pasted string can.
  */
  const tools: [string, string][] = [
    ["features/ai/text-to-audio/text-to-audio-workspace.tsx", "Text to Audio"],
    ["features/ai/voice-clone/voice-cloning-workspace.tsx", "Voice Cloning"],
    ["features/ai/lip-sync/lip-sync-workspace.tsx", "Lip Sync Pro"],
    ["features/ai/frenz-ai-welcome.tsx", "AI Studio"],
    ["features/ai/frenz-ai-explore.tsx", "Explore"],
  ];

  for (const [file, tool] of tools) {
    it(`${tool} uses the shared hero`, () => {
      const body = code(file);
      expect(body).toMatch(/<AiHero/);
      expect(body).toContain(`tool="${tool}"`);
      // the eyebrow it replaced, in any of its pasted forms
      // Escaped. Unescaped, `[0.1[46]em]` is a character class and this passes
      // against almost anything — the same trap that made an earlier assertion
      // in this file meaningless.
      expect(body, "a hand-rolled eyebrow survived").not.toMatch(
        /uppercase tracking-[0.1[46]em][^]{0,160}Frenz AI ·/,
      );
    });
  }
});

describe("Character Replace shares the display type", () => {
  it("composes AiDisplayTitle instead of keeping its own copy", () => {
    /*
      🔴 IDENTICAL TODAY IS THE PROBLEM. This screen kept a private `Headline`
      whose classes were byte-identical to the shared hero's, across seven
      steps. The next change to the scale would have moved every other AI screen
      and left this one behind — silently, on the product with the most screens.
    */
    const body = code("features/ai/character-replace/character-replace-workspace.tsx");
    expect(body).toMatch(/<AiDisplayTitle/);
    // Escaped: unescaped brackets make this a character class, which matches
    // `text-red-500` and every other utility containing one of those letters.
    expect(body).not.toMatch(/text-\[1\.95rem\]/);
  });
});

describe("the surface is APPLIED, not merely defined", () => {
  /*
    🔴 THE TEST THAT WOULD HAVE CAUGHT THE FIRST PASS (owner, 2026-09-28:
    "What did you even do? Nothing changed in the Ai upgrade pages").

    The first version of this migration shipped eight primitives and used two of
    them. `AiPageShell`, `AiGlassCard`, `AiInfoCard`, `AiPrimaryAction`,
    `AiSecondaryAction` and `AiSectionHeading` were rendered in ZERO files, and
    the one piece that was applied — `AiHero` — draws the same headline at the
    same scale with a breadcrumb pill added. Every gate was green and the pages
    looked identical, because a design system nobody composes is a refactor with
    a redesign's commit message.

    A component that is exported and never rendered is either unfinished work or
    dead weight. This test forces the choice.
  */
  const RENDERED_SOMEWHERE = [
    "AiHero",
    "AiDisplayTitle",
    "AiHeroStage",
  ];

  const files = () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(full);
      }
    };
    walk(join(process.cwd(), "features/ai"));
    return out;
  };

  it("renders every primitive it claims to have finished", () => {
    const all = files()
      .filter((f) => !f.includes("ai-surface"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const name of RENDERED_SOMEWHERE) {
      expect(all, `<${name}> is exported but rendered nowhere`).toContain(`<${name}`);
    }
  });

  it("closes the AI pages the way both references do", () => {
    /*
      `FrenzAITrustRow` — Secure · Fast · Natural Results — closes BOTH
      reference images, and had been sitting in frenz-ai-chrome.tsx rendered on
      no page at all. The allowance bar was on one page of eight.
    */
    const pages = [
      "features/ai/frenz-ai-welcome.tsx",
      "features/ai/text-to-audio/text-to-audio-workspace.tsx",
      "features/ai/voice-clone/voice-cloning-workspace.tsx",
      "features/ai/lip-sync/lip-sync-workspace.tsx",
    ];
    for (const f of pages) {
      expect(code(f), `${f} does not close with the trust row`).toContain("<FrenzAITrustRow");
    }
    expect(code("features/ai/frenz-ai-welcome.tsx")).toContain("<FrenzAIAllowanceBar");
  });

  it("gives the front door the lit centrepiece both references lead with", () => {
    expect(code("features/ai/frenz-ai-welcome.tsx")).toContain("<AiHeroStage");
  });

  it("reuses the environment's motion rather than inventing a second system", () => {
    /*
      The stage animates with .frenz-ai-orbit / .frenz-ai-breathe /
      .frenz-ai-drift, which are already paused on a hidden tab and under
      prefers-reduced-motion through --ai-play. A private @keyframes here would
      have been the same mistake in a new file — and would keep running on a
      backgrounded tab.
    */
    const body = code(SURFACE);
    expect(body).toMatch(/frenz-ai-(orbit|breathe|drift)/);
    expect(body).not.toMatch(/@keyframes|animation:/);
  });
});
