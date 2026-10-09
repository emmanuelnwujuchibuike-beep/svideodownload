/**
 * The Frenzsave Advertising Rules — shown on /advertise/rules and inline in
 * the application, and agreed to with an unticked checkbox before an
 * application can go to payment.
 *
 * VERSIONED: the server records the version an advertiser accepted
 * (ad_campaigns.rules_version, 0196) and refuses a submission made against an
 * older one. Change a rule ⇒ bump ADVERTISING_RULES_VERSION, and every
 * advertiser sees and accepts the new text before their next payment.
 */

export const ADVERTISING_RULES_VERSION = "2026-10-07";

export const RULES_CHECKBOX_TEXT =
  "I have read and agree to the Frenzsave Advertising Rules. I confirm that my advertisement and destination URL do not contain scams, malicious links, phishing, deceptive content, privacy violations, or prohibited material.";

export const AUTOMATED_VALIDATION_NOTICE =
  "After successful payment, your campaign can go live immediately if it passes our automated validation and safety checks.";

export interface RuleSection {
  id: string;
  title: string;
  intro: string;
  items: string[];
}

export const ADVERTISING_RULES: readonly RuleSection[] = [
  {
    id: "privacy",
    title: "Privacy",
    intro: "Advertisements and landing pages must never be designed to collect what is not theirs to take. You may not use an advertisement or a landing page to steal:",
    items: ["Passwords or login credentials", "Personal information", "Financial information, card or bank details", "Authentication or one-time codes"],
  },
  {
    id: "scams",
    title: "Scams and fraud",
    intro: "Frenzsave does not accept:",
    items: ["Fraudulent offers", "Fake investment opportunities", "Impersonation of a person, brand or organisation", "Phishing", "Fake giveaways", "Deceptive financial claims", "Fraudulent services"],
  },
  {
    id: "malicious",
    title: "Malicious links",
    intro: "Your destination URL and anything it leads to must not contain:",
    items: ["Malware or spyware", "Phishing pages", "Malicious or unwanted downloads", "Harmful or deceptive redirects", "Exploit attempts"],
  },
  {
    id: "misleading",
    title: "Misleading advertising",
    intro: "Advertisements must be honest. They must not include:",
    items: ["Fake claims or false promises", "Fake testimonials", "Deceptive pricing", "Fake urgency or countdowns", "Misleading buttons, such as fake play, close or download buttons"],
  },
  {
    id: "illegal",
    title: "Harmful and illegal content",
    intro: "No content that is prohibited by applicable law or by Frenzsave policy.",
    items: [],
  },
  {
    id: "safety",
    title: "User safety",
    intro: "Advertisements must not try to trick people into:",
    items: ["Clicking unintentionally", "Downloading unwanted software", "Disabling security controls", "Revealing sensitive information"],
  },
  {
    id: "responsibility",
    title: "Advertiser responsibility",
    intro: "You are responsible for:",
    items: ["The creative you submit", "Your destination URL and everything it leads to", "Every claim your advertisement makes", "Complying with the law where your advertisement is shown"],
  },
  {
    id: "enforcement",
    title: "Frenzsave enforcement",
    intro: "Frenzsave may, at any time, pause, remove, reject, restrict or suspend an advertisement or an advertiser that breaks these rules.",
    items: [],
  },
];

/**
 * How Frenzsave counts (Part 8, 2026-10-09). A POLICY explanation, not a rule an
 * advertiser accepts - so it does not bump ADVERTISING_RULES_VERSION. It states
 * what each figure means and that invalid traffic is filtered, without naming
 * the detection signals or thresholds (that would teach evasion).
 */
export const TRAFFIC_QUALITY_POLICY: readonly { term: string; meaning: string }[] = [
  { term: "View (impression)", meaning: "At least half of your ad was on screen for one continuous second, in a tab the person was looking at. A loaded but unseen ad, a preview, or a failed image or video is not a view." },
  { term: "Click", meaning: "Someone opened your ad's details after seeing it. Repeated clicks by the same person on the same campaign are capped each day, and a click without a view first does not count." },
  { term: "CTR", meaning: "Clicks divided by views. Shown as \u201c—\u201d until there is at least one view." },
  { term: "Watched to the end", meaning: "A video that played its full length, checked against its length and the time it started." },
  { term: "Site visits", meaning: "People who continued to your website after our external-link warning." },
  { term: "Spend", meaning: "Payments confirmed by our payment partner. Refunds and chargebacks are shown separately and are never counted as spend." },
];

export const TRAFFIC_QUALITY_NOTE =
  "We filter invalid traffic - automated visits, repeated or accidental activity, traffic from inside Frenzsave and your own views - so it is never counted in your figures. Your dashboard shows how many views and clicks were filtered. We cannot promise that every view or click is from a genuine, interested person, and figures may be adjusted when an investigation finds invalid activity. We never share the people behind your views, and we do not publish how our checks work.";
