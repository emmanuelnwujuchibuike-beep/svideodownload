import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { insertDroppingMissing, isMissingColumn, missingColumnName } from "./missing-column";

// The exact error production returned on 2026-10-10 for every repost.
const PROD = { code: "PGRST204", message: "Could not find the 'throttled_at' column of 'reposts' in the schema cache" };

describe("a column the database doesn't have yet (owner: 'couldn't repost')", () => {
  it("recognises both codes, and names the column", () => {
    expect(isMissingColumn(PROD)).toBe(true);
    expect(missingColumnName(PROD)).toBe("throttled_at");
    expect(missingColumnName({ code: "42703", message: 'column reposts.audience does not exist' })).toBe("audience");
    expect(missingColumnName({ code: "42703", message: 'column "wallpaper_url" of relation "chat_appearance_preferences" does not exist' })).toBe("wallpaper_url");
    // teeth: other errors are not "missing column"
    expect(isMissingColumn({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(missingColumnName({ code: "23505", message: "Could not find the 'x' column" })).toBeNull();
  });

  it("drops ONLY the missing column and keeps the rest of the row", async () => {
    const seen: Record<string, unknown>[] = [];
    const db = (row: Record<string, unknown>) => {
      seen.push(row);
      return Promise.resolve("throttled_at" in row ? { data: null, error: PROD } : { data: { id: "r1" }, error: null });
    };
    const out = await insertDroppingMissing(db, { user_id: "u", post_id: "p", caption: "hi", audience: "friends", throttled_at: null }, ["user_id", "post_id"]);
    expect(out).toEqual({ data: { id: "r1" }, error: null, dropped: ["throttled_at"] });
    expect(seen[1]).toEqual({ user_id: "u", post_id: "p", caption: "hi", audience: "friends" });
  });

  it("never drops a required column, and passes any other error straight back", async () => {
    const req = await insertDroppingMissing(() => Promise.resolve({ data: null, error: { code: "PGRST204", message: "Could not find the 'post_id' column of 'reposts' in the schema cache" } }), { user_id: "u", post_id: "p" }, ["user_id", "post_id"]);
    expect(req.error?.code).toBe("PGRST204");
    const dup = await insertDroppingMissing(() => Promise.resolve({ data: null, error: { code: "23505", message: "dup" } }), { user_id: "u", post_id: "p" }, ["user_id", "post_id"]);
    expect(dup).toMatchObject({ error: { code: "23505" }, dropped: [] });
  });

  it("every write-path fallback uses it (a 42703-only check is the bug)", () => {
    const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const repost = src("app/api/posts/[id]/repost/route.ts");
    expect(repost).toContain("insertDroppingMissing<{ id: string }>(");
    expect(repost).not.toMatch(/error\.code !== "42703"/);
    for (const f of ["app/api/posts/[id]/react/route.ts", "app/api/chat-appearance-preferences/route.ts", "lib/social/broadcasts.ts"]) {
      expect(src(f), f).toContain("isMissingColumn(error)");
    }
  });
});
