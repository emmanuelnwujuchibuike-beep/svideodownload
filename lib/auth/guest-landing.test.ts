import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

// owner, 2026-10-28: "anonymous users get forced to log in, the landing page seems like it doesn't exist"
describe("a signed-out visitor lands on the landing, never a login wall", () => {
  it("the installed app's launch page opens / for a guest and /downloads for a member", () => {
    const html = read("public/launch.html");
    expect(html).toContain(String.raw`if (!next) next = /(^|;\s*)sb-[^=]*-auth-token/.test(document.cookie) ? "/downloads" : "/";`);
    expect(html).not.toMatch(/if \(!next\) next = "\/downloads";/);
  });
  it("middleware sends a cookie-less /downloads to / before the member-page login rule", () => {
    const mw = read("middleware.ts");
    const home = mw.indexOf('if (path === "/downloads") return NextResponse.redirect(new URL("/", request.url));');
    expect(home).toBeGreaterThan(0);
    expect(home).toBeLessThan(mw.indexOf("if (needsGuard || appOnly || guestMustLogin(path)) {"));
  });
});

// owner, 2026-10-28: "replace the story Frenz Coin button on the story reply placeholder with the Frenz gifting"
describe("the story reply bar's gift button", () => {
  const viewer = read("features/app-shell/dashboard/story-viewer.tsx");
  it("opens the sticker gift sheet (warmed while the bar shows), not the coin transfer screen", () => {
    expect(viewer).not.toContain("/wallet/transfer?to=");
    expect(viewer).toContain('m.warmGiftSheet()');
    expect(viewer).toContain("conversationId={() => storyGiftConversation(storyId)}");
    expect(viewer).toMatch(/aria-label=\{`Send \$\{name\} a sticker gift for this story`\}/);
  });
  it("the chat is found or created only on Send, behind the story's own visibility gate", () => {
    const route = read("app/api/stories/[id]/gift-conversation/route.ts");
    expect(route).toContain('admin.rpc("story_view_access"');
    expect(route).toContain("getOrCreateConversation(user.id, authorId)");
    expect(route).toContain("You can't gift your own story.");
  });
});
