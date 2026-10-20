import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONVERSATION_THEMES } from "@/lib/social/message-meta";

/**
 * Step 15 — the chat options sheet to design/ChatMenu.dc.html with the owner's notes (2026-10-19).
 * Pinned to the source, each rule with a case that fails when it's taken out.
 */
const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const sheet = src("features/social/thread-options-sheet.tsx");
const migration = src("supabase/migrations/0264_chat_theme_midnight_mono.sql");

function rules(s: string) {
  return {
    // brand colours only, in the design's order; null = the Frenz gradient default
    brandSwatches: s.includes('const PICKABLE_THEMES: (ConversationTheme | null)[] = [null, "blue", "purple", "pink", "midnight", "mono"];'),
    // the gradient Send AI credits button shows the real balance (the send sheet's own kept read)
    balance: s.includes("m.sendCreditsBalance()") && /Your balance[\s\S]{0,200}formatCredits\(balance\)/.test(s),
    // @handle · last seen
    lastSeen: s.includes("<PresenceLastSeen userId={otherUserId} />"),
    // Media, links & files opens its own screen
    media: s.includes("Media, links &amp; files") && s.includes("<ChatMediaSheet"),
    // Search in chat searches THIS chat
    searchInChat: s.includes("Search in chat") && s.includes("conversationId={conversationId} />"),
    // ⛔ owner 2026-10-19: backgrounds stay plain white — no preset pictures, no SVG grounds (only "emergency change" lifts it)
    noPresetBackgrounds: !/WALLPAPER_PRESETS|chat-wallpapers|\.svg/.test(s),
    // ⛔ owner 2026-10-19: the sheet is solid white, never glass that lets a wallpaper colour through
    whiteSheet: s.includes("rounded-t-[28px] bg-frenz-page") && !s.includes("frenz-nav-glass"),
    // red rows at the foot
    redRows: /text-rose-600[\s\S]{0,300}Block or restrict[\s\S]{0,800}text-rose-600[\s\S]{0,300}>Report</.test(s),
  };
}

describe("the chat options sheet (step 15)", () => {
  it("keeps every rule of the design and the owner's notes", () => {
    expect(rules(sheet)).toEqual({ brandSwatches: true, balance: true, lastSeen: true, media: true, searchInChat: true, noPresetBackgrounds: true, whiteSheet: true, redRows: true });
  });

  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(sheet.replace('"midnight", "mono"];', '"green"];')).brandSwatches).toBe(false);
    expect(rules(sheet.replace("m.sendCreditsBalance()", "Promise.resolve(0)")).balance).toBe(false);
    expect(rules(sheet.replace("<PresenceLastSeen userId={otherUserId} />", "")).lastSeen).toBe(false);
    expect(rules(sheet.replace("conversationId={conversationId} />", "/>")).searchInChat).toBe(false);
    expect(rules(sheet.replace("bg-frenz-page shadow-frenz-float", "frenz-nav-glass")).whiteSheet).toBe(false);
    expect(rules(sheet + '\nconst WALLPAPER_PRESETS = [{ path: "/chat-wallpapers/x.svg" }];').noPresetBackgrounds).toBe(false);
  });

  it("the new themes are allowed by the database and the app in the same words", () => {
    expect(CONVERSATION_THEMES).toEqual(["blue", "pink", "green", "orange", "purple", "midnight", "mono"]);
    const allowed = /theme in \(([^)]+)\)/.exec(migration)?.[1]?.split(",").map((t) => t.trim().replace(/'/g, ""));
    expect(allowed).toEqual([...CONVERSATION_THEMES]);
  });
});
