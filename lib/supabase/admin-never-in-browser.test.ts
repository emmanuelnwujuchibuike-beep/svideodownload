import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
  Part 7 §54 (2026-10-07). The built client output held NO secret value — but
  `createAdminClient` itself was in 15 browser chunks (the signed-in layout
  among them): client components imported a constant from a module that also
  ran service-role queries. `import "server-only"` in lib/supabase/admin.ts now
  fails the BUILD on any such path; this walks the source import graph so the
  same mistake fails here too, naming the chain.
*/
const ROOT = path.resolve(__dirname, "../..");
const DIRS = ["app", "features", "lib", "components", "server", "hooks", "config"];
const TARGET = "lib/supabase/admin.ts";

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const d of DIRS) {
    let list: string[] = [];
    try {
      list = readdirSync(path.join(ROOT, d), { recursive: true }) as string[];
    } catch {
      continue;
    }
    for (const f of list) if (/\.(tsx?|js)$/.test(f) && !/\.test\./.test(f)) out.push(path.posix.join(d, f.split(path.sep).join("/")));
  }
  return out;
}

/** Pure: the first import chain from any "use client" file to the target, or null. */
export function clientPathTo(target: string, src: Record<string, string>): string[] | null {
  const set = new Set(Object.keys(src));
  const resolve = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)) : null;
    if (!base) return null;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (set.has(c)) return c;
    return null;
  };
  const deps = (f: string): string[] => {
    const out: string[] = [];
    for (const m of (src[f] ?? "").matchAll(/(?:import|export)\s+(type\s+)?[^'";]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g)) {
      if (m[1]) continue; // `import type` is erased
      const r = resolve(f, m[2] ?? m[3] ?? m[4] ?? "");
      if (r) out.push(r);
    }
    return out;
  };
  const isClient = (f: string) => /^\s*["']use client["']/.test(src[f] ?? "");
  const isAction = (f: string) => /^\s*["']use server["']/.test(src[f] ?? "");
  for (const start of Object.keys(src).filter(isClient)) {
    const prev = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const x = queue.shift()!;
      if (x === target) {
        const chain: string[] = [];
        for (let y: string | null | undefined = x; y; y = prev.get(y)) chain.unshift(y);
        return chain;
      }
      if (x !== start && isAction(x)) continue; // a server action is a reference, never bundled
      for (const d of deps(x)) if (!prev.has(d)) (prev.set(d, x), queue.push(d));
    }
  }
  return null;
}

describe("the service-role client never reaches a browser bundle", () => {
  it("is marked server-only", () => {
    expect(readFileSync(path.join(ROOT, TARGET), "utf8")).toMatch(/^import "server-only";/);
  });

  it("no client component imports it, directly or through another module", () => {
    const src: Record<string, string> = {};
    for (const f of sourceFiles()) src[f] = readFileSync(path.join(ROOT, f), "utf8");
    const chain = clientPathTo(TARGET, src);
    expect(chain, chain?.join(" → ")).toBeNull();
  });

  it("teeth: a client file importing a helper from a service-role module is caught", () => {
    const fixture = {
      "features/x.tsx": `"use client";\nimport { LABELS } from "@/lib/social/mixed";`,
      "lib/social/mixed.ts": `import { createAdminClient } from "@/lib/supabase/admin";\nexport const LABELS = {};`,
      [TARGET]: "",
    };
    expect(clientPathTo(TARGET, fixture)).toEqual(["features/x.tsx", "lib/social/mixed.ts", TARGET]);
    const typeOnly = { ...fixture, "features/x.tsx": `"use client";\nimport type { LABELS } from "@/lib/social/mixed";` };
    expect(clientPathTo(TARGET, typeOnly)).toBeNull();
  });
});
