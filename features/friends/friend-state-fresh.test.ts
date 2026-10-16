import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/*
  Owner, 2026-10-16: "When I add friend and go out of the page and come back it still
  shows I haven't added the person. Even if the friend request went through."
  The router keeps pages for 6 h (next.config staleTimes), so every friendship change
  must refresh it, and the server's 60 s suggestion cache must move on.
*/
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The text of the onSend handler's success branch in the profile button. */
const sendSuccess = (src: string) => {
  const at = src.indexOf(`if (res.ok) {\n            setState("outgoing");`);
  return at < 0 ? "" : src.slice(at, src.indexOf("return true;", at));
};

describe("a friend request is still shown after leaving and coming back", () => {
  it("the profile button refreshes the router after a send, and follows a refreshed state", () => {
    const btn = code("features/friends/add-friend-button.tsx");
    expect(sendSuccess(btn)).toContain("router.refresh();");
    expect(btn).toContain("useEffect(() => setState(initialState), [initialState]);");
  });

  it("the suggestion chip refreshes and forgets the person in this tab's saved lists", () => {
    const chip = code("features/friends/people-you-may-know.tsx");
    const body = chip.slice(chip.indexOf("function AddFriendChip"));
    expect(body).toContain("router.refresh();");
    expect(body).toContain("writeSession(kept);");
  });

  it("the hub refreshes after accept/decline and after a cancel", () => {
    expect(code("features/friends/friends-hub.tsx").match(/router\.refresh\(\);/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("the server moves both people's suggestion cache on a request and on a cancel", () => {
    const route = code("app/api/friends/[id]/route.ts");
    expect(route.match(/bumpSuggestionVersion\(user\.id\), bumpSuggestionVersion\(id\)/g)).toHaveLength(2);
  });

  it("teeth: a send branch without the refresh fails", () => {
    const btn = code("features/friends/add-friend-button.tsx");
    const broken = btn.replace(/(setState\("outgoing"\);[\s\S]*?)router\.refresh\(\);/, "$1");
    expect(sendSuccess(broken)).not.toContain("router.refresh();");
  });
});
