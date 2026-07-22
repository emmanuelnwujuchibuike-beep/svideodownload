/**
 * Design Intelligence — component adoption, measured honestly.
 *
 * The brief's "Design Intelligence™" analytics: how widely each registered
 * component is actually used across the codebase. This is the PURE core — given
 * the registry entries and the repo's files, it counts how many distinct files
 * import each component's module. `scripts/design-adoption.mjs` feeds it the real
 * tree and prints the report; keeping the counting here (no filesystem, no
 * `window`) makes it unit-testable and means the number is measured from real
 * imports, never fabricated.
 */

export interface AdoptionInput {
  id: string;
  name: string;
  /** Repo-relative source, e.g. "features/ui/skeleton.tsx". Empty = not countable. */
  source: string;
}

export interface RepoFile {
  /** Repo-relative path. */
  path: string;
  content: string;
}

export interface AdoptionResult {
  id: string;
  name: string;
  /** The `@/…` specifier other modules import it by, or null when uncountable. */
  specifier: string | null;
  /** Number of distinct files that import it (0 for convention/planned). */
  importedBy: number;
}

const dropExt = (p: string): string => p.replace(/\.(tsx|ts|jsx|js)$/, "");

/** The `@/…` module specifier a `source` path is imported by (extension dropped). */
export function moduleSpecifier(source: string): string | null {
  if (!source) return null;
  return "@/" + dropExt(source);
}

/**
 * The relative specifier a file at `fromPath` would use to import `toSource`
 * (e.g. `features/x/a.tsx` → `features/x/b.tsx` = `./b`). Pure path math on
 * repo-relative POSIX paths — no node:path, so it stays testable.
 */
export function relativeSpecifier(fromPath: string, toSource: string): string {
  const fromDir = fromPath.split("/").slice(0, -1);
  const to = dropExt(toSource).split("/");
  let i = 0;
  while (i < fromDir.length && i < to.length && fromDir[i] === to[i]) i++;
  const up = fromDir.slice(i).map(() => "..");
  const down = to.slice(i);
  const rel = [...up, ...down].join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** True if `content` imports `specifier` (matches `from "x"` and `import("x")`). */
export function fileImports(content: string, specifier: string): boolean {
  // The trailing quote guards against prefix collisions:
  // "@/a/b-foo" must not count as an import of "@/a/b".
  return content.includes(`"${specifier}"`) || content.includes(`'${specifier}'`);
}

/**
 * Count, per entry, how many files import it — by its `@/…` alias OR by the
 * relative path a sibling would use — excluding the component's own source file.
 * Sorted by adoption (desc), then name.
 */
export function computeAdoption(entries: AdoptionInput[], files: RepoFile[]): AdoptionResult[] {
  return entries
    .map((e) => {
      const specifier = moduleSpecifier(e.source);
      if (!specifier) return { id: e.id, name: e.name, specifier: null, importedBy: 0 };
      let importedBy = 0;
      for (const f of files) {
        if (f.path === e.source) continue; // don't count the file defining it
        if (fileImports(f.content, specifier) || fileImports(f.content, relativeSpecifier(f.path, e.source))) {
          importedBy += 1;
        }
      }
      return { id: e.id, name: e.name, specifier, importedBy };
    })
    .sort((a, b) => b.importedBy - a.importedBy || a.name.localeCompare(b.name));
}
