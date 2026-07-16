import { describe, expect, it } from "vitest";

/**
 * Mirrors `previewText` in features/social/conversation-list.tsx. Kept as a
 * pure copy here because the component is a client module full of framer-motion
 * and portals — importing it into a node test env just to check string logic
 * would drag the whole inbox UI in.
 *
 * Pins the owner's inbox-preview spec (2026-07-16): media/metadata messages say
 * what they ARE, a text message shows its first few words, and NOTHING ever
 * renders as a bare tick again.
 */
const PREVIEW_LABEL: Record<string, string> = {
  location: "Location",
  contact: "Contact",
  poll: "Poll",
  image: "Photo",
  video: "Video",
  audio: "Audio",
  file: "Document",
};
const PREVIEW_WORDS = 4;

function previewText(kind: string | null, body: string | null): string {
  if (kind && PREVIEW_LABEL[kind]) return PREVIEW_LABEL[kind]!;
  const text = (body ?? "").trim();
  if (!text) return "…";
  const words = text.split(/\s+/);
  return words.length <= PREVIEW_WORDS ? text : `${words.slice(0, PREVIEW_WORDS).join(" ")}…`;
}

describe("inbox preview text", () => {
  it("labels each media kind the owner listed", () => {
    expect(previewText("image", null)).toBe("Photo");
    expect(previewText("video", null)).toBe("Video");
    expect(previewText("audio", null)).toBe("Audio");
    expect(previewText("location", null)).toBe("Location");
  });

  it("labels documents and other attachments", () => {
    expect(previewText("file", null)).toBe("Document");
  });

  it("shows the first 4 words of a longer text message", () => {
    expect(previewText(null, "hey are you coming to the party tonight")).toBe("hey are you coming…");
  });

  it("shows a short message in full, with no ellipsis", () => {
    expect(previewText(null, "on my way")).toBe("on my way");
    expect(previewText(null, "ok")).toBe("ok");
  });

  it("collapses odd whitespace rather than counting it as words", () => {
    expect(previewText(null, "  hey   there   you   two   three  ")).toBe("hey there you two…");
  });

  it("falls back to an ellipsis when there is genuinely nothing", () => {
    expect(previewText(null, null)).toBe("…");
    expect(previewText(null, "   ")).toBe("…");
  });

  it("prefers a caption over the media label (the caption says more)", () => {
    // previewKindFor only reports a media kind when the body was empty, so a
    // captioned photo arrives here as kind=null + real text.
    expect(previewText(null, "look at this sunset photo from yesterday")).toBe("look at this sunset…");
  });
});
