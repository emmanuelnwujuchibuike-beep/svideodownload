import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * 0287 (Stories Part 2, 2026-10-26) — guards that run on every `npm test`. The behaviour (every case of the shared
 * table agreeing with lib/social/story-audience.ts, the grants, 0285's policies untouched, and three mutants that must
 * fail) is proven against Postgres by supabase/tests/0287_story_followers.pglite.mjs, run by hand.
 */
const sql = readFileSync(join(process.cwd(), "supabase/migrations/0287_story_view_access_followers.sql"), "utf8");
const body = sql.replace(/--[^\n]*/g, "");

describe("0287 — story_view_access learns the followers rule", () => {
  it("replaces ONLY story_view_access: no policy, no grant to a member, no table change", () => {
    expect(body.match(/create or replace function public\.(\w+)/g)).toEqual(["create or replace function public.story_view_access"]);
    expect(body).not.toMatch(/create policy|drop policy|alter table|revoke all on table|grant select/i);
    expect(body).toContain("revoke all on function public.story_view_access(uuid, uuid) from public, anon, authenticated;");
    expect(body).toContain("grant execute on function public.story_view_access(uuid, uuid) to service_role;");
    expect(body).not.toMatch(/grant execute[^;]*authenticated/);
  });
  it("adds exactly the accepted-follower rule, for followers-only profiles", () => {
    expect(body).toMatch(/if v_visibility = 'followers' and exists \(\s*select 1 from public\.follows fo where fo\.follower_id = p_viewer and fo\.following_id = v_author\s*\) then\s*return 'ok';/);
    expect(body).not.toMatch(/v_visibility in \(/);
  });
  it("keeps every 0285 refusal: blocks both ways, status restrictions, suspended, hidden, no handle, ended", () => {
    for (const s of ["b.blocker_id = v_author and b.blocked_id = p_viewer", "b.blocker_id = p_viewer and b.blocked_id = v_author", "r.scope = 'status'", "or v_suspended then", "if v_hidden and not v_friends then", "v_handle is null", "if v_expires <= now() then"]) {
      expect(body).toContain(s);
    }
  });
  it("survives the migration runner: plain $$, body before the grants block, nothing plain after a body", () => {
    expect(body).not.toMatch(/\$[A-Za-z_]+\$/);
    expect(body.slice(body.lastIndexOf("$$") + 2).trim()).toBe(";");
  });
});
