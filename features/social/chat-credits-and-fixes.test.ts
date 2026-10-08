import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Owner's fix list, 2026-10-07 (second round). */
const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("send credits from a chat", () => {
  it("the + sheet offers Credits in a direct chat, and the chat menu offers Send credits", () => {
    expect(code("features/social/media-composer-sheet.tsx")).toContain('label="Credits"');
    const room = code("features/social/conversation-room.tsx");
    expect(room).toContain('if (type !== "direct") return null;');
    expect(room).toContain("onSendCredits={creditsRecipient ? () => setSendCreditsOpen(true) : undefined}");
    expect(code("features/social/thread-options-sheet.tsx")).toContain("Send credits");
  });
  it("the sheet loads only when tapped — the chat bundle does not carry it", () => {
    for (const f of ["features/social/conversation-room.tsx", "features/social/thread-options-sheet.tsx"]) {
      expect(code(f), f).toContain('dynamicImport(() => import("@/features/ai/wallet/chat-send-credits")');
      expect(code(f), f).not.toMatch(/from "@\/features\/ai\/wallet\/(chat-send-credits|transfer-panel)"/);
    }
  });
  it("the server resolves the chat partner's wallet itself, and refuses a send to yourself", () => {
    const r = code("app/api/ai/wallet/transfer/route.ts");
    expect(r).toContain('.refine((b) => !!b.accountNumber !== !!b.recipientUserId, { message: "one recipient" });');
    expect(r).toContain("if (parsed.data.recipientUserId === user.id)");
    expect(r).toContain("await getWalletNumber(parsed.data.recipientUserId)");
  });
});

describe("no placeholder calls", () => {
  it("the chat header has no voice or video call button, no 'coming soon', and no block-status read for them", () => {
    // comments may quote the owner — only the shipped code is checked
    const h = code("features/social/thread-header.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(h).not.toMatch(/aria-label="(Voice|Video) call"/);
    expect(h).not.toMatch(/coming soon/i);
    expect(h).not.toContain("fetch(`/api/block/");
  });
});

describe("the Frenzsave link preview", () => {
  it("says what Frenzsave is now — download, earn, chat and meet, AI videos, wallpapers", () => {
    const l = code("app/layout.tsx");
    // the owner's own words, in the preview AND the page's title/description
    expect(l).toContain("Download, earn credits to cash, chat and meet up, make AI videos and download wallpapers — all for free on Frenzsave.");
    expect(l).toContain("title: SHARE_TITLE,");
    expect(l).toContain("description: SHARE_DESCRIPTION,");
    expect(l).not.toContain("Save, Organise and Reuse");
    expect(l).not.toContain("stay updated with the latest news");
  });
});

describe("the downloads viewer in the installed app", () => {
  it("the stage stops above a black bottom band instead of running under the home indicator — in the installed app ONLY", () => {
    // 2026-10-08 (owner): a browser already has its own toolbar there, so the band is .pwa-standalone only
    expect(code("features/downloads/download-player.tsx")).toContain("pb-0 pt-[var(--frenz-safe-top)] [.pwa-standalone_&]:pb-[calc(env(safe-area-inset-bottom)+4.5rem)]");
  });
});

describe("transfer history can be hidden", () => {
  it("a Hide/Show toggle, remembered per device, and nothing is read while hidden", () => {
    const p = code("features/ai/wallet/transfer-panel.tsx");
    expect(p).toContain('const HIDE_KEY = "frenz:wallet-transfers:hidden";');
    expect(p).toContain("if (historyHidden) return; // hidden: nothing is read until it is shown again");
  });
});

describe("the AI plans card never reloads for nothing (owner screenshot, 2026-10-07)", () => {
  it("paints the kept answer before the first frame and re-asks only when stale, forced or changed", () => {
    const c = code("features/ai/credits/ai-credits-card.tsx");
    expect(c).toContain("useLayoutEffect(() => {\n    const k = readKept();");
    expect(c).toContain("if (forced || !k || Date.now() - k.at > STALE_MS) void load();");
    expect(c).toContain("if (!prev || JSON.stringify(prev.answer) !== JSON.stringify(next)) setData(next);");
  });
});
