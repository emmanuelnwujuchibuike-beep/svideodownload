import { describe, expect, it } from "vitest";

import {
  canApplyLabel,
  isBuiltInLabel,
  labelDisplay,
  labelsByGroup,
  MAX_CUSTOM_LABEL_LENGTH,
  RELATIONSHIP_LABELS,
  relationshipLabel,
  resolveLabelInput,
  validateCustomLabel,
} from "@/lib/social/graph/labels";

describe("built-in labels", () => {
  it("has no duplicate keys and every one is reachable", () => {
    const keys = RELATIONSHIP_LABELS.map((l) => l.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(relationshipLabel(k)).toBeDefined();
  });

  it("groups every label exactly once", () => {
    const grouped = labelsByGroup().flatMap((g) => g.items);
    expect(grouped).toHaveLength(RELATIONSHIP_LABELS.length);
  });

  it("requires a real friendship for the labels that claim closeness", () => {
    for (const key of ["best_friend", "close_friend", "partner", "family"]) {
      expect(relationshipLabel(key)!.requiresFriendship, key).toBe(true);
      expect(canApplyLabel(key, { isFriend: false })).toBe(false);
      expect(canApplyLabel(key, { isFriend: true })).toBe(true);
    }
  });

  it("lets working relationships be labelled without a friendship", () => {
    expect(canApplyLabel("colleague", { isFriend: false })).toBe(true);
    expect(canApplyLabel("client", { isFriend: false })).toBe(true);
    expect(canApplyLabel("creator", { isFriend: false })).toBe(true);
  });

  it("makes no claim about custom labels", () => {
    expect(canApplyLabel("Gym buddy", { isFriend: false })).toBe(true);
  });
});

describe("custom label validation", () => {
  it("accepts an ordinary label and tidies whitespace", () => {
    expect(validateCustomLabel("  Gym   buddy ")).toEqual({ ok: true, value: "Gym buddy" });
  });

  it("rejects an empty label", () => {
    expect(validateCustomLabel("   ").ok).toBe(false);
  });

  it("rejects a label that is only invisible characters", () => {
    // Zero-width space + word joiner + BOM: renders as nothing.
    expect(validateCustomLabel("\u200b\u2060\ufeff").ok).toBe(false);
  });

  it("strips bidi overrides that could reorder the text around it", () => {
    const result = validateCustomLabel("Work\u202egnihtemos");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).not.toContain("\u202e");
  });

  it("rejects anything over the length cap", () => {
    expect(validateCustomLabel("x".repeat(MAX_CUSTOM_LABEL_LENGTH)).ok).toBe(true);
    expect(validateCustomLabel("x".repeat(MAX_CUSTOM_LABEL_LENGTH + 1)).ok).toBe(false);
  });

  // The safety case: a decorative "Blocked" that enforces nothing.
  it("refuses enforcement words and points at the real control", () => {
    for (const [word, action] of [
      ["Blocked", "block"],
      ["blocked", "block"],
      ["MUTED", "mute"],
      ["Restricted", "restrict"],
    ] as const) {
      const result = validateCustomLabel(word);
      expect(result.ok, word).toBe(false);
      if (!result.ok) expect(result.useInstead).toBe(action);
    }
  });

  it("does not refuse a word that merely contains one", () => {
    expect(validateCustomLabel("Block party").ok).toBe(true);
  });
});

describe("resolveLabelInput", () => {
  it("returns null for clearing", () => {
    expect(resolveLabelInput(null)).toBeNull();
    expect(resolveLabelInput("")).toBeNull();
    expect(resolveLabelInput("   ")).toBeNull();
  });

  it("recognises a built-in key", () => {
    expect(resolveLabelInput("mentor")).toEqual({ kind: "builtin", key: "mentor" });
  });

  it("falls through to a custom label", () => {
    expect(resolveLabelInput("Book club")).toEqual({ kind: "custom", value: "Book club" });
  });

  it("surfaces the error for a refused custom label", () => {
    const result = resolveLabelInput("Blocked");
    expect(result).toHaveProperty("error");
  });
});

describe("labelDisplay", () => {
  it("renders the human string for a built-in", () => {
    expect(labelDisplay("best_friend")).toBe("Best friend");
  });

  it("passes a custom label through", () => {
    expect(labelDisplay("Book club")).toBe("Book club");
  });

  it("returns null when there is no label", () => {
    expect(labelDisplay(null)).toBeNull();
    expect(labelDisplay("")).toBeNull();
  });

  it("does not treat an unknown key as built-in", () => {
    expect(isBuiltInLabel("boss")).toBe(false);
  });
});
