import path from "node:path";

import { describe, expect, it } from "vitest";

import { scanRoutes } from "@/lib/content/sync/snapshot";

import { COMMANDS, DESTINATIONS, WORKSPACES } from "./registry";
import {
  auditNavigation,
  availableWorkspaces,
  commandsFor,
  destinationsFor,
  GUEST,
  resolveWorkspace,
  score,
  searchNavigation,
  type NavViewer,
} from "./queries";

/**
 * Global Navigation Engine integrity.
 *
 * The registry is about to drive the command palette, the workspace switcher,
 * adaptive nav and global search at once, so a defect here surfaces in four places
 * simultaneously — and every one of them is a control a person will actually press.
 *
 * The load-bearing check is route existence: a destination that 404s is the
 * navigation equivalent of a claim the product cannot honour, and it is the failure
 * mode a registry makes easy (a page gets deleted, the entry stays).
 */

const ROOT = path.resolve(__dirname, "../..");
const ROUTES = scanRoutes(ROOT);

const USER: NavViewer = { plan: "free", isAdmin: false, signedIn: true };
const PRO: NavViewer = { plan: "pro", isAdmin: false, signedIn: true };
const ADMIN: NavViewer = { plan: "pro", isAdmin: true, signedIn: true };

/** Ignores hash/query; `/#download` is the home page plus an anchor. */
function routeExists(href: string): boolean {
  const clean = href.split("#")[0]!.split("?")[0]!;
  const p = clean === "" ? "/" : clean.replace(/\/$/, "") || "/";
  return ROUTES.some((r) => r === p || r.startsWith(`${p}/`));
}

