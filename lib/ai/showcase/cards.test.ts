import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CARD_TOOLS, cardFiles, normalizeShowcaseCards } from "./cards";

const SUPA = "https://example.supabase.co";
const ours = (n: string) => `${SUPA}/storage/v1/object/public/ai-showcase/slides/${n}`;
const image = { sm: ours("a-720.webp"), lg: ours("a-1280.webp"), width: 1280, height: 800 };
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("tool cards (owner 2026-10-07: the hub's cards set up in admin)", () => {
  it("covers every card the hub draws — including the three no slide can open", () => {
    expect(Object.keys(CARD_TOOLS)).toEqual(expect.arrayContaining(["audio_library", "voice_library", "history", "text_to_audio", "voice_clone"]));
    const grid = read("features/ai/frenz-ai-tools-grid.tsx");
    for (const id of Object.keys(CARD_TOOLS)) expect(grid).toContain(`id: "${id}"`);
  });

  it("keeps our uploads, drops unknown tools and foreign hosts", () => {
    const out = normalizeShowcaseCards(
      {
        text_to_audio: { image, video: { url: ours("v.mp4"), bytes: 10 } },
        audio_library: { image: { ...image, sm: "https://evil.example/x.webp" } },
        not_a_tool: { image },
      },
      SUPA,
    );
    expect(Object.keys(out)).toEqual(["text_to_audio"]);
    expect(out.text_to_audio?.video?.url).toBe(ours("v.mp4"));
  });

  it("a clip without its poster picture is refused (never a black box)", () => {
    expect(normalizeShowcaseCards({ history: { image: null, video: { url: ours("v.mp4"), bytes: 1 } } }, SUPA)).toEqual({});
  });

  it("lists every stored file for cleanup", () => {
    expect(cardFiles({ history: { image, video: { url: ours("v.mp4"), bytes: 1 } } }).sort()).toEqual([image.lg, image.sm, ours("v.mp4")].sort());
  });

  it("saving slides keeps the cards and saving cards keeps the slides (one shared row)", () => {
    const server = read("lib/ai/showcase/server.ts");
    expect(server).toContain("slides: next.slides ?? ");
    expect(server).toContain("cards: next.cards ?? ");
    const route = read("app/api/admin/ai/showcase/route.ts");
    expect(route).toContain("writeStoredShowcase({ slides: slidesIn, cards: cardsIn })");
    // a cleanup that forgot the cards would delete a card's live picture on the next slide save
    expect(route).toContain("...cardFiles(cards)");
  });

  it("a card's own picture wins over a slide's", () => {
    const explore = read("features/ai/frenz-ai-explore.tsx");
    expect(explore.indexOf("Object.entries(cards ?? {})")).toBeLessThan(explore.indexOf("for (const s of slides)"));
  });
});
