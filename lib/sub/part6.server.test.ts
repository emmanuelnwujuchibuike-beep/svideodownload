import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeDb, type FakeDb } from "@/lib/testing/fake-supabase";

/**
 * Frenz Exclusive Part 6 — the REAL favourites, alert preferences, announcements and fan-out,
 * against an in-memory database. The schema side (kind check, unique keys, the claim primary key,
 * policies) is proven against Postgres: supabase/tests/0251_exclusive_favourites_announcements.pglite.mjs.
 */

let db: FakeDb;
const pushes: { to: string; payload: Record<string, unknown>; record: unknown }[] = [];
const emails: { to: string; opts: Record<string, unknown> }[] = [];
let pushFails = new Set<string>();
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db.client() }));
vi.mock("./server", async () => {
  const { SUB_DEFAULTS } = await import("@/lib/rewards/config");
  return {
    subConfig: async () => SUB_DEFAULTS,
    // the real predicate, on the fake: active, paid, unexpired, no block either way
    hasActiveSub: async (viewer: string | null, creator: string) => {
      if (!viewer) return false;
      if (viewer === creator) return true;
      const now = new Date().toISOString();
      const m = (db.tables.creator_memberships ?? []).some((r) => r.creator_id === creator && r.member_id === viewer && r.status === "active" && r.billing === "sub" && String(r.period_end) > now);
      const b = (db.tables.blocks ?? []).some((r) => (r.blocker_id === creator && r.blocked_id === viewer) || (r.blocker_id === viewer && r.blocked_id === creator));
      return m && !b;
    },
  };
});
vi.mock("@/lib/notifications/smart-delivery", () => ({
  sendSmartPush: async (to: string, payload: Record<string, unknown>, _p: unknown, _c: unknown, record: unknown) => {
    if (pushFails.has(to)) throw new Error("push service down");
    pushes.push({ to, payload, record });
  },
}));
vi.mock("@/lib/email/member-email", () => ({ emailMember: async (to: string, opts: Record<string, unknown>) => void emails.push({ to, opts }) }));
vi.mock("@/lib/push/identity", () => ({ pushPerson: async () => ({ name: "Amaka", handle: "amaka", icon: undefined }) }));

const fav = await import("./favourites");
const prefs = await import("./private-notify");
const ann = await import("./announcements");
const fan = await import("./fanout");
const { hasActiveSub } = await import("./server");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = U(1);
const C = U(2); // creator
const C2 = U(3); // another creator
const OTHER = U(4);
const DAY = 86_400_000;
const at = (d: number) => new Date(Date.now() + d * DAY).toISOString();
const profile = (id: string, handle: string, over: Record<string, unknown> = {}) => ({ id, handle, display_name: handle, avatar_url: null, is_verified: false, is_suspended: false, is_hidden: false, ...over });
const sub = (member: string, over: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), creator_id: C, member_id: member, status: "active", billing: "sub", period_end: at(10), period_index: 1, ...over });

beforeEach(() => {
  db = fakeDb({
    profiles: [profile(ME, "me"), profile(C, "amaka"), profile(C2, "tobi"), profile(OTHER, "other")],
    blocks: [],
    muted_creators: [],
    social_circles: [],
    circle_members: [],
    creator_membership_settings: [{ creator_id: C, sub_active: true, sub_price_cents: 1000, setup_completed_at: at(-30) }],
    creator_memberships: [],
    creator_notification_prefs: [],
    creator_notes: [],
    sub_posts: [],
    sub_fanout_jobs: [],
    sub_fanout_deliveries: [],
  });
  db.unique.social_circles = [["owner_id", "kind"]];
  db.unique.circle_members = [["circle_id", "member_id"]];
  db.unique.creator_notes = [["creator_id", "idempotency_key"]];
  db.unique.sub_fanout_jobs = [["kind", "ref_id"]];
  db.unique.sub_fanout_deliveries = [["job_id", "recipient_id"]];
  db.defaults.sub_fanout_jobs = { state: "pending", cursor: null, handed_off: 0, skipped: 0, failed: 0, runs: 0 };
  db.defaults.creator_notes = { deleted_at: null };
  pushes.length = 0;
  emails.length = 0;
  pushFails = new Set();
});

// ─── Favourites ──────────────────────────────────────────────────────────────