describe("Navigation — the registry points at real routes", () => {
  it("discovers the app's routes", () => {
    expect(ROUTES.length).toBeGreaterThan(10);
    expect(ROUTES).toContain("/home");
  });

  it("every destination resolves to a real route", () => {
    const broken = DESTINATIONS.filter((d) => !routeExists(d.href)).map((d) => `${d.id} → ${d.href}`);
    expect(broken, `Destinations pointing at routes that do not exist:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("every command with an href resolves to a real route", () => {
    const broken = COMMANDS.filter((c) => c.href && !routeExists(c.href)).map((c) => `${c.id} → ${c.href}`);
    expect(broken, `Commands pointing at routes that do not exist:\n  ${broken.join("\n  ")}`).toHaveLength(0);
  });

  it("every OFFERED workspace lands somewhere real", () => {
    // Unoffered workspaces (cloud, marketplace, …) intentionally point at routes
    // that do not exist yet — that is why they are filtered, not deleted.
    for (const w of availableWorkspaces(ADMIN)) {
      expect(routeExists(w.home), `${w.id} lands on ${w.home}, which has no route`).toBe(true);
    }
  });

  it("reports no structural issues", () => {
    const issues = auditNavigation();
    expect(issues, issues.map((i) => `${i.id}: ${i.problem}`).join("\n")).toHaveLength(0);
  });
});

describe("Navigation — the Reality Ledger applied to workspaces", () => {
  it("only offers workspaces whose product is claimable", () => {
    /*
     * The brief lists eleven workspaces. Two products are claimable, so the
     * switcher offers what those back and nothing else. If this ever grows without
     * a product shipping, the switcher has started promising environments that do
     * not exist.
     */
    const ids = availableWorkspaces(ADMIN).map((w) => w.id).sort();
    expect(ids).toEqual(["creator", "developer", "social"]);
  });

  it("never offers Cloud, Marketplace or Enterprise today", () => {
    const ids = availableWorkspaces(ADMIN).map((w) => w.id);
    for (const unbuilt of ["cloud", "marketplace", "enterprise", "ai", "professional", "learning"]) {
      expect(ids, `${unbuilt} is not built and must not be offered`).not.toContain(unbuilt);
    }
  });

  it("still declares all eleven, so the type stays stable as products ship", () => {
    expect(WORKSPACES).toHaveLength(11);
  });

  it("resolves the workspace that owns a path", () => {
    expect(resolveWorkspace("/home")?.id).toBe("social");
    expect(resolveWorkspace("/downloads")?.id).toBe("creator");
    expect(resolveWorkspace("/nowhere")).toBeUndefined();
  });
});

describe("Navigation — adaptive filtering", () => {
  it("hides auth-only entries from guests rather than bouncing them", () => {
    const ids = destinationsFor(GUEST).map((d) => d.id);
    expect(ids).not.toContain("messages");
    expect(ids).not.toContain("account");
    // Public surfaces stay.
    expect(ids).toContain("explore");
    expect(ids).toContain("pricing");
  });

  it("gates admin entries on the admin flag", () => {
    expect(destinationsFor(USER).map((d) => d.id)).not.toContain("admin");
    expect(destinationsFor(ADMIN).map((d) => d.id)).toContain("admin");
  });

  it("gates pro workspaces on plan", () => {
    expect(availableWorkspaces(USER).map((w) => w.id)).not.toContain("developer");
    expect(availableWorkspaces(PRO).map((w) => w.id)).toContain("developer");
  });

  it("never leaks a sign-out command to a signed-out visitor", () => {
    expect(commandsFor(GUEST).map((c) => c.id)).not.toContain("cmd-signout");
    expect(commandsFor(USER).map((c) => c.id)).toContain("cmd-signout");
  });
});

describe("Navigation — search ranking", () => {
  it("prefers an exact label over a partial one", () => {
    expect(score("messages", "Messages")).toBeGreaterThan(score("mes", "Messages"));
  });

  it("matches synonyms people actually type", () => {
    // A palette that only matches the word already on screen helps nobody.
    expect(score("logout", "Sign out", ["logout", "log out"])).toBeGreaterThan(0);
    expect(score("dark mode", "Toggle light / dark", ["dark mode", "theme"])).toBeGreaterThan(0);
    expect(score("api", "Developer API", ["api", "keys"])).toBeGreaterThan(0);
  });

  it("ranks a label match above a keyword match", () => {
    const label = score("set", "Settings", []);
    const keyword = score("set", "Something else", ["settings"]);
    expect(label).toBeGreaterThan(keyword);
  });

  it("falls back to subsequence, but ranks it last", () => {
    const sub = score("acst", "Account settings");
    expect(sub).toBeGreaterThan(0);
    expect(sub).toBeLessThan(score("account", "Account settings"));
  });

  it("returns 0 for a genuine non-match", () => {
    expect(score("zzzqqq", "Messages", ["chat"])).toBe(0);
  });

  it("is stable — the same query gives the same order", () => {
    const a = searchNavigation("s", ADMIN).map((r) => r.id);
    const b = searchNavigation("s", ADMIN).map((r) => r.id);
    expect(a).toEqual(b);
  });
});

describe("Navigation — palette results", () => {
  it("shows a useful default set on an empty query", () => {
    // An empty palette on open makes the user guess what it knows.
    const results = searchNavigation("", USER);
    expect(results.length).toBeGreaterThan(3);
  });

  it("finds a destination by synonym", () => {
    const ids = searchNavigation("chat", USER).map((r) => r.id);
    expect(ids).toContain("messages");
  });

  it("prefers the command when the query is a verb", () => {
    const results = searchNavigation("logout", USER);
    expect(results[0]?.id).toBe("cmd-signout");
  });

  it("never returns an entry the viewer cannot access", () => {
    const guestIds = searchNavigation("admin", GUEST).map((r) => r.id);
    expect(guestIds).not.toContain("admin");
    expect(guestIds).not.toContain("cmd-admin");
  });

  it("respects the limit", () => {
    expect(searchNavigation("e", ADMIN, 4).length).toBeLessThanOrEqual(4);
  });
});

describe("Navigation — content surfaces are reachable", () => {
  /**
   * A page can exist, prerender correctly, sit in the sitemap, and still be
   * unreachable by a human. That is not hypothetical: /academy, /trust and
   * /glossary all shipped as real static routes that nothing linked to, on any
   * device, and the only reason it surfaced was the owner saying they could not
   * find them.
   *
   * Route existence tests above prove a link goes somewhere. This proves the
   * reverse — that a destination worth having is actually registered, which is
   * what puts it in the mobile menu and the command palette.
   */
  it("registers every top-level content surface", () => {
    const required = ["/academy", "/learn", "/trust", "/glossary", "/developers", "/pricing"];
    const registered = new Set(DESTINATIONS.map((d) => d.href));
    const missing = required.filter((href) => !registered.has(href));

    expect(
      missing,
      `Routes with no navigation entry — unreachable by browsing:\n  ${missing.join("\n  ")}`,
    ).toHaveLength(0);
  });

  it("gives trust and glossary the keywords people actually type", () => {
    // Nobody searches "Trust Center". They search "delete account" or "block
    // someone" — mid-problem, in their own words. A destination findable only by
    // its formal name is findable only by people who already knew it existed.
    const trust = DESTINATIONS.find((d) => d.href === "/trust");
    const glossary = DESTINATIONS.find((d) => d.href === "/glossary");

    expect(trust?.keywords).toContain("delete account");
    expect(trust?.keywords).toContain("privacy");
    expect(glossary?.keywords).toContain("what is");
  });
});
