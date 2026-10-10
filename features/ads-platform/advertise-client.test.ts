import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Part 2 in the browser and at the door: the menu costs one request a visit,
 * the form never calls the server per tap or keystroke, and every advertiser
 * route refuses a visitor who is not signed in — with the handler never run.
 */

// the catalog client reads its endpoint at import - set before it loads, or it never fetches and every count is vacuous
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

let user: { id: string } | null = null;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/rate-limit", () => ({ adApplicationLimiter: { limit: async () => ({ success: true }) } }));

const { __resetAdCatalog, loadAdCatalog } = await import("./catalog-client");
const { advertiserRoute } = await import("@/lib/ads-platform/advertiser-route");
const { AdApplicationError } = await import("@/lib/ads-platform/advertiser-server");

const CATALOG = {
  v: 1,
  settings: { ads_enabled: true, applications_open: false, multi_placement_enabled: false, max_placements_per_application: 3, display_currency: "USD", default_slot_count: 10 },
  formats: [],
  placements: [],
  durations: [],
  prices: [],
  promotions: [],
  at: "2026-10-07T12:00:00Z",
};

describe("the menu — one read per visit, straight to Postgres", () => {
  const calls: string[] = [];
  let store: Map<string, string>;
  beforeEach(() => {
    calls.length = 0;
    __resetAdCatalog();
    store = new Map();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify(CATALOG), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is a Supabase RPC, never a Vercel route", () => {
    const src = readFileSync(join(process.cwd(), "features/ads-platform/catalog-client.ts"), "utf8");
    expect(src).toContain("/rest/v1/rpc/ad_catalog");
    expect(src).not.toMatch(/fetch\(\s*["'`]\/api\//);
  });

  it("twenty steps and re-renders inside five minutes ⇒ at most one request; a reload reuses sessionStorage", async () => {
    const t0 = Date.parse("2026-10-07T12:00:00Z");
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => loadAdCatalog(t0 + i * 1000)));
    expect(answers.every((a) => a?.v === 1)).toBe(true);
    __resetAdCatalog(); // a reload
    expect((await loadAdCatalog(t0 + 60_000))?.v).toBe(1);
    expect(calls).toEqual(["https://x.supabase.co/rest/v1/rpc/ad_catalog"]);
    // after five minutes the next ask reads again - once
    await loadAdCatalog(t0 + 6 * 60_000);
    expect(calls).toHaveLength(2);
  });

  it("a failed read is null (nothing for sale), never a throw", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 404 }));
    expect(await loadAdCatalog(Date.now(), { fresh: true })).toBeNull();
  });
});