describe("favourites", () => {
  it("add and remove, both idempotent; the circle is created once, of kind favourite_creators, owned by the member", async () => {
    expect(await fav.addFavourite(ME, C)).toEqual({ ok: true, already: false });
    expect(await fav.addFavourite(ME, C)).toEqual({ ok: true, already: true });
    expect(db.tables.social_circles).toHaveLength(1);
    expect(db.tables.social_circles![0]).toMatchObject({ owner_id: ME, kind: "favourite_creators" });
    expect(db.tables.circle_members).toHaveLength(1);
    expect(await fav.isFavourite(ME, C)).toBe(true);
    expect(await fav.removeFavourite(ME, C)).toEqual({ ok: true, already: false });
    expect(await fav.removeFavourite(ME, C)).toEqual({ ok: true, already: true });
    expect(await fav.isFavourite(ME, C)).toBe(false);
  });

  it("a member's favourites are their own: removing as someone else touches nothing", async () => {
    await fav.addFavourite(ME, C);
    expect(await fav.removeFavourite(OTHER, C)).toEqual({ ok: true, already: true });
    expect(await fav.isFavourite(ME, C)).toBe(true);
    const list = await fav.listFavourites(OTHER);
    expect(list).toMatchObject({ ok: true, items: [] });
  });

  it("no self-favourite (the circles model never contains its owner); malformed ids are refused before any read", async () => {
    expect(await fav.addFavourite(C, C)).toMatchObject({ ok: false, reason: "self" });
    db.failOn.profiles = "should not be read";
    expect(await fav.addFavourite(ME, "x),or(id.neq.0")).toMatchObject({ ok: false, status: 400 });
    expect(db.tables.circle_members).toHaveLength(0);
  });

  it("blocked either way, suspended, hidden or missing: the same refusal, and no account state revealed", async () => {
    db.tables.profiles!.push(profile(U(10), "sus", { is_suspended: true }), profile(U(11), "hid", { is_hidden: true }));
    db.tables.blocks = [{ blocker_id: C2, blocked_id: ME }];
    const answers = await Promise.all([fav.addFavourite(ME, C2), fav.addFavourite(ME, U(10)), fav.addFavourite(ME, U(11)), fav.addFavourite(ME, U(99))]);
    for (const a of answers) expect(a).toEqual({ ok: false, error: "You can't favourite this account.", status: 404, reason: "unavailable" });
    expect(db.tables.circle_members).toHaveLength(0);
  });

  it("favouriting grants no access, and removing a favourite never cancels a subscription", async () => {
    await fav.addFavourite(ME, C);
    expect(await hasActiveSub(ME, C)).toBe(false);
    db.tables.creator_memberships = [sub(ME)];
    await fav.removeFavourite(ME, C);
    expect(db.tables.creator_memberships[0]).toMatchObject({ status: "active", period_end: db.tables.creator_memberships[0]!.period_end });
    expect(db.writes.some((w) => w.table === "creator_memberships")).toBe(false);
    expect(await hasActiveSub(ME, C)).toBe(true);
  });

  it("the list is paged (bounded, stable), batched, public fields only, and leaves out blocked / suspended accounts", async () => {
    const n = fav.FAVOURITES_PAGE * 2 + 3;
    for (let i = 0; i < n; i++) db.tables.profiles!.push(profile(U(1000 + i), `c${i}`));
    for (let i = 0; i < n; i++) expect((await fav.addFavourite(ME, U(1000 + i))).ok).toBe(true);
    // equal timestamps on purpose: the member id breaks ties
    for (const r of db.tables.circle_members!) r.added_at = "2026-10-16T10:00:00.000Z";
    db.tables.profiles!.find((p) => p.id === U(1000))!.is_suspended = true;
    db.tables.blocks = [{ blocker_id: U(1001), blocked_id: ME }];
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    for (let i = 0; i < 10; i++) {
      const before = db.writes.length;
      const page: Awaited<ReturnType<typeof fav.listFavourites>> = await fav.listFavourites(ME, cursor);
      if (!page.ok) throw new Error("page");
      expect(db.writes.length).toBe(before); // a read writes nothing
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(fav.FAVOURITES_PAGE);
      seen.push(...page.items.map((x) => x.id));
      for (const it of page.items) expect(Object.keys(it).sort()).toEqual(["addedAt", "avatarUrl", "displayName", "handle", "id", "offersSubscriptions", "verified"]);
      cursor = page.next;
      if (!cursor) break;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(n - 2);
    expect(seen).not.toContain(U(1000));
    expect(seen).not.toContain(U(1001));
  });

  it("'offers subscriptions' is the creator's public live state, nothing more", async () => {
    await fav.addFavourite(ME, C);
    await fav.addFavourite(ME, C2);
    const out = await fav.listFavourites(ME);
    if (!out.ok) throw new Error("list");
    expect(Object.fromEntries(out.items.map((i) => [i.id, i.offersSubscriptions]))).toEqual({ [C]: true, [C2]: false });
  });
});

// ─── Preferences ─────────────────────────────────────────────────────────────

describe("alert preferences", () => {
  it("valid modes save; the other column on the row is preserved", async () => {
    db.tables.creator_notification_prefs = [{ viewer_id: ME, target_id: C, posts: true, shares: false, private_posts: "email", announcements: "push" }];
    expect(await prefs.setAnnouncementMode(ME, C, "both")).toEqual({ ok: true });
    expect(db.tables.creator_notification_prefs[0]).toMatchObject({ posts: true, shares: false, private_posts: "email", announcements: "both" });
    expect(await prefs.setPrivatePostMode(ME, C, "off")).toEqual({ ok: true });
    expect(db.tables.creator_notification_prefs[0]).toMatchObject({ private_posts: "off", announcements: "both", posts: true });
  });

  it("invalid modes and self-preferences are refused and write nothing", async () => {
    expect(await prefs.setAnnouncementMode(ME, C, "sms" as never)).toEqual({ ok: false });
    expect(await prefs.setPrivatePostMode(ME, C, "loud" as never)).toEqual({ ok: false });
    expect(await prefs.setAnnouncementMode(C, C, "push")).toEqual({ ok: false });
    expect(db.writes.filter((w) => w.table === "creator_notification_prefs")).toHaveLength(0);
  });

  it("an unset preference reads as off for posts and push for announcements", async () => {
    expect(await prefs.getAlertPrefs(ME, C)).toEqual({ mode: "off", announcements: "push", ready: true });
  });
});

// ─── Announcements ───────────────────────────────────────────────────────────

describe("announcements", () => {
  const KEY = "draft-key-0001";
  it("a creator publishes to their own audience; a retry with the same key is the same announcement, one job", async () => {
    const a = await ann.createAnnouncement(C, { title: "Hello", body: "New set on Friday", idempotencyKey: KEY });
    const b = await ann.createAnnouncement(C, { title: "Hello", body: "New set on Friday", idempotencyKey: KEY });
    if (!a.ok || !b.ok) throw new Error("publish");
    expect(b.duplicate).toBe(true);
    expect(b.announcement.id).toBe(a.announcement.id);
    expect(db.tables.creator_notes).toHaveLength(1);
    expect(db.tables.creator_notes![0]).toMatchObject({ creator_id: C, audience: "subscribers" });
    expect(db.tables.sub_fanout_jobs).toHaveLength(1);
  });

  it("a creator who isn't set up, bad input, and HTML are refused", async () => {
    expect(await ann.createAnnouncement(C2, { title: "x", body: "y", idempotencyKey: KEY })).toMatchObject({ ok: false, reason: "not_set_up" });
    expect(await ann.createAnnouncement(C, { title: "", body: "y", idempotencyKey: KEY })).toMatchObject({ ok: false });
    expect(await ann.createAnnouncement(C, { title: "t".repeat(81), body: "y", idempotencyKey: KEY })).toMatchObject({ ok: false });
    expect(await ann.createAnnouncement(C, { title: "x", body: "<script>", idempotencyKey: KEY })).toMatchObject({ ok: false });
    expect(await ann.createAnnouncement(C, { title: "x", body: "y", idempotencyKey: "bad key" })).toMatchObject({ ok: false });
    expect(db.tables.creator_notes).toHaveLength(0);
  });

  it("only the creator and active subscribers can read them; everyone else gets access:false and nothing", async () => {
    await ann.createAnnouncement(C, { title: "Hello", body: "For subscribers", idempotencyKey: KEY });
    db.tables.creator_memberships = [sub(ME), sub(U(20), { period_end: at(-1) }), sub(U(21), { status: "removed" }), sub(U(22), { status: "ended" }), sub(U(23)), sub(U(24), { billing: "free", period_end: null })];
    db.tables.blocks = [{ blocker_id: C, blocked_id: U(23) }];
    expect(await ann.listAnnouncements(ME, C)).toMatchObject({ ok: true, access: true, items: [{ title: "Hello" }] });
    expect(await ann.listAnnouncements(C, C)).toMatchObject({ ok: true, access: true, items: [{ title: "Hello", delivery: expect.anything() }] });
    for (const who of [U(20), U(21), U(22), U(23), U(24), OTHER, null]) {
      const out = await ann.listAnnouncements(who, C);
      expect(out, String(who)).toEqual({ ok: true, access: false, items: [], next: null });
    }
    // a subscriber sees no delivery numbers
    const mine = await ann.listAnnouncements(ME, C);
    expect(JSON.stringify(mine)).not.toContain("handedOff");
  });

  it("another creator can't delete it, and deleting keeps the row (audit) and stops the fan-out", async () => {
    const a = await ann.createAnnouncement(C, { title: "Hello", body: "x", idempotencyKey: KEY });
    if (!a.ok) throw new Error("publish");
    expect(await ann.deleteAnnouncement(C2, a.announcement.id)).toMatchObject({ ok: false, status: 404 });
    expect(db.tables.creator_notes![0]!.deleted_at).toBeNull();
    expect(await ann.deleteAnnouncement(C, a.announcement.id)).toEqual({ ok: true });
    expect(db.tables.creator_notes).toHaveLength(1);
    expect(db.tables.creator_notes![0]!.deleted_at).toBeTruthy();
    expect(db.tables.sub_fanout_jobs![0]).toMatchObject({ state: "cancelled" });
    db.tables.creator_memberships = [sub(ME)];
    expect(await ann.listAnnouncements(ME, C)).toMatchObject({ access: true, items: [] });
  });
});

// ─── The fan-out ─────────────────────────────────────────────────────────────

async function announce(): Promise<string> {
  const a = await ann.createAnnouncement(C, { title: "Secret title", body: "Secret body", idempotencyKey: `k-${crypto.randomUUID().slice(0, 12)}` });
  if (!a.ok || !a.jobId) throw new Error("publish");
  return a.jobId;
}
async function drain(jobId: string, page = fan.FANOUT_PAGE) {
  for (let i = 0; i < 100; i++) {
    const r = await fan.processFanoutPage(jobId, page);
    if (!r || r.done) return;
  }
}
const sentTo = () => [...new Set(pushes.map((p) => p.to))].sort();

describe("announcement fan-out", () => {
  it("only active subscribers; expired, removed, ended, refunded-away, free, blocked, muted and suspended are left out", async () => {
    db.tables.profiles!.push(profile(U(30), "s30"), profile(U(31), "s31"), profile(U(32), "s32"), profile(U(33), "s33"), profile(U(34), "s34"), profile(U(35), "s35", { is_suspended: true }), profile(U(36), "s36"), profile(U(37), "s37"));
    db.tables.creator_memberships = [sub(U(30)), sub(U(31), { period_end: at(-1) }), sub(U(32), { status: "removed" }), sub(U(33), { status: "ended" }), sub(U(34), { billing: "free", period_end: null }), sub(U(35)), sub(U(36)), sub(U(37))];
    db.tables.blocks = [{ blocker_id: U(36), blocked_id: C }];
    db.tables.muted_creators = [{ muter_id: U(37), muted_id: C }];
    await drain(await announce());
    expect(sentTo()).toEqual([U(30)]);
  });

  it("the payload never carries the announcement: no title, no body — just who posted and a link to their tab", async () => {
    db.tables.creator_memberships = [sub(ME)];
    db.tables.creator_notification_prefs = [{ viewer_id: ME, target_id: C, announcements: "both" }];
    await drain(await announce());
    const all = JSON.stringify([pushes, emails]);
    expect(all).not.toContain("Secret");
    expect(pushes[0]!.payload).toMatchObject({ title: "Amaka", body: "Posted an announcement for subscribers", url: "/u/amaka?tab=sub#announcements" });
    expect(emails[0]!.opts).toMatchObject({ ctaPath: "/u/amaka?tab=sub#announcements" });
  });

  it("each member's channel choice is respected: off skips, email only emails, default is push", async () => {
    db.tables.profiles!.push(profile(U(40), "a"), profile(U(41), "b"), profile(U(42), "c"));
    db.tables.creator_memberships = [sub(U(40)), sub(U(41)), sub(U(42))];
    db.tables.creator_notification_prefs = [
      { viewer_id: U(40), target_id: C, announcements: "off" },
      { viewer_id: U(41), target_id: C, announcements: "email" },
    ];
    const job = await announce();
    await drain(job);
    expect(sentTo()).toEqual([U(42)]);
    expect(emails.map((e) => e.to)).toEqual([U(41)]);
    const d = Object.fromEntries(db.tables.sub_fanout_deliveries!.map((r) => [r.recipient_id, `${r.status as string}:${(r.detail as string) ?? r.channels}`]));
    expect(d).toEqual({ [U(40)]: "skipped:opted_out", [U(41)]: "handed_off:email", [U(42)]: "handed_off:push" });
  });

  it("re-running a page, the sweep, or two workers at once never notify anyone twice", async () => {
    db.tables.profiles!.push(profile(U(50), "a"), profile(U(51), "b"));
    db.tables.creator_memberships = [sub(U(50)), sub(U(51))];
    const job = await announce();
    // a stale worker that read the job before the first one moved its cursor
    const [a, b] = await Promise.all([fan.processFanoutPage(job), fan.processFanoutPage(job)]);
    expect((a?.claimed ?? 0) + (b?.claimed ?? 0)).toBe(2);
    db.tables.sub_fanout_jobs![0]!.state = "pending";
    db.tables.sub_fanout_jobs![0]!.cursor = null;
    await fan.sweepFanout();
    expect(pushes).toHaveLength(2);
    expect(sentTo()).toEqual([U(50), U(51)]);
  });

  it("large lists go out in bounded pages, with the cursor advancing — never all at once", async () => {
    const n = 23;
    for (let i = 0; i < n; i++) {
      db.tables.profiles!.push(profile(U(2000 + i), `m${i}`));
      db.tables.creator_memberships!.push(sub(U(2000 + i)));
    }
    const job = await announce();
    const first = await fan.processFanoutPage(job, 10);
    expect(first).toMatchObject({ claimed: 10, done: false });
    expect(pushes).toHaveLength(10);
    await fan.processFanoutPage(job, 10);
    expect(pushes).toHaveLength(20);
    const last = await fan.processFanoutPage(job, 10);
    expect(last).toMatchObject({ claimed: 3, done: true });
    expect(db.tables.sub_fanout_jobs![0]).toMatchObject({ state: "done", handed_off: 23 });
    expect(sentTo()).toHaveLength(n);
  });

  it("a hand-off that throws is recorded as failed — never counted as sent — and is not retried into a duplicate", async () => {
    db.tables.profiles!.push(profile(U(60), "a"), profile(U(61), "b"));
    db.tables.creator_memberships = [sub(U(60)), sub(U(61))];
    pushFails = new Set([U(60)]);
    const job = await announce();
    await drain(job);
    expect(db.tables.sub_fanout_jobs![0]).toMatchObject({ handed_off: 1, failed: 1 });
    expect(db.tables.sub_fanout_deliveries!.find((r) => r.recipient_id === U(60))).toMatchObject({ status: "failed" });
    const status = await fan.fanoutStatuses("announcement", [db.tables.sub_fanout_jobs![0]!.ref_id as string]);
    expect([...status.values()][0]).toMatchObject({ handedOff: 1, failed: 1 });
  });

  it("a failed eligibility read sends to nobody and claims nobody (the next run retries)", async () => {
    db.tables.creator_memberships = [sub(ME)];
    const job = await announce();
    db.failOn.blocks = "outage";
    expect(await fan.processFanoutPage(job)).toBeNull();
    expect(pushes).toHaveLength(0);
    expect(db.tables.sub_fanout_deliveries).toHaveLength(0);
  });
});

describe("private-post fan-out (hidden-post privacy, Part 3 rules)", () => {
  const post = (over: Record<string, unknown> = {}) => ({ id: U(500), creator_id: C, status: "published", audience: "locked", moderated_at: null, caption: "SECRET CAPTION", ...over });
  const optIn = (ids: string[]) => ids.map((v) => ({ viewer_id: v, target_id: C, private_posts: "both" }));
  beforeEach(() => {
    db.tables.profiles!.push(profile(U(70), "sub"), profile(U(71), "follower"), profile(U(72), "expired"), profile(U(73), "removed"));
    db.tables.creator_memberships = [sub(U(70)), sub(U(72), { period_end: at(-1) }), sub(U(73), { status: "removed" })];
    db.tables.creator_notification_prefs = optIn([U(70), U(71), U(72), U(73)]);
  });

  it("a HIDDEN post goes only to active subscribers who opted in; nobody else learns it exists", async () => {
    db.tables.sub_posts = [post({ audience: "hidden" })];
    const job = await fan.enqueueFanout("private_post", U(500), C);
    await drain(job!);
    expect(sentTo()).toEqual([U(70)]);
    expect(emails.map((e) => e.to)).toEqual([U(70)]);
  });

  it("a LOCKED post goes to everyone who opted in, with only the approved public facts", async () => {
    db.tables.sub_posts = [post()];
    await drain((await fan.enqueueFanout("private_post", U(500), C))!);
    expect(sentTo()).toEqual([U(70), U(71), U(72), U(73)].sort());
    for (const p of pushes) expect(p.payload).toMatchObject({ title: "Amaka", body: "Posted a new private post", url: "/u/amaka?tab=sub" });
    const all = JSON.stringify([pushes, emails]);
    for (const leak of ["SECRET CAPTION", "sub/", "r2", "X-Amz", "object_key", U(500)]) expect(all).not.toContain(leak);
  });

  it("the audience is read at SEND time: a post switched to hidden mid-fan-out stops reaching non-subscribers", async () => {
    db.tables.sub_posts = [post()];
    const job = (await fan.enqueueFanout("private_post", U(500), C))!;
    await fan.processFanoutPage(job, 1); // U(70)
    db.tables.sub_posts[0]!.audience = "hidden";
    await drain(job, 1);
    expect(sentTo()).toEqual([U(70)]);
  });

  it("a post deleted or taken down before its alerts finish: the job is cancelled, nothing more is sent", async () => {
    db.tables.sub_posts = [post({ moderated_at: at(-0.01), status: "archived" })];
    const job = (await fan.enqueueFanout("private_post", U(500), C))!;
    expect(await fan.processFanoutPage(job)).toMatchObject({ done: true });
    expect(pushes).toHaveLength(0);
    expect(db.tables.sub_fanout_jobs![0]).toMatchObject({ state: "cancelled" });
  });

  it("one job per post, however many times it is enqueued", async () => {
    db.tables.sub_posts = [post()];
    const a = await fan.enqueueFanout("private_post", U(500), C);
    const b = await fan.enqueueFanout("private_post", U(500), C);
    expect(a).toBe(b);
    expect(db.tables.sub_fanout_jobs).toHaveLength(1);
  });
});

describe("the membership page never carries subscriber announcements (found while building Part 6)", () => {
  it("members notes only: a subscribers-audience or deleted note is filtered out, older rows (no audience) stay", async () => {
    const { isMembersNote } = await import("@/lib/creator/membership/server");
    expect(isMembersNote({ body: "pre-0251 note" })).toBe(true);
    expect(isMembersNote({ body: "community", audience: "members", deleted_at: null })).toBe(true);
    expect(isMembersNote({ body: "for subscribers", audience: "subscribers", deleted_at: null })).toBe(false);
    expect(isMembersNote({ body: "deleted", audience: "members", deleted_at: at(-1) })).toBe(false);
  });

  it("the community notes delete can't hard-delete an announcement (its delete is soft and audited)", async () => {
    const { deleteNote } = await import("@/lib/creator/membership/server");
    const a = await ann.createAnnouncement(C, { title: "Hello", body: "x", idempotencyKey: "keep-me-0001" });
    if (!a.ok) throw new Error("publish");
    expect(await deleteNote(C, a.announcement.id)).toMatchObject({ ok: false, status: 409 });
    expect(db.tables.creator_notes).toHaveLength(1);
  });

  it("creatorPage and the dashboard read notes through that filter (source check of both reads)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("lib/creator/membership/server.ts", "utf8");
    expect(src.match(/\.filter\(isMembersNote\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
