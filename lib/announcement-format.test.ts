import { describe, expect, it } from "vitest";

import { formatAnnouncement, tidyAnnouncementText } from "./announcement-format";

describe("announcement built-in format (owner, 2026-10-18)", () => {
  it("tidies the owner's real message: no space before a comma, sentence capitals, a closing stop", () => {
    const raw = "Missed out on earning 🫣 ? Not too late , Start earning today from your exclusive posts";
    expect(tidyAnnouncementText(raw)).toBe("Missed out on earning 🫣? Not too late, Start earning today from your exclusive posts.");
    expect(formatAnnouncement(raw)).toEqual({
      headline: "Missed out on earning 🫣?",
      body: "Not too late, Start earning today from your exclusive posts.",
    });
  });

  it("collapses spaces, capitalises each sentence and leaves numbers, times and links alone", () => {
    expect(tidyAnnouncementText("  new   feature!try it now.  ")).toBe("New feature! Try it now.");
    expect(tidyAnnouncementText("Over 1,000 creators at 10:30 on https://frenz.app/earn")).toBe(
      "Over 1,000 creators at 10:30 on https://frenz.app/earn.",
    );
    expect(tidyAnnouncementText("Big news 🎉")).toBe("Big news 🎉");
    expect(tidyAnnouncementText("   ")).toBe("");
  });

  it("one sentence, or a long first sentence, has no headline", () => {
    expect(formatAnnouncement("Downloads are faster today").headline).toBeNull();
    const long = `${"A very long opening sentence that goes on and on well past the limit"}. Then more.`;
    expect(formatAnnouncement(long).headline).toBeNull();
  });

  it("teeth: the raw text, or a naive whitespace-only trim, does not match the house style", () => {
    const raw = "Not too late , start now";
    expect(raw.trim()).not.toBe(tidyAnnouncementText(raw));
    expect(tidyAnnouncementText(raw)).toBe("Not too late, start now.");
  });
});
