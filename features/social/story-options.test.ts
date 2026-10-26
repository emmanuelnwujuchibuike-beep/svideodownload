import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Owner, 2026-10-08 — Stories: the PWA bottom band, and History-style options. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const viewer = () => src("features/app-shell/dashboard/stories-row.tsx");
const options = () => src("features/social/story-options.tsx");

describe("the installed app keeps a bottom band for reply and reactions", () => {
  it("the media stops above the band in the PWA only — a browser still runs to the edge", () => {
    const v = viewer();
    expect(v).toContain('"pointer-events-none absolute inset-x-0 bottom-0 z-0 flex items-center justify-center"');
    // someone else's story: the reply bar (its bottom padding is max(0.75rem, inset), so the band uses the same)
    expect(v).toContain('"[.pwa-standalone_&]:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.5rem)]"');
    expect(v).toContain('"[.pwa-standalone_&]:bottom-[calc(env(safe-area-inset-bottom)+2.75rem)]"'); // your own: Seen by
  });

  it("a visitor's story is WhatsApp's: no bottom nav, no emoji row above — a Reply pill with 3 emojis inside and a heart beside it (owner, 2026-10-15)", () => {
    const v = viewer();
    expect(v).toContain('const QUICK_EMOJI = ["😍", "😂", "😮"];');
    expect(v).toContain('placeholder="Reply"');
    expect(v).toContain('aria-label="Like"');
    expect(v).not.toContain("quickReactions");
    expect(v).not.toContain("STICKERS");
    // portalled by the viewer itself, so no surface can trap it under the z-40 nav
    expect(v).toContain("return createPortal(");
    expect(v).toContain("document.body,");
  });

  it("the reply bar sits on solid black in the band, not a gradient over the picture", () => {
    expect(viewer()).toContain("[.pwa-standalone_&]:bg-black [.pwa-standalone_&]:bg-none");
  });
});

describe("story options, like the History viewer's", () => {
  it("a ••• button opens them, and the story pauses while they are open", () => {
    const v = viewer();
    expect(v).toContain('aria-label="Story options"');
    // a hold plays at 2x instead of pausing (owner, 2026-10-15); options, a paid card and replying still pause
    expect(v).toContain("replying || paidCard || optionsOpen");
    expect(v).toMatch(/const StoryOptions = dynamic\(/);
  });

  it("own story: send to chat, save, seen by, delete (asked twice); others: send, reshare, report", () => {
    const o = options();
    for (const label of ['label="Send to chat"', 'label="Save to device"', 'label="Seen by"', '"Tap again to delete" : "Delete story"', 'label="Reshare to your story"', "label={`Report ${group.displayName}`}"]) {
      expect(o, label).toContain(label);
    }
    expect(o).toContain("{isOwn || allowShare ? ("); // someone else's story is sent only when its author allows sharing
    expect(o).toContain('<ReportSheet targetType="user" targetId={group.userId}');
  });

  it("send to chat reuses the existing sheet; save uses the download manager", () => {
    const o = options();
    expect(o).toContain('import("@/features/downloads/send-to-chat-sheet")');
    expect(o).toContain('const { startDownload } = await import("@/features/downloads/manager");');
  });

  it("a deleted story leaves the viewer at once, whichever surface opened it, and the shared cache", () => {
    const v = viewer();
    expect(v).toContain("incomingGroups.map((g) => ({ ...g, stories: g.stories.filter((x) => !deletedIds.has(x.id)) })).filter((g) => g.stories.length > 0)");
    expect(v).toContain('seed<StoryGroup[]>("stories", updated);');
    expect(v).toContain("writeCachedStories(updated);");
  });
});

describe("DELETE /api/stories/:id", () => {
  it("runs as the member, ENDS their own story (0285 expire_own_story: ownership is auth.uid()), and never touches storage itself", () => {
    const r = src("app/api/stories/[id]/route.ts");
    expect(r).toContain('import { createClient } from "@/lib/supabase/server";');
    expect(r).not.toContain("createAdminClient");
    // Stories Part 1 (2026-10-26): not a row delete — that lost the only record of which file the story used
    expect(r).toContain('supabase.rpc("expire_own_story", { p_story: id })');
    expect(r).not.toContain(".delete()");
    expect(r).toContain('if (data !== true) return NextResponse.json({ error: "Not found." }, { status: 404 });');
    expect(r).not.toMatch(/storage|\.remove\(/);
    const m = src("supabase/migrations/0285_stories_security.sql");
    expect(m).toContain("where id = p_story and user_id = v_uid;");
    expect(m).toContain('drop policy if exists "stories owner delete" on public.stories;');
  });
});

describe("story gestures (owner, 2026-10-15)", () => {
  const v = readFileSync(join(process.cwd(), "features/app-shell/dashboard/stories-row.tsx"), "utf8");
  it("hold right = 2x forward, hold left = 2x backward", () => {
    expect(v).toContain('onPointerDown={() => startHold("back")}');
    expect(v).toContain('onPointerDown={() => startHold("forward")}');
    expect(v).toContain('const rate = holdRef.current === "forward" ? 2 : holdRef.current === "back" ? -2 : 1;');
    expect(v).toContain("v.playbackRate = 2;");
    expect(v).toContain("v.currentTime = Math.max(0, v.currentTime - 0.2);");
  });
  it("double-tap = Wow, once per story, never on your own", () => {
    expect(v).toContain("fireWowFeedback();");
    expect(v).toContain("if (story && !isOwn && !wowed.current.has(story.id)) {");
    expect(v).toContain('onClick={() => zoneTap(next)}');
  });
  it("a single-emoji reply plays the rise on the tap", () => {
    expect(v).toContain("if (isSingleEmoji(t)) {");
    expect(v.indexOf("onEmoji?.(t);")).toBeLessThan(v.indexOf("const ok = await postStoryReply(toUserId, t);"));
  });
});
