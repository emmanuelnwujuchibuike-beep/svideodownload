import { describe, expect, it } from "vitest";

import { defaultPriorityFor } from "./priority";

describe("defaultPriorityFor", () => {
  it("puts security and payment types at critical", () => {
    expect(defaultPriorityFor("security_new_device")).toBe("critical");
    expect(defaultPriorityFor("payment_successful")).toBe("critical");
    expect(defaultPriorityFor("subscription_activated")).toBe("critical");
  });

  it("puts messages, friend requests, and finished downloads at high", () => {
    expect(defaultPriorityFor("message")).toBe("high");
    expect(defaultPriorityFor("friend_request")).toBe("high");
    expect(defaultPriorityFor("download_complete")).toBe("high");
  });

  it("puts milestones at high — celebratory, meant to feel immediate", () => {
    expect(defaultPriorityFor("milestone")).toBe("high");
  });

  it("puts comments/mentions/community activity at medium", () => {
    expect(defaultPriorityFor("comment")).toBe("medium");
    expect(defaultPriorityFor("mention")).toBe("medium");
    expect(defaultPriorityFor("community_event")).toBe("medium");
  });

  it("puts passive social signals at low", () => {
    expect(defaultPriorityFor("follow")).toBe("low");
    expect(defaultPriorityFor("like")).toBe("low");
    expect(defaultPriorityFor("profile_view")).toBe("low");
  });

  it("defaults a genuinely unmapped/future type to medium, never silently critical or low", () => {
    expect(defaultPriorityFor("some_future_type_not_in_the_table" as never)).toBe("medium");
  });
});
