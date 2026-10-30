import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { downloadUrl } from "@/lib/client-download";
import { clampTitle, TITLE_MAX_CHARS } from "@/lib/downloads/title";
import { downloadRequestSchema } from "@/lib/validation";

/**
 * Owner, 2026-10-30: "some doesn't download at all … it says strings must contain at most 300 characters when it
 * fails". Reproduced on production the same day: vt.tiktok.com/ZSg7RLNdB (a 445-character caption) and /ZSg7Y2uk3 (718)
 * — HTTP 400 "String must contain at most 300 character(s)" from the download request, because the request carried
 * the post's caption as `title` and the schema REFUSED anything longer. The title only names the file.
 */
const caption = (n: number) => ("Binance, the world's largest cryptocurrency exchange, said a security breach … #crypto #news ".repeat(20)).slice(0, n);
const request = (title: string) => ({ url: "https://vt.tiktok.com/ZSg7RLNdB/", formatId: "tt-0", kind: "video", title });

describe("a long caption never stops a download", () => {
  it("teeth: the OLD rule refused the real captions — this is the failure the owner saw", () => {
    const old = z.object({ title: z.string().trim().max(300).optional() });
    const r = old.safeParse({ title: caption(445) });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0]?.message).toBe("String must contain at most 300 character(s)");
  });

  it("the download request now accepts a 445- and a 718-character caption, shortened to 300", () => {
    for (const n of [445, 718, 4_000]) {
      const r = downloadRequestSchema.safeParse(request(caption(n)));
      expect(r.success, `${n} chars`).toBe(true);
      expect(Array.from(r.success ? (r.data.title ?? "") : "").length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    }
  });

  it("still validates everything else: a short title is untouched, a non-text title and a bad format are still refused", () => {
    expect(downloadRequestSchema.parse(request("  My video  ")).title).toBe("My video");
    expect(downloadRequestSchema.safeParse({ ...request("x"), title: 42 }).success).toBe(false);
    expect(downloadRequestSchema.safeParse({ ...request("x"), formatId: "tt-0; rm -rf" }).success).toBe(false);
    expect(downloadRequestSchema.parse({ url: "https://vt.tiktok.com/ZSg7RLNdB/", formatId: "tt-0" }).title).toBeUndefined();
  });

  it("whole characters only — an emoji is never cut in half", () => {
    const t = clampTitle("🔥".repeat(400));
    expect(Array.from(t)).toHaveLength(TITLE_MAX_CHARS);
    expect(t).not.toMatch(/[\uD800-\uDBFF]$/); // no lone high surrogate at the end
  });

  it("the browser shortens it before sending (a 718-character caption no longer rides in every download URL)", () => {
    const href = downloadUrl({ url: "https://vt.tiktok.com/ZSg7Y2uk3/", formatId: "tt-0", kind: "video", title: caption(718) });
    const title = new URL(href, "https://frenzsave.com").searchParams.get("title") ?? "";
    expect(Array.from(title).length).toBeLessThanOrEqual(TITLE_MAX_CHARS);
    expect(readFileSync("features/downloads/manager.ts", "utf8")).toContain("title: clampTitle(t.title)");
  });

  it("publishing a download and storing its media shorten the caption too — no refusing .max(300) left on a title", () => {
    for (const p of ["app/api/reels/route.ts", "app/api/internal/store-media/route.ts"]) {
      const src = readFileSync(p, "utf8");
      expect(src, p).toMatch(/title: clampedString\(TITLE_MAX_CHARS/);
      expect(src, p).not.toMatch(/title: z\.string\(\)[^\n]*\.max\(300\)/);
    }
  });
});
