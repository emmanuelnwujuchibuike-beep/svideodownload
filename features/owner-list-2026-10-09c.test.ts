import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WARM_WIDTHS, warmUrls } from "@/lib/wallpapers-warm";

const code = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// Owner list, 2026-10-09 (before Part 10).

describe("landing speed test (LCP 4.3 s, TTI 9.2 s)", () => {
  it("the rotator requests nothing extra until the page has loaded, and never ticks before its next frame exists", () => {
    const r = code("components/wallpapers/wallpaper-cta-rotator.tsx");
    expect(r).not.toContain("setTimeout(() => setRevealed(true), 50)");
    expect(r).toContain('window.addEventListener("load", whenIdle, { once: true });');
    expect(r).toContain("requestIdleCallback(start");
    expect(r).toContain("const run = started && onScreen && !document.hidden;");
    // Part 9's three-frame window stays: only the frames around the active one are mounted
    expect(r).toContain("if (!keep(i)) return null;");
    expect(r).toContain("priority={i === 0}");
  });

  it("a published wallpaper warms the exact variants the landing card asks for", () => {
    const urls = warmUrls("https://x.supabase.co/storage/v1/object/public/wallpapers/a b.jpg", "https://frenzsave.com");
    expect(urls).toHaveLength(WARM_WIDTHS.length);
    // byte-identical to next/image's own URL: encoded src, a configured deviceSize, the card's quality
    expect(urls[0]).toBe("https://frenzsave.com/_next/image?url=https%3A%2F%2Fx.supabase.co%2Fstorage%2Fv1%2Fobject%2Fpublic%2Fwallpapers%2Fa%20b.jpg&w=640&q=50");
    const cfg = code("next.config.ts");
    for (const w of WARM_WIDTHS) expect(cfg).toMatch(new RegExp(`deviceSizes: \\[[^\\]]*\\b${w}\\b`));
    for (const f of ["app/api/wallpapers/share/route.ts", "app/api/admin/wallpapers/route.ts"]) {
      expect(code(f), f).toContain("if (warm.length) after(() => Promise.all(warm.map(warmWallpaperImage)));");
    }
  });

  it("a browser tab never preloads the installed-app splash", () => {
    expect(code("app/layout.tsx")).toContain('href="/brand/frenz-logo-splash.png" fetchPriority="high" media="(display-mode: standalone)"');
    expect(code("features/app-shell/boot-splash.tsx")).toContain('alt="" loading="lazy" />');
  });
});

describe("credits page and AI dashboard strip: no reload on entry", () => {
  it("one shared wallet, no mount fetch, one realtime channel", () => {
    const w = code("features/ai/wallet/use-wallet.ts");
    expect(w).toContain("revalidateOnMount: false");
    expect(w).toContain("revalidateOnFocus: false");
    expect(w).toContain("stop ??= startChannel(uid);");
    expect(w).not.toMatch(/setInterval|refetchInterval/);
  });

  it("the credits page reads it and only re-reads after a payment return", () => {
    const p = code("features/ai/frenz-ai-usage-page.tsx");
    expect(p).toContain("const wallet = useWallet();");
    expect(p).toContain("if (planReturn || reference || welcome) await load();");
    expect(p).not.toContain(".channel(`wallet-balance:");
  });

  it("the strip paints from the snapshot on client navigations, never an empty first frame", () => {
    const s = code("features/ai/design/ai-credit-strip.tsx");
    expect(s).toContain("let stripHydrated = false;");
    expect(s).toContain("stripHydrated && hasAuthCookie() ? readCachedCharacterReplaceBalance() : null");
    expect(s).toContain("    stripHydrated = true;");
    // live, without polling: the snapshot write announces itself
    expect(s).toContain("window.addEventListener(BALANCE_EVENT, onBalance);");
  });
});

describe("small fixes", () => {
  it("the credit strip logo has no black tile", () => {
    const s = code("features/ai/design/ai-credit-strip.tsx");
    expect(s).toContain('<span className="flex h-8 w-8 shrink-0 items-center justify-center">');
    expect(s).not.toMatch(/bg-black/);
  });

  it("the plan badge has no square ring", () => {
    expect(code("features/auth/user-menu.tsx")).toContain('<MyDiamondCrownBadge size="xs" className="absolute -bottom-1 -right-1" />');
    expect(code("app/(app)/account/page.tsx")).not.toMatch(/DiamondCrownBadge[^\n]*ring-2/);
  });

  it("Promote responds on the first tap with a spinner and warms its route", () => {
    const b = code("features/downloads/promote-button.tsx");
    expect(b).toContain("warmOnIdle");
    expect(b).toContain("group-data-[pending]:hidden");
    expect(b).toContain("group-data-[pending]:inline-block");
  });

  it("Promote sits in the top bar on /downloads, as on the landing header", () => {
    expect(code("features/app-shell/app-topbar.tsx")).toContain('{pathname === "/downloads" && !searchActive ? <PromoteButton size="header" /> : null}');
    const core = code("features/downloads/download-page-core.tsx");
    expect(core).not.toContain("<PromoteButton");
    expect(core).toContain('<AiCreditStrip base="/ai" className="mb-3" />');
  });

  it("Save. Discover. Create. sits under the credits card on /downloads, without the paragraph", () => {
    const core = code("features/downloads/download-page-core.tsx");
    expect(core).toContain("subtitle={topCredits !== \"strip\"}");
    expect(core).not.toContain("headline={topCredits !== \"strip\"}");
    expect(core.indexOf("<AiCreditStrip")).toBeLessThan(core.indexOf("<DownloadsHero"));
    expect(code("features/downloads/downloads-sections.tsx")).toContain("{subtitle ? (");
  });
});

describe("admin pushes for referrals", () => {
  it("a referral sign-in pushes after the claim succeeds", () => {
    const r = code("app/api/referrals/claim/route.ts");
    expect(r).toContain("if (out.ok) after(() => notifyAdminsOfReferralSignIn(user.id, out.referrerId ?? null));");
    expect(code("lib/referrals/server.ts")).toContain("referrerId: out.referrer_id ?? null");
  });

  it("copying or sharing the invite link pushes, signed-in and rate-capped", () => {
    const r = code("app/api/referrals/shared/route.ts");
    expect(r).toContain("if (!user) return");
    expect(r).toContain("shareLimiter.limit(`referral-alert:${user.id}`)");
    expect(r).toContain("after(() => notifyAdminsOfReferralShare(user.id");
    for (const f of ["features/rewards/rewards-page.tsx", "features/rewards/referral-banner.tsx"]) {
      expect(code(f), f).toContain('if (out === "copied" || out === "shared") reportReferralShared(out,');
    }
  });
});

// owner, 2026-10-09: "History Medias and the Frenz logo at the top reloads on every page entry"
describe("no flash on page entry", () => {
  it("every history tile is LAZY (section by section); a seen one decodes sync once it loads on screen", () => {
    const t = code("components/ui/smart-thumb.tsx");
    // owner, later the same day: "the medias shouldn't load at once … section by section" — never eager
    expect(t).toContain('loading="lazy"');
    expect(t).not.toMatch(/loading=\{[^}]*"eager"/);
    expect(t).toContain('decoding={isImageSeen(src) ? "sync" : "async"}');
    expect(t).toContain("onLoad={(e) => markImageSeen(src, e.currentTarget)}");
  });

  it("the Frenz logo is eager and decoded synchronously", () => {
    const l = code("components/brand/frenz-logo.tsx");
    expect(l).toContain('loading={priority ? undefined : "eager"}');
    expect(l).toContain('decoding="sync"');
  });
});
