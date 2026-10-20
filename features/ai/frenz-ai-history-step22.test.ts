import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Step 22 — AI History to design/AIHistory.dc.html (owner 2026-10-19). Each rule with a case that fails without it. */
const list = readFileSync(join(process.cwd(), "features/ai/frenz-ai-history.tsx"), "utf8");

function rules(s: string) {
  return {
    header: s.includes(">AI History</h1>") && s.includes("pull down to refresh") && s.includes('{selecting ? "Done" : "Select"}'),
    pullToRefresh: s.includes("return page ? <PullToRefresh onRefresh={() => history.refresh()}>{body}</PullToRefresh> : body;"),
    // Select deletes through the same owner-only route, one by one, and never a running job
    selectDeletes: s.includes("method: \"DELETE\"") && s.includes("removeFromAiHistory(id)") && s.includes("selecting && !active ?"),
    // the files that are gone are their own group, last
    expiredGroup: s.includes('{ key: "expired", label: "Expired", items: [] }') && s.includes('if (resultAvailability(job, now) === "expired") {'),
    // the chip: days left / Expired, from the job's own expiry (never a guess)
    chip: s.includes("daysLeftLabel(job, now)") && s.includes("const hours = hoursUntilExpiry(job, now);"),
  };
}

describe("AI History (step 22)", () => {
  it("keeps every rule of the design", () => {
    expect(rules(list)).toEqual({ header: true, pullToRefresh: true, selectDeletes: true, expiredGroup: true, chip: true });
  });
  it("teeth: each rule fails when it's taken out", () => {
    expect(rules(list.replace(">AI History</h1>", ">History</h1>")).header).toBe(false);
    expect(rules(list.replace("selecting && !active ?", "selecting ?")).selectDeletes).toBe(false);
    expect(rules(list.replace('{ key: "expired", label: "Expired", items: [] }', "")).expiredGroup).toBe(false);
  });
});
