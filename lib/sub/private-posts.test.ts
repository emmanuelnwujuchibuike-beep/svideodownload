import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { isMode, PRIVATE_POST_MODES } from "./private-notify";

const code = (p: string) => readFileSync(p, "utf8");

// owner 2026-10-12: notifications for new private posts — push, email or both
describe("private post notifications", () => {
  it("four modes, nothing else", () => {
    expect(PRIVATE_POST_MODES).toEqual(["off", "push", "email", "both"]);
    expect(isMode("both")).toBe(true);
    expect(isMode("sms")).toBe(false);
    expect(isMode(undefined)).toBe(false);
  });
  it("the migration constrains the column to those modes, with no ';' inside a string", () => {
    const m = code("supabase/migrations/0238_private_post_notifications.sql");
    expect(m).toContain("check (private_posts in ('off', 'push', 'email', 'both'))");
    for (const lit of m.match(/'[^']*'/g) ?? []) expect(lit).not.toContain(";");
  });
  it("publishing notifies after the response; push and email follow the chosen mode; blocks and mutes respected", () => {
    expect(code("app/api/sub/posts/route.ts")).toContain("if (out.ok) after(() => import(\"@/lib/sub/private-notify\").then((m) => m.notifyNewPrivatePost(user.id)));");
    const n = code("lib/sub/private-notify.ts");
    expect(n).toContain('if (r.private_posts === "push" || r.private_posts === "both")');
    expect(n).toContain('if (r.private_posts === "email" || r.private_posts === "both")');
    expect(n).toContain("excluded.has(r.viewer_id)");
  });
});

// owner 2026-10-12: like and comment like a public post — subscribers only — and no save
describe("private post likes and comments", () => {
  const i = code("lib/sub/interactions.ts");
  it("every read and write checks access first", () => {
    for (const fn of ["interactionSummary", "setLike", "listComments", "addComment", "deleteComment"]) {
      const body = i.slice(i.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 600), fn).toContain("await access(postId, userId)");
    }
    expect(i).toContain('if (!(await hasActiveSub(userId, p.creator_id))) return fail("Subscribe to like and comment.", 403);');
  });
  it("there is no save for a private post", () => {
    expect(i.toLowerCase()).not.toContain("save_post");
    expect(code("features/sub/sub-gallery.tsx")).not.toMatch(/aria-label="Save/);
  });
  it("a comment can be removed only by its author or the post's creator", () => {
    expect(i).toContain('if (a.creatorId !== userId) q = q.eq("user_id", userId!);');
  });
  it("the new tables are catalogued", () => {
    expect(code("lib/platform/data-domains.ts")).toContain('"sub_post_likes",');
    expect(code("lib/portability/tables.ts")).toContain("sub_post_comments: \"user_id\"");
  });
});
