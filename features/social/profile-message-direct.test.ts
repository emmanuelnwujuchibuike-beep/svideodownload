import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Owner, 2026-10-08: "Clicking the message button from this profile looks like
 * it goes through long route — it is supposed to open the chat directly." The
 * button went /u/<handle> → /messages/new/<id> (server get-or-create) → redirect
 * → /messages/<conversation>: two server renders and a redirect. An existing
 * chat now links straight to its thread.
 */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

/** The rule, as a function of the page's source, so the teeth below can run it on a broken copy. */
function opensDirectly(page: string): boolean {
  return (
    page.includes("isViewer ? existingDirectConversationId(me!, profile.id) : Promise.resolve(null),") &&
    page.includes("href={directChatId ? `/messages/${directChatId}` : `/messages/new/${profile.id}`}")
  );
}

describe("profile Message opens an existing chat directly", () => {
  const page = code("app/u/[handle]/page.tsx");
  it("the chat id is read in the profile's one parallel wave, and the button links to the thread", () => {
    expect(opensDirectly(page)).toBe(true);
    const wave = page.slice(page.indexOf("] = await Promise.all(["), page.indexOf("const theme = resolveProfileTheme"));
    expect(wave).toContain("existingDirectConversationId(me!, profile.id)");
  });
  it("teeth: a copy that always uses the get-or-create redirect fails", () => {
    expect(opensDirectly(page.replace("href={directChatId ? `/messages/${directChatId}` : `/messages/new/${profile.id}`}", "href={`/messages/new/${profile.id}`}"))).toBe(false);
  });
  it("only a thread the viewer is an active member of; any fault answers null (the old route)", () => {
    const m = code("lib/social/messages.ts");
    const fn = m.slice(m.indexOf("export async function existingDirectConversationId"), m.indexOf("export async function canMessage"));
    expect(fn).toContain('.eq("conversation_members.user_id", viewerId)');
    expect(fn).toContain('.is("conversation_members.left_at", null)');
    expect(fn).toContain('.eq("type", "direct")');
    expect(fn).toContain("if (error || !data) return null;");
  });
});
