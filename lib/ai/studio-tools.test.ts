import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FRENZ_AI_STUDIO_TOOLS, frenzAiStudioTool, openableFrenzAiTools, type FrenzAiStudioTool } from "./studio-tools";

const ROOT = path.resolve(__dirname, "../..");

/**
 * The Frenz AI hub's catalogue, held to the same rule as every other registry
 * here: a tool that claims a destination must have one, and a tool that has no
 * destination must not claim to be openable.
 */

/** Registry problems, in the same shape the platform registries' tests use. */
function problems(tools: readonly Pick<FrenzAiStudioTool, "id" | "href" | "status" | "note">[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.id)) found.push(`duplicate id: "${tool.id}"`);
    seen.add(tool.id);

    if (tool.status === "soon") {
      if (tool.href !== null) found.push(`"${tool.id}" is coming soon but links to ${tool.href}`);
    } else {
      if (!tool.href) {
        found.push(`"${tool.id}" is openable but names no route`);
      } else {
        // Resolved against the App Router the way the settings registry does it:
        // /studio/ai/clean must be served by app/(app)/studio/ai/clean/page.tsx.
        const page = path.join(ROOT, "app", "(app)", ...tool.href.replace(/^\//, "").split("/"), "page.tsx");
        if (!existsSync(page)) found.push(`"${tool.id}" points at ${tool.href}, which nothing serves`);
      }
    }

    if (tool.note.length < 20) found.push(`"${tool.id}" has no real note about what is missing`);
  }
  return found;
}

describe("Frenz AI tool catalogue", () => {
  it("🔴 never offers a tool that goes nowhere", () => {
    const found = problems(FRENZ_AI_STUDIO_TOOLS);
    expect(found, found.join("\n")).toEqual([]);
  });

  it("ships AI Clean as the first tool", () => {
    expect(FRENZ_AI_STUDIO_TOOLS[0]?.id).toBe("clean");
    expect(frenzAiStudioTool("clean")?.href).toBe("/studio/ai/clean");
  });

  it("does not claim AI Clean can process anything yet", () => {
    // Part 1 is the interface. `preview` is the status that says so, and it is
    // what the hub card and the ready state are both written against.
    expect(frenzAiStudioTool("clean")?.status).toBe("preview");
  });

  it("only lists tools with a page as openable", () => {
    expect(openableFrenzAiTools().map((t) => t.id)).toEqual(["clean"]);
  });

  it("returns null for a tool that does not exist", () => {
    expect(frenzAiStudioTool("nope")).toBeNull();
  });
});

describe("the source check has teeth", () => {
  it("catches an openable tool pointing at a route nothing serves", () => {
    expect(
      problems([{ id: "ghost", href: "/studio/ai/ghost", status: "preview", note: "a note long enough to pass" }]),
    ).toEqual(['"ghost" points at /studio/ai/ghost, which nothing serves']);
  });

  it("catches a coming-soon tool that links somewhere anyway", () => {
    expect(
      problems([{ id: "early", href: "/studio/ai/clean", status: "soon", note: "a note long enough to pass" }]),
    ).toEqual(['"early" is coming soon but links to /studio/ai/clean']);
  });
});
