import { describe, expect, it } from "vitest";

import { circleSuggestions, type SuggestionConnection } from "./circle-suggestions";

const c = (id: string, over: Partial<SuggestionConnection> = {}): SuggestionConnection => ({ id, band: "steady", favorite: false, label: null, circleIds: [], ...over });

describe("Smart Circle suggestions (Feature 19 · Part 4)", () => {
  it("suggests Close friends from the member's own favourites, close labels and closest friends", () => {
    const s = circleSuggestions([c("a", { band: "close" }), c("b", { favorite: true }), c("d", { label: "best_friend" }), c("e")], []);
    expect(s.find((x) => x.key === "close_friends")?.memberIds).toEqual(["a", "b", "d"]);
  });

  it("suggests Family and VIP from the member's own labels", () => {
    const s = circleSuggestions([c("f1", { label: "family" }), c("f2", { label: "family" }), c("w1", { label: "mentor" }), c("w2", { label: "client" })], []);
    expect(s.map((x) => x.key)).toEqual(["family", "vip"]);
  });

  it("teeth: people already in the circle are not suggested, and a single person is not a group", () => {
    const circles = [{ id: "cf", name: "Close friends", kind: "close_friends" }];
    const s = circleSuggestions([c("a", { band: "close", circleIds: ["cf"] }), c("b", { favorite: true, circleIds: ["cf"] }), c("x", { label: "family" })], circles);
    expect(s).toEqual([]);
  });

  it("every suggestion says why", () => {
    const s = circleSuggestions([c("a", { band: "close" }), c("b", { band: "close" })], []);
    expect(s[0]!.reason.length).toBeGreaterThan(10);
  });
});
