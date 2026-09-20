import { describe, expect, it } from "vitest";

import { collapseDownloadPairs, DOWNLOAD_PAIR_WINDOW_MS } from "./activity-dedupe";

/**
 * Owner, 2026-09-20: "signed-in and anonymous should never give a duplicate
 * activity." The anonymous half of a download pair is dropped — across polls,
 * because the feed runs this over what it is already holding.
 */
const at = (offsetMs: number) => new Date(1_800_000_000_000 + offsetMs).toISOString();
const anon = (id: string, url: string, offset = 0) => ({ id, kind: "download", actor: null, at: at(offset), meta: { sourceUrl: url } });
const named = (id: string, url: string, offset = 0) => ({ id, kind: "download", actor: { handle: "ada" }, at: at(offset), meta: { sourceUrl: url, memberId: "u1" } });

describe("collapseDownloadPairs", () => {
  it("drops the anonymous row of a start/finish pair and keeps the named one", () => {
    const out = collapseDownloadPairs([named("d:2", "https://x/1", 40_000), anon("d:1", "https://x/1")]);
    expect(out.map((i) => i.id)).toEqual(["d:2"]);
  });
  it("pairs across what the browser already holds — the anonymous row from an earlier poll goes when the named one arrives", () => {
    const prev = [anon("d:1", "https://x/1"), { id: "e:9", kind: "ad_impression", actor: null, at: at(1_000), meta: null }];
    const fresh = [named("d:2", "https://x/1", 90_000)];
    expect(collapseDownloadPairs([...fresh, ...prev]).map((i) => i.id)).toEqual(["d:2", "e:9"]);
  });
  it("a member whose profile has no handle still counts as attributed (memberId)", () => {
    const out = collapseDownloadPairs([{ ...named("d:2", "https://x/1", 5_000), actor: null }, anon("d:1", "https://x/1")]);
    expect(out.map((i) => i.id)).toEqual(["d:2"]);
  });
  it("a story that expands into three files keeps three rows — pairs are 1:1", () => {
    const items = [
      anon("a1", "https://x/story", 0), anon("a2", "https://x/story", 2_000), anon("a3", "https://x/story", 4_000),
      named("n1", "https://x/story", 30_000), named("n2", "https://x/story", 32_000), named("n3", "https://x/story", 34_000),
    ];
    expect(collapseDownloadPairs(items).map((i) => i.id).sort()).toEqual(["n1", "n2", "n3"]);
    // two anonymous rows and one named one: exactly one anonymous row goes
    expect(collapseDownloadPairs(items.slice(0, 4)).map((i) => i.id).sort()).toEqual(["a2", "a3", "n1"]);
  });
  it("two different people on the same viral link are not merged when the gap is beyond the window", () => {
    const out = collapseDownloadPairs([anon("d:1", "https://x/viral"), named("d:2", "https://x/viral", DOWNLOAD_PAIR_WINDOW_MS + 1)]);
    expect(out.map((i) => i.id).sort()).toEqual(["d:1", "d:2"]);
  });
  it("leaves rows without a source URL, and everything that is not a download, alone", () => {
    const items = [
      { id: "d:1", kind: "download", actor: null, at: at(0), meta: { sourceUrl: null } },
      { id: "d:2", kind: "download", actor: { handle: "ada" }, at: at(1_000), meta: {} },
      { id: "e:1", kind: "pwa_installed", actor: null, at: at(2_000), meta: { sourceUrl: "https://x/1" } },
      { id: "e:2", kind: "pwa_installed", actor: { handle: "ada" }, at: at(3_000), meta: { sourceUrl: "https://x/1" } },
    ];
    expect(collapseDownloadPairs(items)).toEqual(items);
  });
});
