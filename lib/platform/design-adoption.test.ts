import { describe, expect, it } from "vitest";

import { computeAdoption, fileImports, moduleSpecifier, relativeSpecifier, type RepoFile } from "./design-adoption";

describe("relativeSpecifier", () => {
  it("computes a sibling import", () => {
    expect(relativeSpecifier("features/x/a.tsx", "features/x/b.tsx")).toBe("./b");
  });
  it("computes an up-and-over import", () => {
    expect(relativeSpecifier("features/x/a.tsx", "features/y/b.tsx")).toBe("../y/b");
  });
});

describe("moduleSpecifier", () => {
  it("drops the extension and prefixes @/", () => {
    expect(moduleSpecifier("features/ui/skeleton.tsx")).toBe("@/features/ui/skeleton");
    expect(moduleSpecifier("lib/motion/springs.ts")).toBe("@/lib/motion/springs");
  });
  it("returns null for an empty source (convention / planned)", () => {
    expect(moduleSpecifier("")).toBeNull();
  });
});

describe("fileImports", () => {
  it("matches a from-import and a dynamic import", () => {
    expect(fileImports('import { X } from "@/a/b";', "@/a/b")).toBe(true);
    expect(fileImports('const m = import("@/a/b");', "@/a/b")).toBe(true);
    expect(fileImports("import X from '@/a/b'", "@/a/b")).toBe(true);
  });
  it("does NOT match a prefix collision (the trailing quote guards it)", () => {
    expect(fileImports('from "@/a/b-foo"', "@/a/b")).toBe(false);
  });
});

describe("computeAdoption", () => {
  const files: RepoFile[] = [
    { path: "features/ui/skeleton.tsx", content: "export function Skeleton() {}" },
    { path: "app/a/page.tsx", content: 'import { Skeleton } from "@/features/ui/skeleton";' },
    { path: "app/b/page.tsx", content: 'import { Skeleton } from "@/features/ui/skeleton";' },
    { path: "app/c/page.tsx", content: 'import { Toast } from "@/features/ui/toast";' },
  ];

  it("counts distinct importing files, excluding the component's own source", () => {
    const res = computeAdoption(
      [
        { id: "skeleton", name: "Skeleton", source: "features/ui/skeleton.tsx" },
        { id: "toast", name: "Toast", source: "features/ui/toast.tsx" },
      ],
      files,
    );
    expect(res.find((r) => r.id === "skeleton")!.importedBy).toBe(2);
    expect(res.find((r) => r.id === "toast")!.importedBy).toBe(1);
  });

  it("reports 0 and a null specifier for a convention/planned entry (no source)", () => {
    const res = computeAdoption([{ id: "button", name: "Button", source: "" }], files);
    expect(res[0]!.importedBy).toBe(0);
    expect(res[0]!.specifier).toBeNull();
  });

  it("sorts by adoption descending", () => {
    const res = computeAdoption(
      [
        { id: "toast", name: "Toast", source: "features/ui/toast.tsx" },
        { id: "skeleton", name: "Skeleton", source: "features/ui/skeleton.tsx" },
      ],
      files,
    );
    expect(res.map((r) => r.id)).toEqual(["skeleton", "toast"]);
  });
});
