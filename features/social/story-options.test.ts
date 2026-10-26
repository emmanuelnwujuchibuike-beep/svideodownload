import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Owner, 2026-10-08 — Stories: the PWA bottom band, and History-style options. */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const viewer = () => src("features/app-shell/dashboard/story-viewer.tsx"); // the viewer moved out of stories-row.tsx (Stories Part 2)
const options = () => src("features/social/story-options.tsx");

/*
  The Story Viewer design (design/Frenz-Story-Viewer-design.zip, owner 2026-10-26: "Use the designs in the zip")
  supersedes the 2026-10-15 WhatsApp-style bar (a "Reply" pill with three emojis inside and a heart) and the
  browser-only full-bleed media: the picture is a card ending above a black band everywhere.
*/
describe("the band below the picture holds the reply box (theirs) or who saw it (yours)", () => {
  it("the picture is a card with 28 px bottom corners that ends above the band — in the browser and the PWA alike", () => {
    const v = viewer();
    expect(v).toContain('"calc(3.625rem + max(env(safe-area-inset-bottom), 0.75rem))"');
    expect(v).toContain('className="absolute inset-x-0 overflow-hidden rounded-b-[28px] bg-[#0B0920]"');
    expect(v).toContain('style={{ top: "var(--frenz-safe-top, 0px)", bottom: "var(--story-band)" }}');
    expect(v).not.toContain("[.pwa-standalone_&]");
  });

  it("someone else's story: an outlined 'Reply to Ada…' pill, the heart and the paper plane; the design's three quick reactions on the picture", () => {
    const v = viewer();
    expect(v).toContain("placeholder={`Reply to ${name}…`}");
    expect(v).toContain('aria-label={isLiked ? "Liked" : "Like story"}');
    expect(v).toContain('aria-label="Share story"');
    for (const r of ['label: "Love it", emoji: "😍"', 'label: "Fire", emoji: "🔥"', 'label: "Wow", emoji: "😮"']) expect(v).toContain(r);
    // portalled by the viewer itself, so no surface can trap it under the z-40 nav
    expect(v).toContain("return createPortal(");
    expect(v).toContain("document.body,");
  });

  it("your own story: the faces and real viewer count, Highlight, Share", () => {
    const v = viewer();
    expect(v).toContain('aria-label="Your story"');
    expect(v).toContain("viewersReady.totals.viewers.toLocaleString()");
    expect(v).toContain("viewersLine(viewersReady)");
    expect(v).toContain('const ownViewers = useStoryViewers(isOwn && story ? story.id : null);');
  });

  it("🔴 lightweight: no backdrop-filter on anything that sits over the playing picture", () => {
    // the code, not the notes that explain why (comments are stripped)
    const code = viewer().replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/backdrop-blur|backdrop-filter|backdropFilter/);
    expect(code).toContain("bg-[rgba(18,17,26,0.42)]"); // the design's tint, drawn without the blur
  });
});

describe("story options (the design's glass sheet)", () => {
  it("a ••• button opens them, and the story pauses while they are open", () => {
    const v = viewer();
    expect(v).toContain('label="Story options"');
    // a hold plays at 2x instead of pausing (owner, 2026-10-15); options, a paid card and replying still pause
    expect(v).toContain("replying || paidCard || optionsOpen");
    expect(v).toMatch(/const StoryOptions = dynamic\(/);
  });

  it("own story: Save, Highlight, Copy link · Allow resharing, Allow replies, Who can see this · Delete (asked twice); others: Send to chat, Reshare, Report", () => {
    const o = options();
    for (const label of ['"Save video" : "Save photo"', 'label: "Highlight"', 'label: "Copy link"', 'label="Allow resharing"', 'label="Allow replies"', "Who can see this", '"Tap again to delete" : "Delete story"', 'label: "Send to chat"', 'label: "Reshare"', "Report {group.displayName}"]) {
      expect(o, label).toContain(label);
    }
    expect(o).toContain(": allowShare"); // someone else's story is sent or reshared only when its author allows it
    expect(o).toContain('<ReportSheet targetType="user" targetId={group.userId}');
    expect(o).toContain('role="switch" aria-checked={on}'); // the README's iOS-style toggles
    expect(o).toContain('href="/account/privacy"');
  });

  it("the sheets that close Story options to open their own stay reachable (the options stay mounted once used)", () => {
    expect(viewer()).toContain("{optionsUsed ? (");
  });

  it("send to chat reuses the existing sheet; save uses the download manager", () => {
    const o = options();
    expect(o).toContain('import("@/features/downloads/send-to-chat-sheet")');
    expect(o).toContain('const { startDownload } = await import("@/features/downloads/manager");');
  });

  it("a deleted story leaves the viewer at once, whichever surface opened it, and the shared cache", () => {
    const v = viewer();
    // Stories Part 3: deletion takes the same path as a story that ends or is withdrawn (story-progression.ts, tested there)
    expect(v).toContain("onDeleted={(id) => dropStories([id])}");
    expect(v).toContain("const groups = useMemo(() => withoutStories(incomingGroups, goneIds), [incomingGroups, goneIds]);");
    // every surface's copy drops it — mutate, not seed (a seed is a no-op once the rings hold data)
    expect(v).toContain('for (const key of ["stories", "stories:friends", "stories:following"]) {');
    expect(v).toContain("mutate<StoryGroup[]>(key, (prev) => withoutStories(prev ?? [], ids));");
    expect(v).toContain("if (disk) writeCachedStories(withoutStories(disk, ids));");
  });
});

describe("DELETE /api/stories/:id", () => {
  it("runs as the member, ENDS their own story (0285 expire_own_story: ownership is auth.uid()), and never touches storage itself", () => {
    // the DELETE handler alone (the file also holds the "Allow replies" PATCH, which writes on the service role after an owner match)
    const file = src("app/api/stories/[id]/route.ts");
    const r = file.slice(file.indexOf("export async function DELETE"), file.indexOf("export async function PATCH"));
    expect(file).toContain('import { createClient } from "@/lib/supabase/server";');
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
  const v = readFileSync(join(process.cwd(), "features/app-shell/dashboard/story-viewer.tsx"), "utf8");
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
    expect(v).toContain("const single = isSingleEmoji(t);");
    expect(v.indexOf("onEmoji?.(t);")).toBeLessThan(v.indexOf("const out = await postStoryReply(toUserId, t, { storyId, reaction: single });"));
  });
});
