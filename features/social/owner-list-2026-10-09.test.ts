import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { meaningfulSourceName } from "@/lib/ai/history";
import { grownStreak, liveStreakDays } from "@/lib/social/chat-streak";

/** The owner's list of 2026-10-09 (after the one-experience merge, pinned in features/app-shell/one-experience.test.ts). */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("instant tap: the AI history door and its siblings go once, at once", () => {
  it("each door is a TapOnceLink", () => {
    expect(code("features/ai/frenz-ai-welcome-live.tsx")).toMatch(/<TapOnceLink\s+href=\{historyHref\}/);
    expect(code("features/ai/frenz-ai-usage-page.tsx")).toMatch(/<TapOnceLink\s+href="\/rewards"/);
    expect(code("features/ai/frenz-ai-history-page.tsx")).toContain("<TapOnceLink href={base}");
    expect(code("features/ai/character-replace/result.tsx")).toContain("<TapOnceLink href={historyHref}");
    expect(code("features/rewards/rewards-page.tsx")).toContain('<TapOnceLink href="/studio/ai/usage"');
    expect(code("features/quests/quests-page.tsx")).toContain('<TapOnceLink href="/rewards"');
    expect(code("app/globals.css")).toContain(".ai-btn[data-pending] { transform: scale(0.95); opacity: 0.85; }");
  });
  it("a tap the guest sign-in gate cancelled is not left pending", () => {
    expect(code("features/ui/tap-once-link.tsx")).toContain("if (e.defaultPrevented) {\n          onClick?.(e);\n          return;\n        }");
  });
});

describe("Lip Sync in AI History", () => {
  it("a finished clip opens in the AI video player, not the workspace page", () => {
    const h = code("features/ai/frenz-ai-history.tsx");
    const branch = h.slice(h.indexOf('if (job.feature === "ai_lip_sync") {'), h.indexOf('if (job.feature === "ai_voice_clone") {'));
    expect(branch).toContain('if (job.status === "completed") {\n        openPlayer(aiJobRecord(job));');
  });
  it("a machine file name (UUID / long hex) reads as the tool's title; a real name stays", () => {
    expect(meaningfulSourceName("1d6ff2b5-e9c1-4b57-818b-4f0c2a9e1d3a.mp4")).toBeNull();
    expect(meaningfulSourceName("1D6FF2B5-E9C1-4B57-818B-4F0C2A9E1D3A.MOV")).toBeNull();
    expect(meaningfulSourceName("a3f09c2b7d114e6a9b0c.mov")).toBeNull();
    expect(meaningfulSourceName("holiday.mp4")).toBe("holiday.mp4");
    expect(meaningfulSourceName("IMG_1234.MOV")).toBe("IMG_1234.MOV");
    expect(meaningfulSourceName("  ")).toBeNull();
    expect(code("features/ai/frenz-ai-history.tsx")).toContain("const title = meaningfulSourceName(job.source.name) ?? historyTitleFor(job.feature);");
  });
});

describe("chat options sheet: the Frenz AI credits design, light", () => {
  const s = code("features/social/thread-options-sheet.tsx");
  it("the gradient identity hero and card language", () => {
    expect(s).toContain("bg-[linear-gradient(135deg,#1d4ed8_0%,#4f46e5_55%,#a21caf_100%)]");
    expect(s).toContain('const card = "rounded-2xl bg-card/95 ring-1 ring-inset ring-black/[0.05] dark:ring-white/10";');
  });
  it("no per-row JS animation: only the sheet's own slide uses framer", () => {
    expect(s).not.toMatch(/whileTap|staggerChildren|SHEET_ITEM_VARIANTS|<motion\.div variants/);
    expect((s.match(/<motion\./g) ?? []).length).toBe(2);
  });
});

describe("chat streaks", () => {
  it("alive only while the last counted day is today or yesterday (UTC)", () => {
    const now = new Date("2026-10-09T15:00:00Z");
    expect(liveStreakDays({ current_days: 4, last_day: "2026-10-09" }, now)).toBe(4);
    expect(liveStreakDays({ current_days: 4, last_day: "2026-10-08" }, now)).toBe(4);
    expect(liveStreakDays({ current_days: 4, last_day: "2026-10-07" }, now)).toBe(0);
    expect(liveStreakDays(undefined, now)).toBe(0);
  });
  it("celebrates the biggest streak that grew, only from 2 days", () => {
    expect(grownStreak([{ id: "a", streakDays: 3 }, { id: "b", streakDays: 5 }], { a: 2, b: 4 })).toEqual({ id: "b", days: 5 });
    expect(grownStreak([{ id: "a", streakDays: 3 }], { a: 3 })).toBeNull();
    expect(grownStreak([{ id: "a", streakDays: 1 }], {})).toBeNull();
  });
  it("the streak left the headers; the inbox row shows it", () => {
    expect(code("components/layout/site-header.tsx")).not.toContain("<StreakHeaderChip");
    expect(code("features/app-shell/app-topbar.tsx")).not.toContain("<StreakHeaderChip");
    expect(code("features/social/conversation-list.tsx")).toContain("{!isGroup ? <ChatStreakBadge days={c.streakDays ?? 0} /> : null}");
  });
  it("the celebration has no card: the burst only, with no buttons", () => {
    const c = code("features/streaks/streak-unlock-celebration.tsx");
    expect(c).toContain("return <StreakFireBurst tier={tier}");
    expect(c).not.toContain("streak-ms-panel");
    const b = code("features/streaks/streak-fire-burst.tsx");
    expect(b).not.toMatch(/<button|framer-motion/);
  });
  it("0200: a day counts only when BOTH sent; a gap restarts at 1; the inbox reads it in its one wave", () => {
    const m = code("supabase/migrations/0200_conversation_streaks.sql");
    expect(m).toContain("if v_low = v_day and v_high = v_day and v_last is distinct from v_day then");
    expect(m).toContain("v_cur  := case when v_last = v_day - 1 then v_cur + 1 else 1 end;");
    expect(m).toContain("exception when others then");
    expect(code("lib/social/messages.ts")).toContain('db.from("conversation_streaks").select("conversation_id, current_days, last_day").in("conversation_id", directConvIds)');
  });
});
