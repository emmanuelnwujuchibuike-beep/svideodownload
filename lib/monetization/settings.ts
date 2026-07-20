import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Global monetization switches, stored in the `settings` table under key
 * `monetization` so an admin can flip whole subsystems on/off from the
 * dashboard without a redeploy. Mirrors the pricing / plan-limits pattern.
 *
 * Defaults: everything ON (the historical behaviour), so an unconfigured site
 * behaves exactly as before.
 */

export interface MonetizationSettings {
  /** Google AdSense units (banners, and the video placements). */
  adsense: boolean;
  /**
   * AdSense publisher id (`ca-pub-…`) for the SITE-LEVEL script.
   *
   * ── Why this is separate from an ad unit's `ad_client` ────────────────────
   *
   * AdSense asks for two different things and they are easy to confuse. An ad
   * UNIT has a publisher id AND a slot id, and renders where you place it. The
   * snippet AdSense gives you to verify a site — and to run Auto ads — has a
   * publisher id and NO slot, belongs in `<head>` on every page, and renders
   * nothing by itself.
   *
   * The ad-placement form only accepted the first shape, so there was nowhere
   * to put the verification snippet at all. This is that field.
   */
  adsensePublisherId: string;
  /**
   * The literal contents of `/ads.txt`.
   *
   * Stored rather than generated because the line AdSense issues ends with a
   * verification hash unique to the account — `google.com, pub-…, DIRECT,
   * f08c47fec0942fa0` — which cannot be derived from the publisher id. Held as
   * free text so additional networks' lines can be pasted in alongside it,
   * which is exactly how ads.txt is meant to be used.
   */
  adsTxt: string;
  /**
   * Site-ownership verification meta tags, as `name|content` pairs, one per line.
   *
   * ── Why this exists ───────────────────────────────────────────────────────
   *
   * Every ad network verifies ownership, and each offers the same three or four
   * methods: a file at the site root, a meta tag, or a DNS record. The FILE
   * method is the one that cannot be supported here — Monetag/PropellerAds asks
   * for `sw.js` in the root directory, and that path is already the Frenz
   * service worker. Overwriting it would destroy offline caching, push
   * notifications, background sync and the installed-app experience, to verify
   * an ad account.
   *
   * The meta-tag method costs one line in `<head>` and conflicts with nothing,
   * so it is the one this site supports, generically, for any network.
   *
   * ── Structured pairs, not raw HTML ────────────────────────────────────────
   *
   * Stored as `name|content` and rendered into a real `<meta>` element rather
   * than injected as markup. An admin-only free-text field that reaches `<head>`
   * unescaped is a stored-XSS primitive with extra steps — and one compromised
   * or careless admin session should not be able to put a script on every page.
   */
  verificationTags: string;
  /** Adsterra networks. */
  adsterra: boolean;
  /** PropellerAds networks. */
  propellerads: boolean;
  /** Affiliate offers on the download-result page. */
  affiliates: boolean;
  /** Curated "Recommended Tools" sections (homepage/footer/sidebar/blog). */
  recommendedTools: boolean;
  /**
   * Allow interstitial / full-page units — the idle and download-complete
   * placements, and any `video` unit.
   *
   * Defaults OFF. These are the most intrusive placements on the site and
   * turning them on should be a deliberate act, not something inherited by a
   * site that never configured anything.
   */
  interstitial: boolean;
  /**
   * Allow pop-under / OnClick units (the `pop` format).
   *
   * Defaults OFF, unlike the original switch which defaulted ON. These take
   * over the visitor's next click, so running them has to be a deliberate act
   * rather than something a site inherits by never configuring anything.
   *
   * ⚠️ Turning this on while an AdSense application is under review is the most
   * common reason a site is rejected — Google prohibits units that interfere
   * with navigation, and a reviewer meeting a pop-under is meeting exactly
   * that. Both can be configured here; running them together is a real risk to
   * the AdSense account.
   */
  popunder: boolean;
}
export const DEFAULT_MONETIZATION: MonetizationSettings = {
  adsense: true,
  /*
    Empty by default. A publisher id is account-specific, so a hardcoded one
    would either be wrong or would quietly attribute another site's traffic —
    and an empty value means no script is emitted at all, which is the correct
    behaviour for a site that has not set one up.
  */
  adsensePublisherId: "",
  adsTxt: "",
  verificationTags: "",
  adsterra: true,
  propellerads: true,
  affiliates: true,
  recommendedTools: true,
  interstitial: false,
  popunder: false,
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

let cache: { at: number; value: MonetizationSettings } | null = null;
/*
  Short, because this gates whether an ad shows at all.

  `setMonetizationSettings` clears the cache on the instance that handled the
  save, but on a multi-instance deploy every OTHER instance keeps its copy until
  this expires — so this TTL is the real ceiling on "I turned Adsterra off and
  it is still showing". Sixty seconds made the switch feel broken; ten keeps the
  query cheap while making the change effectively immediate.
*/
const TTL_MS = 10_000;

/** Effective global monetization settings (defaults + admin overrides). */
export async function getMonetizationSettings(): Promise<MonetizationSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (!hasSupabase) return DEFAULT_MONETIZATION;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "monetization")
      .maybeSingle();
    const merged: MonetizationSettings = {
      ...DEFAULT_MONETIZATION,
      ...((data?.value ?? {}) as Partial<MonetizationSettings>),
    };
    cache = { at: Date.now(), value: merged };
    return merged;
  } catch {
    return DEFAULT_MONETIZATION;
  }
}

/** Admin: persist the global monetization switches. */
export async function setMonetizationSettings(s: MonetizationSettings): Promise<void> {
  const db = createAdminClient();
  await db.from("settings").upsert({ key: "monetization", value: s }, { onConflict: "key" });
  cache = null;
}
