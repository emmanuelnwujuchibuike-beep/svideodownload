import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

/*
  The cold-entry pages (the landing, every downloader page, and the layouts above them) must not STATICALLY
  import these libraries — a static import puts the whole package in the page's first scripts.
  Measured 2026-10-26: framer-motion (121 kB, via the bottom nav's PressIcon) and zod (56 kB, via the paste
  box's URL check) were both there. A lazy `import()` / `next/dynamic` is not followed, and is fine.
*/
const ENTRIES = ["app/layout.tsx", "app/(marketing)/layout.tsx", "app/(marketing)/page.tsx", "app/(marketing)/[downloader]/page.tsx"];
const HEAVY = /^(framer-motion|motion\/.*|zod)$/;

type Read = (file: string) => string | null;

const diskRead: Read = (file) => (existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : null);

/** Every static import chain from `entry` to a HEAVY package. */
function heavyChains(entry: string, read: Read, root: string): string[] {
  const resolveSpec = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(root, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    for (const ext of ["", ".ts", ".tsx", ".js", "/index.ts", "/index.tsx"]) if (read(base + ext) !== null) return base + ext;
    return null;
  };
  const start = resolve(root, entry);
  const prev = new Map<string, string | null>([[start, null]]);
  const queue = [start];
  const chains: string[] = [];
  while (queue.length) {
    const file = queue.shift()!;
    const src = (read(file) ?? "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)) {
      const spec = m[2]!;
      if (HEAVY.test(spec)) {
        const chain: string[] = [];
        for (let c: string | null | undefined = file; c; c = prev.get(c)) chain.unshift(c.slice(root.length + 1));
        chains.push(`${chain.join(" > ")} ==> ${spec}`);
        continue;
      }
      const next = resolveSpec(file, spec);
      if (next && !prev.has(next)) {
        prev.set(next, file);
        queue.push(next);
      }
    }
  }
  return chains;
}

/*
  A `next/dynamic` component still downloads its code the moment it RENDERS. The paste boxes rendered the
  progress card and the storage gate on every visit — each pulling framer-motion while the page loaded, to
  show nothing. They may only render behind a condition.
*/
const LAZY_UNTIL_NEEDED = ["FloatingDownloadProgress", "QuotaGate"];

/** Lines where one of LAZY_UNTIL_NEEDED is rendered with no `cond ?` / `cond &&` guard on the same line or the one above. */
function unguardedMounts(src: string): string[] {
  const lines = src.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    for (const name of LAZY_UNTIL_NEEDED) {
      if (!new RegExp(`<${name}\\b`).test(line)) continue;
      const context = (lines[i - 1] ?? "") + "\n" + line;
      if (!/(\?\s*\(?\s*$|\?\s*<|&&\s*\(?\s*$|&&\s*<)/m.test(context)) out.push(`${i + 1}: ${line.trim()}`);
    }
  });
  return out;
}

describe("the paste boxes mount their lazy download chrome only when needed (2026-10-26)", () => {
  for (const file of ["features/downloads/download-box.tsx", "features/downloader/downloader.tsx"]) {
    it(file, () => {
      expect(unguardedMounts(readFileSync(join(process.cwd(), file), "utf8"))).toEqual([]);
    });
  }

  it("the check has teeth", () => {
    expect(unguardedMounts("      <FloatingDownloadProgress />")).toHaveLength(1);
    expect(unguardedMounts("      <QuotaGate\n        open={gate.open}")).toHaveLength(1);
    expect(unguardedMounts("      {ready ? <FloatingDownloadProgress /> : null}")).toEqual([]);
    expect(unguardedMounts("      {gate.open ? (\n        <QuotaGate")).toEqual([]);
  });
});

describe("cold-entry pages import no heavy library statically (2026-10-26)", () => {
  for (const entry of ENTRIES) {
    it(entry, () => {
      expect(heavyChains(entry, diskRead, process.cwd())).toEqual([]);
    });
  }

  it("the walker has teeth: it finds a chain through a relative and an alias import", () => {
    const root = resolve("/fixture");
    const files: Record<string, string> = {
      [join(root, "app/page.tsx")]: 'import { Nav } from "./nav";\nimport type { T } from "zod";',
      [join(root, "app/nav.tsx")]: 'import {\n  PressIcon,\n} from "@/components/press";',
      [join(root, "components/press.tsx")]: 'import { motion } from "framer-motion";',
    };
    const read: Read = (f) => files[f] ?? null;
    // the type-only zod import is not a chain; the framer import two hops away is
    expect(heavyChains("app/page.tsx", read, root)).toEqual([
      `${join("app/page.tsx")} > ${join("app/nav.tsx")} > ${join("components/press.tsx")} ==> framer-motion`,
    ]);
  });
});
