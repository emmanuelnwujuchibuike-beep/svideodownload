import { describe, expect, it } from "vitest";

import { isLinkPreviewBot, LINK_PREVIEW_AGENTS } from "@/lib/seo/link-preview-bots";
import { genericShareCard, renderShareCard, SITE_SHARE_IMAGE } from "@/lib/seo/share-card";
import { SHARE_DESCRIPTION, SHARE_TITLE } from "@/lib/seo/share";
import { SITE_URL } from "@/lib/site";

/**
 * The share card a chat app's preview fetcher gets for an app-only address (code review, 2026-10-30): the head tags a
 * preview is drawn from, and nothing of the page. The route is driven for real (no database under test → the site's
 * card, exactly what a profile that cannot be read falls back to).
 */
const SITE = "https://www.frenzsave.com";

describe("who is a link-preview fetcher", () => {
  it("the fetchers chat apps really send", () => {
    for (const ua of [
      "WhatsApp/2.23.20.0 A",
      "WhatsApp/2.2401.3 i",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
      "Twitterbot/1.0",
      "TelegramBot (like TwitterBot)",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    ]) {
      expect(isLinkPreviewBot(ua), ua).toBe(true);
    }
  });

  it("🔴 never a search or ad crawler — even one that carries a preview word", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mediapartners-Google",
      "AdsBot-Google (+http://www.google.com/adsbot.html)",
      "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)",
      "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Googlebot/2.1 facebookexternalhit/1.1",
    ]) {
      expect(isLinkPreviewBot(ua), ua).toBe(false);
    }
  });

  it("never a person — browsers and the in-app browsers of the same apps", () => {
    for (const ua of [
      "",
      null,
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.0",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]",
      "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.40.0 Chrome/128.0 Electron/32.0 Safari/537.36",
      "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [LinkedInApp]",
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WhatsApp",
    ]) {
      expect(isLinkPreviewBot(ua), String(ua)).toBe(false);
    }
  });

  it("names product tokens robots.txt can carry (no spaces, no search engine)", () => {
    for (const t of LINK_PREVIEW_AGENTS) {
      expect(t, t).toMatch(/^[A-Za-z][A-Za-z0-9-]*$/);
      expect(/google|bing/i.test(t), t).toBe(false);
    }
  });
});

describe("the card", () => {
  it("carries the title, description, address and picture — escaped and absolute", () => {
    const html = renderShareCard(
      { title: `Ada "the <b>" Obi (@ada)`, description: "Bio & more", url: "/ada", image: "https://media.example/a.jpg", type: "profile", signInPath: "/login?next=%2Fada" },
      SITE,
    );
    expect(html).toContain('<meta property="og:title" content="Ada &quot;the &lt;b&gt;&quot; Obi (@ada)">');
    expect(html).toContain('<meta property="og:description" content="Bio &amp; more">');
    expect(html).toContain(`<meta property="og:url" content="${SITE}/ada">`);
    expect(html).toContain('<meta property="og:image" content="https://media.example/a.jpg">');
    expect(html).toContain('<meta property="og:type" content="profile">');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain(`href="${SITE}/login?next=%2Fada"`);
    // the raw markup never reaches the document (teeth: an unescaped title would add a <b> element)
    expect(html).not.toContain("<b>");
  });

  it("with no picture of its own: the site's share image, as the large card", () => {
    const html = renderShareCard(genericShareCard("/home", "/home"), SITE);
    expect(html).toContain(`<meta property="og:image" content="${SITE}${SITE_SHARE_IMAGE}">`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("the generic card names the area that was shared, else the site", () => {
    expect(genericShareCard("/reels", "/reels?tab=ai")).toMatchObject({ title: "Reels on Frenzsave", url: "/reels?tab=ai", description: SHARE_DESCRIPTION, image: null });
    expect(genericShareCard("/exclusive", "/exclusive").title).toBe("Frenz Exclusive on Frenzsave");
    expect(genericShareCard("/home", "/home").title).toBe(SHARE_TITLE);
    expect(genericShareCard("/reels", "/reels?tab=ai").signInPath).toBe("/login?next=%2Freels%3Ftab%3Dai");
  });
});

describe("GET /api/share-card", () => {
  const call = async (qs: string) => {
    const { GET } = await import("@/app/api/share-card/route");
    return GET(new Request(`${SITE}/api/share-card?${qs}`));
  };

  it("answers HTML that no cache may keep and no search engine may index", async () => {
    const res = await call("path=%2Fu%2Fchris&to=%2Fchris");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/html/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    const html = await res.text();
    expect(html).toContain("<meta property=\"og:title\"");
    expect(html).toContain(`href="${SITE_URL}/login?next=%2Fchris"`);
  });

  it("ignores anything but an app-only path and a same-site address (teeth: no open redirect, no other page)", async () => {
    const html = await (await call("path=%2Fabout&to=https%3A%2F%2Fevil.example%2F")).text();
    expect(html).not.toContain("evil.example");
    expect(html).toContain(`<meta property="og:url" content="${SITE_URL}/">`);
    const sneaky = await (await call("path=%2Freels&to=%2F%2Fevil.example")).text();
    expect(sneaky).not.toContain("evil.example");
    expect(sneaky).toContain(`<meta property="og:url" content="${SITE_URL}/reels">`);
  });
});
