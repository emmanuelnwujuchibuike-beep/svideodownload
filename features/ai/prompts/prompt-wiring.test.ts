import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Owner's brief, 2026-10-15 (prompt suggestions), §5, §9, §11: choosing a prompt changes only
 * the prompt text — no generation, no credit, no request — the library is not in the first load,
 * and each tool has exactly one section.
 */
const src = (p: string) => readFileSync(p, "utf8");
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const t2v = code("features/ai/video/text-to-video-workspace.tsx");
const i2v = code("features/ai/video/image-to-video-workspace.tsx");
const ideas = code("features/ai/prompts/prompt-ideas.tsx");
const library = code("features/ai/prompts/prompt-library.tsx");

describe("one section per tool, next to its prompt field", () => {
  it.each([
    ["Text to Video", t2v, "text_to_video", "Describe your video"],
    ["Image to Video", i2v, "image_to_video", "Describe the motion"],
  ])("%s", (_name, ws, mode, label) => {
    expect(ws.match(/<PromptIdeas\b/g)).toHaveLength(1);
    expect(ws).toContain(`mode="${mode}"`);
    // INSIDE the prompt box since steps 18–19 (2026-10-19: "Explore prompts" sits in the box), which gets the ref to show the inserted text
    const box = ws.indexOf("<AiPromptBox");
    const at = ws.indexOf("<PromptIdeas", box);
    expect(at).toBeGreaterThan(box);
    expect(ws.slice(box, at)).toContain("footer={");
    expect(ws.slice(box, ws.indexOf(`label="${label}"`, box))).toContain("inputRef={promptRef}");
    // it is handed the prompt setter — never submit, the generation hook or the references' setters
    const props = ws.slice(at, ws.indexOf("/>", at));
    expect(props).toContain("onPromptChange={setPrompt}");
    expect(props).not.toMatch(/gen\.|submit|setReference(Images|Video)\b|setFirst|setDuration|setResolution|setAudio|setAspect/);
  });
});

describe("choosing a prompt only sets text", () => {
  it("the library and the section never call generation, a quote, credits or any API", () => {
    for (const c of [ideas, library]) {
      expect(c).not.toMatch(/fetch\(|useVideoGeneration|\/api\/|submit\(|sendBeacon|track\(/);
    }
  });

  it("existing text is protected: replace / add / cancel, and an empty field is filled at once", () => {
    expect(library).toContain("if (currentPrompt.trim()) setPending(s);");
    expect(library).toContain('else finish(s, "replace");');
    for (const label of ["Replace Existing Prompt", "Add to Existing Prompt", "Cancel"]) expect(library).toContain(label);
  });

  it("nothing is switched for the member: the edit mode is a button they press, and Image to Video only points to Text to Video", () => {
    expect(t2v).toContain('onUseEditMode={() => setReferenceVideoMode("base")}');
    expect(ideas).toContain("<button type=\"button\" onClick={onUseEditMode}");
    expect(ideas).not.toMatch(/useEffect\([^)]*onUseEditMode/);
  });
});

describe("weight", () => {
  it("the library (and the catalog) is a dynamic import; the workspace imports only its types", () => {
    expect(ideas).toContain('import("./prompt-library")');
    expect(src("features/ai/prompts/prompt-ideas.tsx")).toMatch(/import type \{ PromptLibraryProps \} from "\.\/prompt-library";/);
    expect(ideas).not.toMatch(/from "@\/lib\/ai\/prompts\/catalog/);
    for (const ws of [t2v, i2v]) expect(ws).not.toMatch(/prompt-library|lib\/ai\/prompts\/catalog/);
  });

  it("long lists render a page at a time", () => {
    expect(library).toContain("rows.slice(0, shown)");
    expect(library).toContain("new IntersectionObserver");
  });
});

describe("accessibility", () => {
  it("a labelled modal dialog: Escape closes, focus stays inside, focus returns to the button", () => {
    expect(library).toContain('role="dialog"');
    expect(library).toContain('aria-modal="true"');
    expect(library).toContain("aria-labelledby={titleId}");
    expect(library).toContain('if (e.key === "Escape")');
    expect(library).toContain('if (e.key !== "Tab" || !panel.current) return;');
    expect(ideas).toContain("requestAnimationFrame(() => trigger.current?.focus());");
  });

  it("the prompt preview is exactly the inserted text, so the page translator leaves it alone", () => {
    expect(src("features/ai/prompts/prompt-library.tsx")).toContain("<p id={previewId} translate=\"no\"");
  });

  it("the empty state says what to do", () => {
    expect(library).toContain("No matching prompts found.");
    expect(library).toContain("Try another keyword or write your own prompt.");
  });
});
