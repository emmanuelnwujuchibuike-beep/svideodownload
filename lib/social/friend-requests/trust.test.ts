import { describe, expect, it } from "vitest";

import {
  DAILY_NEW,
  DAILY_STANDARD,
  DAILY_TRUSTED,
  HOURLY_BURST,
  noteFingerprint,
  noteProblem,
  policyAllows,
  requestAllowance,
  type SenderFacts,
} from "./trust";

const base: SenderFacts = { accountAgeDays: 30, verified: false, friends: 3, sentLastDay: 0, sentLastHour: 0, sentLastWeek: 0, refusedLastWeek: 0 };

describe("who may send a request (Feature 19 · Part 2, request privacy)", () => {
  it("each policy admits exactly who it names", () => {
    expect(policyAllows("everyone", { mutualFriends: 0, verified: false })).toBe(true);
    expect(policyAllows("friends_of_friends", { mutualFriends: 1, verified: false })).toBe(true);
    expect(policyAllows("verified", { mutualFriends: 0, verified: true })).toBe(true);
  });
  it("teeth: nobody means nobody, and the narrow policies refuse strangers", () => {
    expect(policyAllows("nobody", { mutualFriends: 50, verified: true })).toBe(false);
    expect(policyAllows("friends_of_friends", { mutualFriends: 0, verified: true })).toBe(false);
    expect(policyAllows("verified", { mutualFriends: 9, verified: false })).toBe(false);
  });
  it("a missing or unknown policy (before 0216 runs) reads as the default, everyone", () => {
    expect(policyAllows(undefined, { mutualFriends: 0, verified: false })).toBe(true);
    expect(policyAllows("weird", { mutualFriends: 0, verified: false })).toBe(true);
  });
});

describe("adaptive limits", () => {
  it("new accounts get less, established or verified members more", () => {
    expect(requestAllowance({ ...base, accountAgeDays: 2 })).toMatchObject({ ok: true, dailyCap: DAILY_NEW, tier: "new" });
    expect(requestAllowance(base)).toMatchObject({ ok: true, dailyCap: DAILY_STANDARD, tier: "standard" });
    expect(requestAllowance({ ...base, accountAgeDays: 200, friends: 25 })).toMatchObject({ ok: true, dailyCap: DAILY_TRUSTED, tier: "trusted" });
    expect(requestAllowance({ ...base, accountAgeDays: 1, verified: true })).toMatchObject({ ok: true, dailyCap: DAILY_TRUSTED });
  });
  it("teeth: the day's cap and the hourly burst both stop a sender", () => {
    expect(requestAllowance({ ...base, sentLastDay: DAILY_STANDARD })).toMatchObject({ ok: false, reason: "daily" });
    expect(requestAllowance({ ...base, sentLastHour: HOURLY_BURST })).toMatchObject({ ok: false, reason: "hourly" });
  });
  it("teeth: mostly-refused requests halve the allowance; nearly-all-refused pause it", () => {
    expect(requestAllowance({ ...base, sentLastWeek: 20, refusedLastWeek: 13 })).toMatchObject({ ok: true, dailyCap: DAILY_STANDARD / 2, reduced: true });
    expect(requestAllowance({ ...base, sentLastWeek: 20, refusedLastWeek: 18 })).toMatchObject({ ok: false, reason: "paused" });
  });
  it("a few refusals out of a small sample change nothing (no one is punished for 3 declines)", () => {
    expect(requestAllowance({ ...base, sentLastWeek: 4, refusedLastWeek: 4 })).toMatchObject({ ok: true, reduced: false });
  });
});

describe("the invitation note", () => {
  it("an ordinary note passes", () => {
    expect(noteProblem("We met at the photography meetup!", 0)).toBeNull();
    expect(noteProblem("See you at 7 tomorrow", 0)).toBeNull();
    expect(noteProblem("", 0)).toBeNull();
  });
  it("teeth: links, contact details and off-platform pulls are refused", () => {
    expect(noteProblem("check www.free-money.xyz", 0)).toBe("link");
    expect(noteProblem("https://bit.ly/abc", 0)).toBe("link");
    expect(noteProblem("message me on WhatsApp", 0)).toBe("contact");
    expect(noteProblem("call +234 803 123 4567", 0)).toBe("contact");
    expect(noteProblem("mail me: me@example.com", 0)).toBe("contact");
  });
  it("teeth: the same text to many people in a day is a mass invitation", () => {
    expect(noteProblem("Let's connect", 4)).toBeNull();
    expect(noteProblem("Let's connect", 5)).toBe("repeated");
  });
  it("case, spacing and punctuation do not make a copy-paste different", () => {
    expect(noteFingerprint("Let's  CONNECT!!")).toBe(noteFingerprint("lets connect"));
  });
});
