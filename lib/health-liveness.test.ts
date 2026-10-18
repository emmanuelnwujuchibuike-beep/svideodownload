import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// owner, 2026-10-12: "nothing should consume Railway memory or any usage irregularly"
describe("the container health check costs nothing", () => {
  it("every container probe asks for liveness only", () => {
    expect(readFileSync("Dockerfile", "utf8")).toContain('CMD curl -fsS "http://localhost:3000/api/health?live=1" || exit 1');
    expect(readFileSync("docker-compose.yml", "utf8")).toContain('"http://localhost:3000/api/health?live=1"');
    expect(readFileSync("fly.toml", "utf8")).toContain('path = "/api/health?live=1"');
  });
  it("liveness answers before any Redis, Stream, database or yt-dlp work", () => {
    const r = readFileSync("app/api/health/route.ts", "utf8");
    const get = r.slice(r.indexOf("export async function GET"));
    const live = get.indexOf('params.get("live") === "1"');
    expect(live).toBeGreaterThan(0);
    for (const costly of ["cacheSet(", "checkStream()", "push_subscriptions", "extractorHealth()"]) expect(get.indexOf(costly), costly).toBeGreaterThan(live);
  });
  it("the middleware skips the health check", () => {
    // the very first line of the middleware — before the profile routing and every session check
    const mw = readFileSync("middleware.ts", "utf8");
    expect(mw).toContain('if (request.nextUrl.pathname === "/api/health") return NextResponse.next();');
    expect(mw.indexOf('"/api/health"')).toBeLessThan(mw.indexOf("profileRoute("));
  });
});
