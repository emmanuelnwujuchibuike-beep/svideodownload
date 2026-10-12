import { describe, expect, it } from "vitest";

import { cleanRules, describeRule, lockScreenPayload, matchRule, MAX_RULES, rulesNeed, type DeliveryRule } from "./rules";
import { NOISY_WEEK, suggestRules } from "./suggestions";

const rule = (group: DeliveryRule["when"]["group"], then: DeliveryRule["then"], from: DeliveryRule["when"]["from"] = "anyone", id = `${group}-${then}`): DeliveryRule => ({ id, when: { group, from }, then });

describe("cleanRules — whatever arrives from a client or an imported file", () => {
  it("drops unknown shapes, groups, senders and actions", () => {
    const out = cleanRules([
      rule("social", "summary"),
      { id: "x", when: { group: "nonsense", from: "anyone" }, then: "summary" },
      { id: "y", when: { group: "social", from: "strangers" }, then: "summary" },
      { id: "z", when: { group: "social" }, then: "explode" },
      null,
      "rule",
      42,
    ]);
    expect(out).toEqual([rule("social", "summary")]);
  });
  it("is not an array → no rules", () => {
    expect(cleanRules({ rules: [] })).toEqual([]);
    expect(cleanRules(null)).toEqual([]);
  });
  it(`caps the list at ${MAX_RULES}`, () => {
    expect(cleanRules(Array.from({ length: 50 }, (_, i) => rule("social", "summary", "anyone", `r${i}`)))).toHaveLength(MAX_RULES);
  });
  it("replaces an unsafe id instead of trusting it", () => {
    expect(cleanRules([{ id: "<script>", when: { group: "social", from: "anyone" }, then: "in_app" }])[0]!.id).toBe("r0");
  });
});

describe("matchRule", () => {
  const n = { group: "social" as const, critical: false, favorite: false, closeFriend: false };
  it("first match wins, in the member's order", () => {
    expect(matchRule([rule("any", "in_app"), rule("social", "immediate")], n)?.then).toBe("in_app");
    expect(matchRule([rule("social", "immediate"), rule("any", "in_app")], n)?.then).toBe("immediate");
  });
  it("a sender rule only matches that sender", () => {
    const rules = [rule("social", "immediate", "favorites")];
    expect(matchRule(rules, n)).toBeNull();
    expect(matchRule(rules, { ...n, favorite: true })?.then).toBe("immediate");
    expect(matchRule([rule("social", "immediate", "close_friends")], { ...n, closeFriend: true })?.then).toBe("immediate");
  });
  it("NEVER touches security or a critical alert — even an 'everything → app only' rule", () => {
    const silence = [rule("any", "in_app"), rule("security", "in_app")];
    expect(matchRule(silence, { ...n, group: "security" })).toBeNull();
    expect(matchRule(silence, { ...n, critical: true })).toBeNull();
  });
  it("asks for relationship lookups only when a rule names one", () => {
    expect(rulesNeed([rule("social", "summary")])).toEqual({ favorites: false, closeFriends: false });
    expect(rulesNeed([rule("social", "summary", "close_friends")])).toEqual({ favorites: false, closeFriends: true });
  });
  it("describes a rule in words", () => {
    expect(describeRule(rule("messages", "immediate", "favorites"))).toBe("Messages from favourite friends → Push right away");
  });
});

describe("lockScreenPayload", () => {
  const p = { title: "Ada liked your post", body: "“Sunset at the beach”", genericBody: "New activity", icon: "https://cdn/ada.jpg", url: "/p/1" };
  it("hidden: no sender, no text, no photo — only that something arrived", () => {
    const out = lockScreenPayload(p, "hidden");
    expect(out.title).toBe("Frenz");
    expect(out.body).not.toContain("Sunset");
    expect(out.title).not.toContain("Ada");
    expect(out.icon).toBeUndefined();
    expect(out.url).toBe("/p/1");
  });
  it("no preview: the generic text, sender kept", () => {
    expect(lockScreenPayload(p, "no_preview")).toMatchObject({ title: "Ada liked your post", body: "New activity" });
  });
  it("full: untouched", () => {
    expect(lockScreenPayload(p, "full")).toEqual(p);
  });
});

describe("suggestRules — a counting rule, never a guess", () => {
  it(`suggests a summary for a group at ${NOISY_WEEK}+ in a week, with the real count`, () => {
    const s = suggestRules({ social: NOISY_WEEK + 5, content: 3 }, []);
    expect(s).toHaveLength(1);
    expect(s[0]!.rule).toEqual({ when: { group: "social", from: "anyone" }, then: "summary" });
    expect(s[0]!.text).toContain(String(NOISY_WEEK + 5));
  });
  it("never suggests quieting security or messages", () => {
    expect(suggestRules({ security: 500, messages: 500 }, [])).toEqual([]);
  });
  it("skips a group a rule already names, and everything after an 'any' rule", () => {
    expect(suggestRules({ social: 100 }, [rule("social", "immediate")])).toEqual([]);
    expect(suggestRules({ social: 100 }, [rule("any", "immediate")])).toEqual([]);
  });
  it("below the threshold → nothing", () => {
    expect(suggestRules({ social: NOISY_WEEK - 1 }, [])).toEqual([]);
  });
});
