import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("Followers™ wiring (Feature 19 · Part 3)", () => {
  it("every follow goes through the policy decision — the route never inserts on its own", () => {
    const route = src("app/api/follow/[id]/route.ts");
    expect(route).toContain("await followUser(user.id, id, source)");
    expect(route).not.toMatch(/from\("follows"\)\s*\.insert/);
  });

  it("teeth: 0217 enforces approval in the database, not only in the UI", () => {
    const sql = src("supabase/migrations/0217_follow_platform_and_circles.sql");
    expect(sql).toContain("and public.follow_policy_of(following_id) = 'everyone'");
    expect(sql).toMatch(/create policy "follow requests target read"[\s\S]*?target_id = \(select auth\.uid\(\)\)/);
    expect(sql).not.toMatch(/follow requests (requester|participant) read/);
  });

  it("the button says Requested, and tapping it again withdraws the request", () => {
    const btn = src("features/social/follow-button.tsx");
    expect(btn).toContain('requested ? "Requested"');
    expect(btn).toContain("const wantFollow = !following && !requested;");
    expect(src("app/api/follow/[id]/route.ts")).toContain("await unfollowUser(user.id, id)");
  });

  it("audience figures are counts, never who", () => {
    const insights = src("lib/social/follower-insights.ts");
    expect(insights).not.toMatch(/select\("[^"]*follower_id[^"]*"\)(?![\s\S]{0,40}head: true)/);
  });
});
