import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { type ApiEndpoint, getApiEndpoints, routeFileFor } from "./api-registry";

const ROOT = path.resolve(__dirname, "../..");

/** Pure detector: is this endpoint backed by a route file that exports the method? */
function endpointProblem(e: ApiEndpoint, fileExists: boolean, content: string): string | null {
  if (!fileExists) return `${e.method} ${e.path} → ${routeFileFor(e.path)} does not exist`;
  const exported = new RegExp(`export\\s+(?:async\\s+function|const)\\s+${e.method}\\b`).test(content);
  if (!exported) return `${e.method} ${e.path} → route file exports no ${e.method} handler`;
  return null;
}

describe("API Registry", () => {
  it("every declared endpoint maps to a route file exporting that method", () => {
    const problems: string[] = [];
    for (const e of getApiEndpoints()) {
      const file = path.join(ROOT, routeFileFor(e.path));
      const exists = existsSync(file);
      const content = exists ? readFileSync(file, "utf8") : "";
      const problem = endpointProblem(e, exists, content);
      if (problem) problems.push(problem);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("has no duplicate method+path pairs", () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const e of getApiEndpoints()) {
      const key = `${e.method} ${e.path}`;
      if (seen.has(key)) dups.push(key);
      seen.add(key);
    }
    expect(dups).toEqual([]);
  });
});

describe("API Registry — the check has teeth", () => {
  it("catches a declared endpoint whose route file is missing", () => {
    const e: ApiEndpoint = { method: "GET", path: "/api/v1/ghost", auth: "api-key", category: "usage", description: "" };
    expect(endpointProblem(e, false, "")).toMatch(/does not exist/);
  });
  it("catches a method the route file does not actually export", () => {
    const e: ApiEndpoint = { method: "POST", path: "/api/v1/analyze", auth: "api-key", category: "download", description: "" };
    // File exists but only exports GET ⇒ the POST claim is a lie.
    expect(endpointProblem(e, true, "export async function GET() {}")).toMatch(/no POST handler/);
  });
});

/*
  Frenz Exclusive Part 2 (2026-10-16): every handler under /api/sub must be declared — the
  other direction from the check above. A new subscription route that skips the registry
  fails here.
*/
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

/** Pure: which exported handlers of a route file are missing from the declared set. */
function undeclared(routePath: string, content: string, declared: Set<string>): string[] {
  return METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+function|const)\\s+${m}\\b`).test(content)).map((m) => `${m} ${routePath}`).filter((k) => !declared.has(k));
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? routeFiles(path.join(dir, d.name)) : d.name === "route.ts" ? [path.join(dir, d.name)] : []));
}

describe("API Registry — /api/sub is complete", () => {
  const declared = new Set(getApiEndpoints().map((e) => `${e.method} ${e.path}`));
  it("every exported handler under app/api/sub is declared", () => {
    const missing = routeFiles(path.join(ROOT, "app/api/sub")).flatMap((f) => {
      const routePath = "/" + path.relative(ROOT, path.dirname(f)).split(path.sep).join("/").replace(/^app\//, "");
      return undeclared(routePath, readFileSync(f, "utf8"), declared);
    });
    expect(missing, missing.join("\n")).toEqual([]);
  });
  it("teeth: an undeclared handler is caught", () => {
    expect(undeclared("/api/sub/ghost", "export async function POST() {}", declared)).toEqual(["POST /api/sub/ghost"]);
    expect(undeclared("/api/sub/checkout", "export async function POST() {}", declared)).toEqual([]);
  });
});
