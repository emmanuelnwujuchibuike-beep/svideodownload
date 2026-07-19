/**
 * English UI strings — the source of truth for every message key.
 *
 * ── Why UI strings live in code and content lives in the database ─────────────
 *
 * Migration 0086 already models translation as a workflow: `translations` rows
 * carry a status (`missing` → `machine` → `reviewed` → `approved`) and a
 * staleness marker against the source version. That is the right shape for
 * ARTICLES — a lesson body is authored, reviewed and republished on its own
 * cadence, independent of a deploy.
 *
 * Chrome is not that. "Pricing", "Search Frenz", the footer blurb — these change
 * only when the interface changes, they must be present before first paint on a
 * static page, and a missing one is a broken layout rather than a stale
 * paragraph. Routing them through a database read would un-static the marketing
 * pages (the exact defect that cost `/` its CDN caching) and put a network hop in
 * front of a button label.
 *
 * So: content translations compile from the DB, UI strings compile from here.
 * Same principle as the Living Content Platform's "DB is the authoring plane,
 * approved content compiles to static TS" — this is the compiled end of it.
 *
 * ── This object defines the key space ─────────────────────────────────────────
 *
 * `Messages` is derived from this object with `typeof`, so every other locale is
 * type-checked against English. Adding a key here without adding it elsewhere is
 * a compile error in the catalogue registry, not a runtime hole — and a key that
 * exists ONLY in another locale cannot be expressed at all.
 */
export const en = {
  /* ------------------------------- site header ------------------------------- */
  "nav.home": "Home",
  "nav.features": "Features",
  "nav.products": "Products",
  "nav.download": "Download",
  "nav.pricing": "Pricing",
  "nav.academy": "Academy",
  "nav.support": "Support",
  "nav.launchApp": "Launch App",
  "nav.openMenu": "Open menu",
  "nav.closeMenu": "Close menu",

  /* ------------------------------- site footer ------------------------------- */
  "footer.blurb":
    "Frenz is your all-in-one super app for downloading, creating, sharing and connecting. Save more. Do more. Be more.",
  "footer.products": "Products",
  "footer.company": "Company",
  "footer.learn": "Learn",
  "footer.support": "Support",
  "footer.newsletterTitle": "Stay in the Loop",
  "footer.newsletterBody": "Get the latest updates, tips and offers straight to your inbox.",
  "footer.emailLabel": "Email address",
  "footer.emailPlaceholder": "Enter your email",
  "footer.subscribe": "Subscribe",
  /*
    Interpolated rather than concatenated. Building "© " + year + " Frenz…" in
    JSX assumes the year sits in the middle of the sentence, which is not true in
    every language — and the fix once a translator points it out is a rewrite of
    the component rather than of the string.

    The copy is migrated verbatim from what the footer already rendered. Moving a
    string into the catalogue is a refactor; changing what it says is a content
    decision, and doing both in one pass is how copy changes ship unreviewed.
  */
  "footer.copyright":
    "© {year} Frenz. Please respect platform terms and copyright. Download only content you have the right to save.",
  "footer.builtWith": "Built with precision & care.",

} as const;

/**
 * The shape every locale must satisfy.
 *
 * Deliberately `Record<MessageKey, string>` rather than `typeof en`: a
 * translation must supply a STRING for each key, not the identical English
 * literal, which is what `typeof en` would demand.
 */
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[];
