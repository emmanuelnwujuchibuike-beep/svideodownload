import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 0285 (Stories Part 1, 2026-10-26) — the guards that run on every `npm test`. The behaviour itself
 * (anon and cross-member reads, direct inserts, forged expiry, the trigger, story_view_access for
 * blocks / restrictions / private / hidden / suspended authors, expire_own_story, the reference
 * check, grants, and six mutants that must fail) is proven against Postgres by
 * supabase/tests/0285_stories_security.pglite.mjs, run by hand.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/0285_stories_security.sql"), "utf8");
const noComments = sql.replace(/--[^\n]*/g, "");

describe("0285 survives the migration runner", () => {
  it("uses plain $$ only", () => {
    expect(noComments).not.toMatch(/\$[A-Za-z_]+\$/);
  });
  it("puts every dollar-quoted body AFTER every plain statement (0130: plain DDL after a body was skipped)", () => {
    const firstBody = noComments.indexOf("$$");
    const plain = noComments.slice(0, firstBody);
    for (const stmt of ["drop policy if exists \"stories public read\"", "revoke all on table public.stories from anon", "create index if not exists stories_expires_asc_idx"]) {
      expect(plain).toContain(stmt);
    }
    const afterLastBody = noComments.slice(noComments.lastIndexOf("$$") + 2).trim();
    expect(afterLastBody).toBe(";");
  });
});

describe("0285 says what the audit asked", () => {
  it("S2: no public read — the owner reads their own rows, nothing else", () => {
    expect(sql).toContain('drop policy if exists "stories public read" on public.stories;');
    expect(noComments).toMatch(/create policy "stories owner read" on public\.stories\s+for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\);/);
    expect(noComments).not.toMatch(/create policy[^;]*on public\.stories[^;]*for (insert|update|delete|all)/);
  });
  it("S3: no member insert, update or delete — and anon has no table access at all", () => {
    expect(sql).toContain('drop policy if exists "stories owner insert" on public.stories;');
    expect(sql).toContain("revoke insert, update, delete, truncate, references, trigger on table public.stories from authenticated;");
    expect(sql).toContain("revoke all on table public.story_views from anon;");
  });
  it("S3: the database stamps a 24 hour life on every insert, whoever the caller", () => {
    expect(sql).toMatch(/if tg_op = 'INSERT' then\s+new\.created_at := now\(\);\s+new\.expires_at := now\(\) \+ interval '24 hours';/);
    expect(sql).toContain("before insert or update on public.stories");
  });
  it("the helpers are not callable by the browser (a new function is executable by anon by default)", () => {
    expect(sql).toContain("revoke all on function public.story_view_access(uuid, uuid) from public, anon, authenticated;");
    expect(sql).toContain("revoke all on function public.story_media_references(text[], uuid[]) from public, anon, authenticated;");
    expect(sql).toContain("revoke all on function public.expire_own_story(uuid) from public, anon;");
    expect(sql).not.toMatch(/grant execute on function public\.(story_view_access|story_media_references)[^;]*authenticated/);
  });
  it("expire_own_story takes ownership from auth.uid(), never from a parameter", () => {
    expect(sql).toContain("v_uid uuid := auth.uid();");
    expect(sql).toContain("where id = p_story and user_id = v_uid;");
  });
});
