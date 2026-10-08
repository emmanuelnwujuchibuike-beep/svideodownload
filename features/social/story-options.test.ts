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
    expect(v).toContain('"[.pwa-standalone_&]:bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.75rem)]"');
    expect(v).toContain('"[.pwa-standalone_&]:bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]"'); // your own: Seen by
  });

  it("the reply bar sits on solid black in the band, not a gradient over the picture", () => {
    expect(viewer()).toContain("[.pwa-standalone_&]:bg-black [.pwa-standalone_&]:bg-none");
  });
});

describe("story options, like the History viewer's", () => {
  it("a ••• button opens them, and the story pauses while they are open", () => {
    const v = viewer();
    expect(v).toContain('aria-label="Story options"');
    expect(v).toContain("replying || holding || paidCard || optionsOpen");
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
  it("runs as the member (RLS 'stories owner delete'), scoped to their own id, and never deletes the media file", () => {
    const r = src("app/api/stories/[id]/route.ts");
    expect(r).toContain('import { createClient } from "@/lib/supabase/server";');
    expect(r).not.toContain("createAdminClient");
    expect(r).toContain('.delete().eq("id", id).eq("user_id", user.id)');
    expect(r).toContain('if (!data?.length) return NextResponse.json({ error: "Not found." }, { status: 404 });');
    expect(r).not.toMatch(/storage|\.remove\(/);
    expect(src("supabase/migrations/0015_stories.sql")).toContain('create policy "stories owner delete" on public.stories');
  });
});
