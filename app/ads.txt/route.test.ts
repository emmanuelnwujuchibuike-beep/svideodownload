import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
  ── Why this suite exists ──────────────────────────────────────────────────
  Owner, 2026-08-31: "i woke up today and see my adsense ads.txt showing not
  found after 1 week of showing authorised."

  This is the SECOND time AdSense has recorded "Not found" for a file that
  serves perfectly on every manual check (the first was 2026-08-10, commit
  cf6b85d). Both times the cause was a branch that answered 404 — an
  authoritative "this file does not exist", which Google keeps for days — for a
  reason that had nothing to do with the operator un-configuring the site.

  2026-08-10 closed the case where the settings read FAILS. What stayed open,
  and is what these tests pin, is the mirror image: a read that SUCCEEDS and
  returns a blank `adsensePublisherId`. That is reachable in practice because
  `setMonetizationSettings` upserts the whole settings row and the admin schema
  defaults both `adsensePublisherId` and `adsTxt` to "" — so any payload that
  omits them writes them away.

  The rule these lock in: IF WE CAN NAME THE PUBLISHER AT ALL, THE FILE MUST
  CONTAIN THEM. A 404 is only ever correct when there is genuinely nothing,
  anywhere, to serve.
*/

const read = vi.fn();
const lastKnown = vi.fn(() => "");
vi.mock("@/lib/monetization/settings", () => ({
  readMonetizationSettings: () => read(),
  lastKnownAdsensePublisherId: () => lastKnown(),
}));

const PUB = "ca-pub-6455244673998965";
const RECORD = "google.com, pub-6455244673998965, DIRECT, f08c47fec0942fa0";

/** Defaults-shaped settings; only the fields ads.txt reads actually matter. */
function settings(over: Partial<{ adsensePublisherId: string; adsTxt: string }> = {}) {
  return { adsensePublisherId: "", adsTxt: "", ...over };
}

async function get() {
  vi.resetModules();
  const mod = await import("./route");
  return mod.GET();
}

beforeEach(() => {
  read.mockReset();
  lastKnown.mockReset();
  lastKnown.mockReturnValue("");
  delete process.env.ADSENSE_PUBLISHER_ID;
});

afterEach(() => {
  delete process.env.ADSENSE_PUBLISHER_ID;
});

describe("/ads.txt", () => {
  it("serves the derived AdSense record when the publisher id is configured", async () => {
    read.mockResolvedValue({ settings: settings({ adsensePublisherId: PUB }), degraded: false });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    await expect(res.text()).resolves.toContain(RECORD);
  });

  /*
    🔴 THE REGRESSION THIS FILE EXISTS FOR.

    A successful read of a settings row whose publisher id has been blanked used
    to fall straight through to the 404 below. One such save is enough to cost a
    week of AdSense status.
  */
  it("falls back to the env publisher id when a SUCCESSFUL read returns a blank id", async () => {
    process.env.ADSENSE_PUBLISHER_ID = PUB;
    read.mockResolvedValue({ settings: settings(), degraded: false });
    const res = await get();
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(RECORD);
  });

  it("falls back to the last id this instance read, when there is no env var", async () => {
    lastKnown.mockReturnValue(PUB);
    read.mockResolvedValue({ settings: settings(), degraded: false });
    const res = await get();
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(RECORD);
  });

  it("keeps the operator's own text and still guarantees the AdSense record", async () => {
    read.mockResolvedValue({
      settings: settings({ adsensePublisherId: PUB, adsTxt: "exchange.example, 123, RESELLER" }),
      degraded: false,
    });
    const res = await get();
    const body = await res.text();
    expect(body).toContain("exchange.example, 123, RESELLER");
    expect(body).toContain(RECORD);
  });

  /* A 4xx is a VERDICT, a 5xx is "ask again" — the 2026-08-10 rule, still held. */
  it("answers 503, never 404, when the settings could not be read and nothing is known", async () => {
    read.mockResolvedValue({ settings: settings(), degraded: true });
    const res = await get();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("serves the record on a DEGRADED read when the env var can name the publisher", async () => {
    process.env.ADSENSE_PUBLISHER_ID = PUB;
    read.mockResolvedValue({ settings: settings(), degraded: true });
    const res = await get();
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toContain(RECORD);
  });

  /*
    404 stays reachable, and should: an empty ads.txt served 200 is a positive
    assertion that NO seller is authorised, which tells every network to stop.
    It is only correct when there is genuinely nothing to serve from anywhere.
  */
  it("404s only when nothing is configured anywhere and the read succeeded", async () => {
    read.mockResolvedValue({ settings: settings(), degraded: false });
    const res = await get();
    expect(res.status).toBe(404);
  });
});
