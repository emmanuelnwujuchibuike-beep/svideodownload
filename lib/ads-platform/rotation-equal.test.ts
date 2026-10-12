import { describe, expect, it } from "vitest";

import { pickNextNoRepeat } from "./rotation";

describe("round-robin is equal whatever order the pool arrives in", () => {
  const a = { cr: "a" };
  const b = { cr: "b" };
  const c = { cr: "c" };
  it("every ad gets the same number of turns over many showings", () => {
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    let last: string | null = null;
    for (let i = 0; i < 300; i++) {
      // the server's order changes every time
      const pool = i % 2 ? [c, a, b] : [b, c, a];
      const next: { cr: string } = pickNextNoRepeat(pool, last, () => 0)!;
      counts[next.cr]! += 1;
      last = next.cr;
    }
    expect(counts).toEqual({ a: 100, b: 100, c: 100 });
  });
  it("never repeats the last ad while another exists", () => {
    expect(pickNextNoRepeat([a, b], "a")!.cr).toBe("b");
    expect(pickNextNoRepeat([b, a], "b")!.cr).toBe("a");
  });
});
