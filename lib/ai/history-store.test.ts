import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AiJobView } from "@/lib/ai/jobs";

/**
 * Owner, 2026-10-06: the AI history lives on the device "like the download
 * history" and the server is not asked on every visit. A fake localStorage and
 * a session cookie let the real module run here (no DOM environment needed).
 */

function sessionCookie(userId: string): string {
  const session = Buffer.from(JSON.stringify({ user: { id: userId }, expires_at: 9_999_999_999 })).toString("base64url");
  return `sb-test-auth-token=base64-${session}`;
}

function job(id: string, createdAt: string, status: AiJobView["status"] = "completed"): AiJobView {
  return { id, createdAt, status, feature: "ai_text_to_video" } as unknown as AiJobView;
}

let store: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  store = new Map();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("window", { localStorage });
  vi.stubGlobal("document", { cookie: sessionCookie("user-a") });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the on-device AI history", () => {
  it("keeps what the app reads, newest first, a newer copy replacing an older one", async () => {
    const m = await import("@/lib/ai/history-store");
    m.upsertAiHistory([job("a", "2026-10-01T00:00:00Z", "processing")]);
    m.upsertAiHistory([job("b", "2026-10-02T00:00:00Z"), job("a", "2026-10-01T00:00:00Z", "completed")]);
    const snap = m.getAiHistorySnapshot();
    expect(snap.jobs.map((j) => j.id)).toEqual(["b", "a"]);
    expect(snap.jobs.find((j) => j.id === "a")?.status).toBe("completed");
    m.removeFromAiHistory("b");
    expect(m.getAiHistorySnapshot().jobs.map((j) => j.id)).toEqual(["a"]);
  });

  it("survives a reload — read back from storage, not refetched", async () => {
    const first = await import("@/lib/ai/history-store");
    first.replaceAiHistoryFirstPage([job("a", "2026-10-01T00:00:00Z")], "cursor-1");
    vi.resetModules();
    const again = await import("@/lib/ai/history-store");
    const snap = again.getAiHistorySnapshot();
    expect(snap.jobs.map((j) => j.id)).toEqual(["a"]);
    expect(snap.syncedAt).not.toBeNull();
    expect(snap.cursor).toBe("cursor-1");
  });

  it("never shows one account's list to another on a shared phone", async () => {
    const first = await import("@/lib/ai/history-store");
    first.upsertAiHistory([job("mine", "2026-10-01T00:00:00Z")]);
    vi.resetModules();
    vi.stubGlobal("document", { cookie: sessionCookie("user-b") });
    const other = await import("@/lib/ai/history-store");
    expect(other.getAiHistorySnapshot().jobs).toEqual([]);
  });

  it("the page asks the server only when this browser has never synced, and never polls", () => {
    const hook = readFileSync(join(process.cwd(), "features/ai/use-ai-history.ts"), "utf8");
    expect(hook).toContain("if (getAiHistorySnapshot().syncedAt === null) void fetchFirstPage();");
    expect(hook).not.toContain("setInterval");
    expect(hook).not.toContain("POLL_MS");
  });

  it("every job the app already reads keeps the history current — no request of its own", () => {
    const client = readFileSync(join(process.cwd(), "lib/ai/client.ts"), "utf8");
    expect(client).toContain("if (res.ok) upsertAiHistory([res.job]);");
    expect(client).toContain("if (res.ok) upsertAiHistory(res.jobs);");
    expect(client).toContain("if (res.ok && res.deleted) removeFromAiHistory(id);");
    expect(readFileSync(join(process.cwd(), "lib/auth/sign-out.ts"), "utf8")).toContain("forgetAiDeviceData();");
    // keys only: the store itself must never ride into every page via the header
    expect(readFileSync(join(process.cwd(), "lib/auth/sign-out.ts"), "utf8")).not.toMatch(/history-store|media-url-cache/);
  });
});
