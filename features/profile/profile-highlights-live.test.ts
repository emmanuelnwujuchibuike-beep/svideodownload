import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const row = readFileSync("features/profile/profile-highlights.tsx", "utf8");
const picker = readFileSync("features/social/highlight-picker.tsx", "utf8");

// Owner, 2026-10-31: "when I add a highlight in profile, it doesn't show unless I go out of the page and come back".
function showsAtOnce(rowSrc: string, pickerSrc: string): boolean {
  return (
    // the row follows a refreshed server list instead of freezing its first one
    /useEffect\(\(\) => setList\(initial\), \[initial\]\)/.test(rowSrc) &&
    // its own "New" sheet re-reads the list on success
    /onCreated=\{\(\) => \{[\s\S]*?void reload\(\);/.test(rowSrc) &&
    // it listens for the story viewer's picker
    /window\.addEventListener\(HIGHLIGHTS_CHANGED, on\)/.test(rowSrc) &&
    // and the picker announces both an add/remove and a new highlight
    (pickerSrc.match(/announceChange\(\);/g)?.length ?? 0) >= 2
  );
}

describe("a new highlight shows on the profile at once", () => {
  it("holds for the real files", () => {
    expect(showsAtOnce(row, picker)).toBe(true);
  });

  it("has teeth: each missing piece fails", () => {
    expect(showsAtOnce(row.replace("useEffect(() => setList(initial), [initial]);", ""), picker)).toBe(false);
    expect(showsAtOnce(row.replace("void reload();\n            router.refresh();", "router.refresh();"), picker)).toBe(false);
    expect(showsAtOnce(row.replace("window.addEventListener(HIGHLIGHTS_CHANGED, on)", ""), picker)).toBe(false);
    expect(showsAtOnce(row, picker.replace(/ {6}announceChange\(\);\n/g, ""))).toBe(false);
  });
});
