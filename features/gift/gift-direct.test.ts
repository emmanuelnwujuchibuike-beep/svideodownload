import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// owner, 2026-10-28 (a 1:1 chat with no sticker button): a DIRECT chat has no member list — lib/social/messages.ts fills
// only `other` — so the gift recipients must come from otherId there, or the button never renders in any 1:1 chat
describe("the sticker gift button in a 1:1 chat", () => {
  it("the server's direct-chat view carries no members (why the room must not rely on them)", () => {
    const m = readFileSync("lib/social/messages.ts", "utf8");
    expect(m).toMatch(/let members: ConversationMember\[\] = \[\];\s[\s\S]{0,1200}if \(conv\.type === "direct" \|\| conv\.type === "secret"\) \{/);
  });
  it("the room builds a direct chat's recipient from otherId", () => {
    const room = readFileSync("features/social/conversation-room.tsx", "utf8");
    expect(room).toContain('if (type === "direct") return otherId ? [{ userId: otherId');
    expect(room).toContain("{giftRecipients.length > 0 && !sendLocked ? <GiftComposerButton");
  });
});