describe("no server call per tap or keystroke", () => {
  const wiz = readFileSync(join(process.cwd(), "features/ads-platform/advertise-wizard.tsx"), "utf8");
  const creative = readFileSync(join(process.cwd(), "features/ads-platform/creative-step.tsx"), "utf8");

  it("the wizard calls the server at exactly five checkpoints: save draft, submit, pay, discard, and an admin's test publish", () => {
    const sites = [...wiz.matchAll(/await api(?:<[^>]*>)?\("([^"]+)", "(POST|DELETE)"/g)].map((m) => `${m[2]} ${m[1]}`);
    // 2026-10-10: + the admin-only "Publish as test (no charge)" — one tap, refused (404) for anyone not an admin
    expect(sites.sort()).toEqual(["DELETE /api/ads/advertiser/draft", "POST /api/ads/advertiser/draft", "POST /api/ads/advertiser/submit", "POST /api/ads/advertiser/test-publish", "POST /api/ads/payment/create"]);
    // inside api(), plus ONE read on mount: is the viewer an admin (whether to show that button)
    expect(wiz.match(/\bfetch\(/g)).toHaveLength(2);
    expect(wiz).toContain('void fetch("/api/ads/advertiser/viewer")');
  });

  it("no onChange handler talks to the server", () => {
    for (const m of wiz.matchAll(/onChange=\{([^}]*)\}/g)) expect(m[1]).not.toMatch(/api\(|fetch\(|checkpoint\(/);
  });

  it("the draft is saved only when the choices changed since the last save", () => {
    expect(wiz).toContain("if (form.campaignId && form.savedKey === key && !withDetails) return form.campaignId;");
  });

  it("the upload step: checked locally BEFORE any request, bytes go to storage, two server calls", () => {
    const local = creative.indexOf("validateCreative(");
    const ticket = creative.indexOf('"/api/ads/advertiser/upload"');
    expect(local).toBeGreaterThan(-1);
    expect(ticket).toBeGreaterThan(local);
    expect([...creative.matchAll(/post<[\s\S]*?>\(\s*"(\/api\/[^"]+)"/g)].map((m) => m[1])).toEqual(["/api/ads/advertiser/upload", "/api/ads/advertiser/upload/finalize"]);
    expect(creative).toContain("putWithProgress({");
  });

  it("uploads hold the critical-activity lock (a deploy reload must not kill them)", () => {
    expect(readFileSync(join(process.cwd(), "features/ads-platform/upload-client.ts"), "utf8")).toMatch(/const end = beginCriticalActivity\(\);[\s\S]*end\(\);/);
  });

  it("the preview never asks the server: it renders the local file or the stored copy", () => {
    const preview = readFileSync(join(process.cwd(), "features/ads-platform/ad-preview.tsx"), "utf8");
    expect(preview).not.toMatch(/fetch\(|api\(/);
    expect(wiz).toContain("Preview — actual placement may vary slightly by device.");
  });
});

describe("authentication: the existing Frenzsave session, nothing else", () => {
  const req = (body: unknown = {}) => new Request("https://frenzsave.test/api/ads/advertiser/draft", { method: "POST", body: JSON.stringify(body) });

  it("an unauthenticated visitor gets 401 and the handler never runs", async () => {
    user = null;
    const handler = vi.fn();
    const res = await advertiserRoute(req(), handler);
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe("sign_in");
    expect(handler).not.toHaveBeenCalled();
  });

  it("a signed-in member reaches the handler with their own id", async () => {
    user = { id: "u-1" };
    const handler = vi.fn(async ({ userId }: { userId: string }) => ({ who: userId }));
    const res = await advertiserRoute(req({ a: 1 }), handler);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ who: "u-1" });
  });

  it("a refusal is a code + plain words; an internal error never reaches the browser", async () => {
    user = { id: "u-1" };
    const refused = await advertiserRoute(req(), async () => {
      throw new AdApplicationError("video_too_long", 400, { durationSeconds: 18, maxDurationSeconds: 15 });
    });
    expect(await refused.json()).toMatchObject({ error: "video_too_long", message: "That video is 18 seconds long. The current maximum is 15 seconds." });
    const crashed = await advertiserRoute(req(), async () => {
      throw new Error("relation public.ad_campaigns does not exist (secret detail)");
    });
    const body = (await crashed.json()) as { message: string };
    expect(crashed.status).toBe(500);
    expect(JSON.stringify(body)).not.toMatch(/relation|secret/);
  });

  it("there is no advertiser login: every advertiser route goes through advertiserRoute", () => {
    for (const r of ["draft", "upload", "upload/finalize", "submit"]) {
      const src = readFileSync(join(process.cwd(), `app/api/ads/advertiser/${r}/route.ts`), "utf8");
      const handlers = src.match(/export function (GET|POST|DELETE|PATCH)/g) ?? [];
      expect(handlers.length, r).toBeGreaterThan(0);
      expect(src.match(/advertiserRoute\(request,/g)?.length, r).toBe(handlers.length);
    }
  });
});

describe("a preview is always there (owner, 2026-10-07)", () => {
  const wiz = readFileSync(join(process.cwd(), "features/ads-platform/advertise-wizard.tsx"), "utf8");
  const preview = readFileSync(join(process.cwd(), "features/ads-platform/ad-preview.tsx"), "utf8");

  it("choosing a format shows how that format looks, before anything is uploaded", () => {
    expect(wiz).toMatch(/form\.formatCode === f\.code \? \([\s\S]*<AdPreview format=\{f\}[^>]*example compact \/>/);
  });

  it("the upload step shows the example until a real creative exists, then the real one", () => {
    expect(wiz).toMatch(/previewCreative \? \([\s\S]*<AdPreview format=\{format\} creative=\{previewCreative\}[\s\S]*\) : \([\s\S]*example compact/);
  });

  it("every preview kind has a real example image, and the example brand is Frenz AI — never a third party", () => {
    for (const f of ["example-banner.webp", "example-card.webp", "example-portrait.webp"]) {
      expect(preview).toContain(`/advertise/${f}`);
      expect(readFileSync(join(process.cwd(), "public/advertise", f)).length).toBeLessThan(20_000);
    }
    expect(preview).toContain('sponsor: "Frenz AI"');
    expect(preview).toMatch(/Example<\/span>/);
  });
});
