import { describe, expect, it } from "vitest";

import { CAPTION_MAX_CHARS, clampWords, countWords, normalizeCaption } from "./caption";

describe("countWords", () => {
  it("counts whitespace-separated runs", () => {
    expect(countWords("one two three")).toBe(3);
  });

  it("is 0 for empty and whitespace-only text, not 1", () => {
    // "".split(/\s+/) is [""] — the trap this guards against, and the reason a
    // blank composer must not report "1/250 words".
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\n  ")).toBe(0);
  });

  it("does not change when the same text is reflowed into paragraphs", () => {
    const inline = "the quick brown fox jumps";
    const paragraphs = "the quick\n\nbrown fox\njumps";
    expect(countWords(paragraphs)).toBe(countWords(inline));
  });

  it("collapses runs of whitespace rather than counting them as words", () => {
    expect(countWords("a     b")).toBe(2);
  });
});

describe("clampWords", () => {
  it("leaves a caption under the limit exactly as it was", () => {
    const text = "line one\n\nline two";
    expect(clampWords(text, 10)).toBe(text);
  });

  it("keeps only the first N words", () => {
    expect(clampWords("a b c d e", 3)).toBe("a b c");
  });

  it("🔴 PRESERVES PARAGRAPHS while clamping", () => {
    // The naive split(/\s+/).slice().join(" ") would return "one two three",
    // flattening the break — destroying the formatting the same feature set
    // exists to support.
    expect(clampWords("one\n\ntwo three four", 3)).toBe("one\n\ntwo three");
  });

  it("leaves no dangling separator at the end", () => {
    expect(clampWords("a b \n\n c", 2)).toBe("a b");
    expect(clampWords("a b\n\nc", 2)).toBe("a b");
  });

  it("counts a long URL as a single word (why a char backstop is needed too)", () => {
    const url = `https://example.com/${"x".repeat(400)}`;
    expect(countWords(url)).toBe(1);
    expect(clampWords(url, 250)).toBe(url);
  });
});

describe("normalizeCaption", () => {
  it("normalises CRLF so it renders as one break under whitespace-pre-line", () => {
    expect(normalizeCaption("a\r\nb")).toBe("a\nb");
    expect(normalizeCaption("a\rb")).toBe("a\nb");
  });

  it("collapses a run of blank lines to a single blank line", () => {
    expect(normalizeCaption("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("keeps a deliberate single paragraph break", () => {
    expect(normalizeCaption("a\n\nb")).toBe("a\n\nb");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeCaption("  \n hello \n  ")).toBe("hello");
  });

  it("enforces the word limit", () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    expect(countWords(normalizeCaption(long))).toBe(250);
  });

  it("enforces the character backstop against a single enormous word", () => {
    const blob = "x".repeat(CAPTION_MAX_CHARS + 500);
    expect(normalizeCaption(blob)).toHaveLength(CAPTION_MAX_CHARS);
  });
});
