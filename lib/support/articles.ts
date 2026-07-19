import type { SupportArticle, SupportSection } from "./types";

/**
 * Support & Trust articles — the shared corpus behind both centres.
 *
 * ── Everything here was verified before it was written ────────────────────────
 *
 * Trust content has a failure mode worse than being unhelpful: describing a
 * protection that does not exist tells someone they are safe when they are not.
 * So every control named below was checked in the codebase first —
 * `/account/security` (passkeys, 2FA, devices, activity), `/account/privacy`,
 * `/account/appeals`, `/api/account/export`, `/api/account/delete` (30-day
 * cancellable grace period), and the block/restrict/report tools.
 *
 * If a control is not in the product, it is not in this file. The Reality Ledger
 * scans this directory for the same reason it scans the lesson corpus.
 *
 * ── Articles explain; policies govern ─────────────────────────────────────────
 *
 * Where an article summarises a formal document it carries `policyHref` and links
 * out. The plain-language version is a reading aid, never a replacement — and
 * presenting a summary as the authoritative text would be its own dishonesty,
 * which is why the link is structural rather than a convention.
 */
export const SUPPORT_ARTICLES: SupportArticle[] = [
  /* --------------------------------- security -------------------------------- */
  {
    slug: "how-your-account-is-protected",
    title: "How your account is protected",
    description:
      "The layers that stand between your account and someone else — sign-in, passkeys, two-factor, and step-up checks on sensitive actions.",
    section: "security",
    summary:
      "Your account is protected by how you sign in, an optional second factor, and extra checks before sensitive actions. You can review all of it in Security settings.",
    blocks: [
      {
        heading: "Signing in",
        body: [
          "Sign-in is passwordless: you receive a one-time code by email rather than keeping a password that can be reused or leaked. There is no password to steal, guess or reuse from another site — which is where most account compromises actually begin.",
          "The trade-off is that your email account becomes the key to this one. Securing your email with its own strong protection is the single highest-value thing you can do for this account.",
        ],
      },
      {
        heading: "Passkeys",
        body: [
          "A passkey ties sign-in to a device you already unlock — with a fingerprint, a face, or a device PIN. The secret never leaves your device and there is nothing transferable for a phishing site to capture.",
          "Passkeys are added in Security settings. You can register more than one, and having a second is worth doing: it is what stops a lost phone from becoming a lockout.",
        ],
      },
      {
        heading: "Step-up checks",
        body: [
          "Some actions ask you to confirm who you are again even though you are already signed in — changing security settings, or acting on sensitive data.",
          "This exists because the realistic threat is not someone breaking your sign-in, it is someone reaching an already-unlocked session on a device you walked away from. A step-up check limits what that person can do.",
        ],
      },
      {
        heading: "Recovery codes",
        body: [
          "Recovery codes are single-use fallbacks for when you cannot use your normal method. Each one works once.",
          "Store them somewhere that does not depend on the account they recover — not in the email inbox you sign in with, and not only on the phone you would be trying to replace. A printed copy is genuinely reasonable here.",
        ],
      },
    ],
    faqs: [
      {
        q: "I lost my phone. Can I still get in?",
        a: "Yes, if you set up either a second passkey or recovery codes beforehand. Both are in Security settings, and both need to be arranged before you need them.",
      },
      {
        q: "Do I need both a passkey and two-factor?",
        a: "A passkey already proves possession of a device you unlocked, so it covers most of what a second factor adds. Having a recovery path matters more than stacking methods.",
      },
    ],
    related: ["who-can-see-what-you-share", "reporting-blocking-and-appeals"],
  },
  {
    slug: "reporting-a-security-problem",
    title: "Reporting a security problem",
    description:
      "How to report a vulnerability, what happens next, and what we ask researchers to avoid while testing.",
    section: "security",
    summary:
      "Email security reports to us with enough detail to reproduce the issue. Please do not access other people's data while testing.",
    blocks: [
      {
        heading: "How to report",
        body: [
          "Send the report through the contact page and mark it as a security issue. Include what you found, the steps to reproduce it, and what an attacker could achieve with it.",
          "Reproduction steps matter more than severity claims. A report that can be reproduced gets fixed; one that cannot be usually stalls in clarification.",
        ],
      },
      {
        heading: "What we ask of researchers",
        body: [
          "Test against your own account. Do not access, modify or store other people's data, and do not run tests that degrade the service for other users.",
          "If you do incidentally encounter someone else's data, stop, and say so in the report. That is treated as good-faith disclosure rather than a problem.",
          "Give us a reasonable window to fix an issue before publishing it.",
        ],
      },
      {
        heading: "What happens next",
        body: [
          "Reports are acknowledged, reproduced, and fixed in order of real-world impact rather than reported severity.",
          "Frenzsave is operated by a small team. We would rather tell you that plainly than advertise response targets we cannot consistently meet — an unmet commitment is worse than an honest one.",
        ],
      },
    ],
    related: ["how-your-account-is-protected"],
  },

  /* --------------------------------- privacy --------------------------------- */
  {
    slug: "who-can-see-what-you-share",
    title: "Who can see what you share",
    description:
      "What is public by default, what each sharing surface actually reaches, and how to check rather than assume.",
    section: "privacy",
    summary:
      "New accounts are public. Posts reach the widest audience, stories a chosen one, chat only its participants. Check by viewing your profile signed out.",
    blocks: [
      {
        heading: "Public by default",
        body: [
          "A new account is public: the profile and anything posted publicly can be seen by anyone, including people who are not signed in and search engines.",
          "That is the correct default for a service people arrive at from search, but it is worth knowing rather than discovering later.",
        ],
      },
      {
        heading: "Reach, narrowest to widest",
        body: [
          "A chat message reaches only the people in that conversation. A story reaches your chosen story audience and expires. A post or reel reaches the widest audience and stays.",
          "Expiry limits how long something is shown. It does not limit who captured it while it was up, and it cannot un-share something already seen.",
        ],
      },
      {
        heading: "Hiding your account",
        body: [
          "Hiding narrows your account's reach to friends. It is a visibility control, not a deactivation: you keep posting, and friends see everything as before.",
          "It is tracked separately from account suspension, which is an enforcement action. One is a choice you make; the other is a decision about your account.",
        ],
      },
      {
        heading: "Verify from outside",
        body: [
          "Open your profile in a private window while signed out. That is what the public actually sees.",
          "Do this after changing any visibility setting. Settings tell you what you asked for; the signed-out view tells you what happened.",
        ],
      },
    ],
    related: ["your-data-and-how-to-take-it-with-you", "reporting-blocking-and-appeals"],
    policyHref: "/privacy",
  },
  {
    slug: "your-data-and-how-to-take-it-with-you",
    title: "Your data, and how to take it with you",
    description:
      "Exporting a copy of your data, deleting your account, and what the 30-day grace period actually means.",
    section: "privacy",
    summary:
      "You can download your data as a file at any time. Deleting your account starts a 30-day countdown you can cancel; after that it is permanent.",
    blocks: [
      {
        heading: "Exporting your data",
        body: [
          "Privacy settings include a download of your data as a single file. It is generated on request and downloads through your browser.",
          "There is no waiting period and no reason to ask before doing it. Taking a copy is a reasonable thing to do periodically, not a signal that you are leaving.",
        ],
      },
      {
        heading: "Deleting your account",
        body: [
          "Deletion is requested from Privacy settings and starts a 30-day period before anything is permanently removed. During that window you can cancel and the account continues as normal.",
          "The delay exists because deletion is the one action with no undo. An account deleted in frustration at midnight is frequently regretted, and a countdown costs nothing while preventing exactly that.",
          "After the window, the account and its content are permanently deleted. At that point we cannot restore it, and neither can you.",
        ],
        steps: [
          {
            title: "Export first",
            text: "Download your data before requesting deletion. Once the window closes there is nothing left to export.",
          },
          {
            title: "Request deletion",
            text: "Privacy settings shows the exact date your account will be removed.",
          },
          {
            title: "Cancel any time inside the window",
            text: "Cancelling restores the account fully. Nothing is lost by starting the process and changing your mind.",
          },
        ],
      },
    ],
    faqs: [
      {
        q: "Can I get my account back after the 30 days?",
        a: "No. That is what makes the grace period important — it is the entire window in which the decision is reversible.",
      },
      {
        q: "Does deleting remove things other people saved?",
        a: "It removes your account and its content from Frenzsave. It cannot reach copies other people already downloaded or screenshotted, here or anywhere.",
      },
    ],
    related: ["who-can-see-what-you-share"],
    policyHref: "/privacy",
  },

  /* ---------------------------------- safety --------------------------------- */
  {
    slug: "reporting-blocking-and-appeals",
    title: "Reporting, blocking and appeals",
    description:
      "Three tools for three different problems, plus what to do if you think a decision about your account was wrong.",
    section: "safety",
    summary:
      "Block to stop contact. Restrict to reduce reach quietly. Report to involve moderation. If a decision about your account seems wrong, appeal it.",
    blocks: [
      {
        heading: "Block, restrict, report",
        body: [
          "Blocking severs the connection both ways. It is the strongest option and it tends to become obvious to the other person through its effects.",
          "Restricting quietly narrows what someone can do without severing anything. It is the right tool when a situation is awkward rather than dangerous, and when escalating would make it worse.",
          "Reporting is the only one that involves anyone else. Blocking and restricting change your experience; reporting asks for a decision about whether something breaks the rules.",
        ],
      },
      {
        heading: "Choosing quickly",
        body: [
          "If you feel unsafe: block first, then report. Stopping contact takes priority; the report can follow.",
          "If it is uncomfortable but not threatening: restrict, and see whether that settles it.",
          "If it does not involve you but breaks the rules: report it and leave your own connections alone.",
        ],
      },
      {
        heading: "Appeals",
        body: [
          "If content was removed or your account was restricted and you believe that was wrong, you can appeal from your account's appeals page.",
          "An appeal is most useful when it adds context a reviewer could not have had. Explaining what the content actually was, or why it was misread, is far more effective than restating that the decision was wrong.",
        ],
      },
    ],
    faqs: [
      {
        q: "Will someone know I reported or blocked them?",
        a: "No notification is sent for any of these. Blocking often becomes evident through its effects; restricting generally does not.",
      },
      {
        q: "How long does an appeal take?",
        a: "Appeals are reviewed by people, and Frenzsave is run by a small team, so it is not instant. We would rather say that than publish a target we cannot consistently meet.",
      },
    ],
    related: ["who-can-see-what-you-share", "how-your-account-is-protected"],
  },
  {
    slug: "what-you-can-and-cannot-save",
    title: "What you can and cannot save",
    description:
      "The boundary the downloader enforces, why private content cannot be retrieved, and what saving a file does and does not permit.",
    section: "safety",
    summary:
      "Only public posts can be saved. Private, follower-only, deleted and expired content cannot be retrieved by any means. Saving a file does not grant you rights to republish it.",
    blocks: [
      {
        heading: "Public only, and that is a boundary not a limitation",
        body: [
          "Frenzsave can retrieve a post if it is publicly visible. Private accounts, follower-only posts, age-gated content, deleted posts and expired stories cannot be retrieved.",
          "That is a permission boundary rather than a technical shortcoming, and no setting, tool or workaround changes it. Any service claiming otherwise is either failing or doing something you should not want to be part of.",
        ],
      },
      {
        heading: "Saving is not licensing",
        body: [
          "Being able to save a file does not transfer any rights in it. The person who made it still owns it.",
          "Personal use — watching offline, keeping a copy of something you were part of — is generally uncontroversial. Republishing someone else's work as your own is not, regardless of how the file reached you.",
          "If you plan to publish something you did not make, credit is the minimum and permission is the safer answer.",
        ],
      },
    ],
    related: ["reporting-blocking-and-appeals"],
    policyHref: "/dmca",
  },

  /* ------------------------------- transparency ------------------------------ */
  {
    slug: "how-frenzsave-is-built-and-operated",
    title: "How Frenzsave is built and operated",
    description:
      "Who runs this, what that means for support and response times, and how we decide what to say about reliability.",
    section: "transparency",
    summary:
      "Frenzsave is run by a small team. We publish what we actually measure and nothing else, which is why some things you might expect to see here are absent.",
    blocks: [
      {
        heading: "Who operates it",
        body: [
          "Frenzsave is built and operated by a small team rather than a large company with a staffed operations rota.",
          "That shapes what you can reasonably expect: fixes and replies come, but not on an enterprise support clock. Stating that plainly seems better than implying a scale of operation that does not exist.",
        ],
      },
      {
        heading: "What we publish, and what we do not",
        body: [
          "This section carries what we genuinely measure. Where we do not measure something, there is no page for it rather than a page with confident-looking placeholders.",
          "That is a deliberate choice and it has a visible cost — a live status dashboard with uptime percentages is a thing visitors expect from a trust centre. Publishing one that reported 'all systems operational' without monitoring behind it would be a fabricated reassurance, and reassurance is precisely the thing a trust centre must not fake.",
          "If and when real monitoring is in place, a status page will appear here with real numbers behind it.",
        ],
      },
      {
        heading: "Products that do not exist yet",
        body: [
          "Some parts of Frenzsave are described on this site as planned rather than available, and are labelled that way wherever they appear.",
          "This is enforced in code rather than left to editorial care: unbuilt products cannot be described in the present tense, cannot be linked to as working features, and cannot be published as structured data for search engines.",
        ],
      },
    ],
    related: ["how-your-account-is-protected", "what-you-can-and-cannot-save"],
  },
];

/* ----------------------------------- reads ----------------------------------- */

const BY_SLUG = new Map(SUPPORT_ARTICLES.map((a) => [a.slug, a]));

export const SUPPORT_SLUGS: string[] = SUPPORT_ARTICLES.map((a) => a.slug);

export function getArticle(slug: string): SupportArticle | undefined {
  return BY_SLUG.get(slug);
}

export function articlesInSection(section: SupportSection): SupportArticle[] {
  return SUPPORT_ARTICLES.filter((a) => a.section === section);
}

export function relatedArticles(slug: string): SupportArticle[] {
  const article = BY_SLUG.get(slug);
  if (!article) return [];
  return article.related
    .map((s) => BY_SLUG.get(s))
    .filter((a): a is SupportArticle => Boolean(a));
}
