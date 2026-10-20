import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Step 17 — the AI Studio to design/AIExplore.dc.html with the owner's notes (2026-10-19).
 * Pinned to the source, each rule with a case that fails when it's taken out.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const page = src("features/ai/frenz-ai-explore.tsx");

function rules(s: string) {
  return {
    header: s.includes(">AI Studio</h1>") && s.includes("<AiCreditsChip />") && s.includes("Your photos and videos stay on your device until you press Create."),
    chips: ["All", "Video", "Audio", "Yours", "Models"].every((l) => s.includes(`label: "${l}" }`)) && s.includes("scrollIntoView"),
    // the real third audio tool, not the design's placeholder
    realAudio: s.includes('const audio = [tool("text_to_audio"), tool("voice_clone"), tool("audio_library")];') && !s.includes("[Third audio tool]"),
    // only the models this app runs, by their real ids
    realModels: s.includes('id: "kling-v3-omni"') && s.includes('id: "kling-lip-sync"') && !/version: "(4\.0|2\.6|O3|O1)"/.test(s),
    // the Business tag only for a Business member; the complimentary note only when it applies
    credits: s.includes('entitlement?.audience === "business"') && s.includes("{business ? <span") && s.includes("free?.enabled && free.message"),
    // the old sections are gone
    removed: !/ai-how-title|HOW.map|AiButtonLink|ArrowLeft/.test(s),
  };
}

describe("the AI Studio (step 17)", () => {
  it("keeps every rule of the design and the owner's notes", () => {
    expect(rules(page)).toEqual({ header: true, chips: true, realAudio: true, realModels: true, credits: true, removed: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(page.replace(">AI Studio</h1>", ">Explore</h1>")).header).toBe(false);
    expect(rules(page.replace('label: "Models" }', 'label: "More" }')).chips).toBe(false);
    expect(rules(page.replace('tool("audio_library")', '"[Third audio tool]"')).realAudio).toBe(false);
    expect(rules(page + '\n{ version: "4.0" }').realModels).toBe(false);
    expect(rules(page.replace("{business ? <span", "{true ? <span")).credits).toBe(false);
    expect(rules(page + "\nHOW.map").removed).toBe(false);
  });
});
