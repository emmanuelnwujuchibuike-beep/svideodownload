import { centreOf } from "./sections";
import { HELP_SECTIONS, TRUST_SECTIONS, type SupportArticle, type SupportSection } from "./types";

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

  /* ------------------------------ getting started ----------------------------- */
  {
    slug: "saving-your-first-video",
    title: "Saving your first video",
    description:
      "Paste a link, pick a format and quality, and save the file — the whole flow, including what the Video, Audio and Photo tabs do.",
    section: "getting-started",
    summary:
      "Copy the share link from the app you are in, paste it into the box on the home page, then choose a format and quality. No account is needed for this.",
    blocks: [
      {
        heading: "The whole flow",
        body: [
          "Downloading does not need an account, an extension or an install. The box on the home page is the entire tool.",
        ],
        steps: [
          {
            title: "Copy the share link",
            text: "In TikTok, Instagram or wherever the video lives, use that app's own Share or Copy link action. The link in your browser's address bar works too. What does not work is a screenshot or the video's on-screen title — it has to be a link.",
          },
          {
            title: "Paste it into the box",
            text: "Paste and the page fetches the video's details. You get a preview with the thumbnail and title, so you can confirm it found the right thing before committing to a download.",
          },
          {
            title: "Choose a format",
            text: "Video is selected by default. Audio extracts the sound as a separate file, which is what you want for music or a podcast clip. Photo appears when the link is a photo post or carousel rather than a video.",
          },
          {
            title: "Pick a quality and save",
            text: "Each option lists its resolution and file size before you commit, so a 4K file cannot surprise you on a metered connection. Choosing one saves it through your browser's normal download.",
          },
        ],
      },
      {
        heading: "Where the file actually goes",
        body: [
          "The file lands wherever your browser puts downloads — the Downloads folder on a computer, Files or Photos on a phone, depending on the browser and the format. Frenz does not choose the destination and cannot move it afterwards; that is the browser's decision, and it is the same one it makes for every other download.",
          "On iPhone, Safari saves to Files rather than the Photos app. Saving a video into Photos is a second step: open it in Files and use Share, then Save Video.",
        ],
      },
      {
        heading: "Watermarks",
        body: [
          "Where a platform offers a clean source, we fetch that one — TikTok, Instagram, X and Threads all do, which is four of the eleven platforms supported.",
          "The other seven do not publish a watermark-free source, so their videos arrive exactly as that platform encodes them, overlay included. No tool can remove a watermark that is burned into the picture without damaging the picture, and we would rather say so than imply otherwise.",
        ],
      },
    ],
    faqs: [
      {
        q: "Do I need an account to download?",
        a: "No. Downloading works signed out and always has. An account exists for the social side of Frenz — a profile, saved collections, messaging — not to unlock the downloader.",
      },
      {
        q: "Can I download a private video?",
        a: "No. If a post is private, or restricted to followers, or needs a sign-in to view, we cannot reach it either — we only see what an ordinary visitor sees.",
      },
      {
        q: "Why does the top quality ask me to watch an ad?",
        a: "The highest-resolution video and photo downloads are the expensive ones to serve, and ads are what keep the tool free. Pro removes them entirely.",
      },
    ],
    related: ["when-a-link-will-not-download", "what-an-account-adds", "what-you-can-and-cannot-save"],
  },
  {
    slug: "what-an-account-adds",
    title: "What an account adds",
    description:
      "Downloading works signed out. Here is what signing in is actually for, and how sign-in works without a password.",
    section: "getting-started",
    summary:
      "An account is optional and does not unlock the downloader. It adds the social side — a profile, saved collections, friends and messaging — and it syncs across your devices.",
    blocks: [
      {
        heading: "Signing in without a password",
        body: [
          "There is no password to create. You enter your email address, we send a one-time code, and entering that code signs you in.",
          "This means there is no password to be reused from another site, leaked in someone else's breach, or guessed — which is where most account compromises actually start. The trade-off is that your email account becomes the key to this one, so it is worth protecting properly.",
        ],
      },
      {
        heading: "What you get",
        body: [
          "A profile, so what you save and publish has somewhere to live. Saved collections that follow you between your phone and your computer instead of living in one browser. Friends, messaging, Stories and Reels. Notifications for the things you asked to be notified about.",
          "None of this changes the downloader. Signed in or signed out, the paste-a-link flow is identical.",
        ],
      },
      {
        heading: "Free, Pro and Business",
        body: [
          "Free is the whole product, supported by ads, up to 30 downloads a day. Pro removes the ads — including the short one in front of top-quality and photo downloads — and adds priority and batch downloads on a much higher daily allowance. Business adds full REST API access on top.",
          "A plan is separate from an account: you can hold an account forever without paying for anything, and most people do.",
        ],
      },
    ],
    faqs: [
      {
        q: "The sign-in code has not arrived.",
        a: "Check the spam folder first — one-time codes land there more often than anything else. Codes also expire, so if several minutes have passed, request a fresh one rather than entering the old one.",
      },
      {
        q: "Can I delete my account later?",
        a: "Yes, from privacy settings, and deletion has a 30-day grace period you can cancel within. The privacy article on taking your data with you covers what is removed and what a copy contains.",
      },
    ],
    related: [
      "saving-your-first-video",
      "how-your-account-is-protected",
      "your-data-and-how-to-take-it-with-you",
    ],
  },
  {
    slug: "installing-frenzsave-on-your-phone",
    title: "Installing Frenz on your phone",
    description:
      "Frenz installs from the browser rather than an app store — how to add it to your home screen on iPhone and Android, and what changes once you do.",
    section: "getting-started",
    summary:
      "There is no app store download. Add Frenz to your home screen from your browser and it opens full-screen like an installed app, using the copy already in your browser.",
    blocks: [
      {
        heading: "Why there is no app store listing",
        body: [
          "Frenz is a web app. It installs from the page you are already on, which means no store account, no review queue between a fix and you having it, and no several-hundred-megabyte download.",
          "The practical difference once installed is small and mostly good: it opens in its own window with no browser chrome, and it keeps working on a bad connection for anything it has already cached.",
        ],
      },
      {
        heading: "On iPhone and iPad",
        body: [
          "Installing is only possible from Safari on iOS — Chrome and Firefox on iPhone cannot add to the home screen, which is an Apple restriction rather than a Frenz one.",
        ],
        steps: [
          { title: "Open frenzsave.com in Safari", text: "Any page will do; the home page is fine." },
          {
            title: "Tap Share",
            text: "The square with an arrow coming out of it, in the toolbar at the bottom of the screen.",
          },
          {
            title: "Choose Add to Home Screen",
            text: "It sits partway down the share sheet, below the row of apps. Then tap Add.",
          },
        ],
      },
      {
        heading: "On Android",
        body: [
          "Chrome usually offers to install Frenz by itself after a visit or two. If you would rather not wait for the prompt, open the three-dot menu and choose Install app, or Add to Home screen on older versions.",
        ],
      },
      {
        heading: "What changes once installed",
        body: [
          "You can share a link straight into Frenz from another app's share sheet, instead of copying it and switching over by hand.",
          "Pages you have already opened stay available offline. A download itself still needs a connection — the video has to come from somewhere.",
        ],
      },
    ],
    faqs: [
      {
        q: "Is a real App Store or Play Store app coming?",
        a: "It is on the roadmap and not shipped. Until it is, this page describes the only install that exists — we would rather say that than list a store link that goes nowhere.",
      },
      {
        q: "Will installing use up my storage?",
        a: "Barely. It reuses the copy your browser already has rather than downloading a separate application. The files you save take up space; the app itself is negligible.",
      },
    ],
    related: ["saving-your-first-video", "what-an-account-adds"],
  },

  /* ------------------------------- troubleshooting ---------------------------- */
  {
    slug: "when-a-link-will-not-download",
    title: "When a link will not download",
    description:
      "The handful of reasons a paste fails — private and region-locked posts, removed videos, unsupported links and rate limits — and which of them you can do something about.",
    section: "troubleshooting",
    summary:
      "Most failures are the post being unreachable rather than anything wrong on your side: private, region-locked, removed, or needing a sign-in. Check the link opens in a private browser window first — that is the same view we get.",
    blocks: [
      {
        heading: "The test that settles it in ten seconds",
        body: [
          "Open the link in a private or incognito browser window, signed out. That is exactly the view Frenz has of the post.",
          "If it does not load for you there, no downloader can reach it either. That single check separates 'this post is not public' from 'something is broken', and they need completely different responses.",
        ],
      },
      {
        heading: "It may be private, region-locked, removed, or need a sign-in",
        body: [
          "This is the most common failure, and it is the one the error message names. Private accounts, followers-only posts, videos pulled down since you saw them, age-restricted content and anything geo-blocked in the region our servers sit in all land here.",
          "There is no workaround for it and you should be suspicious of any tool claiming one — reaching a private post would mean using someone's credentials.",
        ],
      },
      {
        heading: "The link might not be the right link",
        body: [
          "It has to be a link to a specific post. A profile link, a search page, a hashtag page or the app's home feed has no single video to fetch.",
          "Shortened share links are fine and resolve on our side. Text pasted around the link is fine too. What does not work is a link to a platform we do not support — there are eleven, listed on the home page.",
        ],
      },
      {
        heading: "\"Too many requests\"",
        body: [
          "There is a rate limit, and pasting many links in quick succession trips it. It is per-visitor and it clears on its own within a short wait — nothing is blocked or flagged against you.",
          "Refreshing repeatedly makes it worse rather than better, because each attempt counts. Waiting a minute is genuinely the fix.",
        ],
      },
      {
        heading: "\"Temporarily unavailable\"",
        body: [
          "This one is ours, not yours. It means the extraction service did not answer, and retrying in a few minutes is the right move.",
          "Platforms also change how their pages are built without warning, which can break extraction for one platform while every other one keeps working. If a single platform fails consistently for a day while others are fine, that is worth reporting through the contact page.",
        ],
      },
    ],
    faqs: [
      {
        q: "It works on my computer but not my phone.",
        a: "Almost always the link. Some apps' share sheets copy a tracking or preview link rather than the post link — try Copy link rather than Share, or open the post in a browser and copy from the address bar.",
      },
      {
        q: "Can I download a video that has been deleted?",
        a: "No. We fetch it live from the platform at the moment you paste, so once it is gone there is nothing to fetch. Nothing is kept on our side from anyone else's earlier download.",
      },
    ],
    related: [
      "download-quality-and-playback-problems",
      "saving-your-first-video",
      "what-you-can-and-cannot-save",
    ],
  },
  {
    slug: "download-quality-and-playback-problems",
    title: "Quality, file size and playback problems",
    description:
      "Why the resolution you expected may not be offered, what the ad before a top-quality download is for, and what to do when a saved file will not play.",
    section: "troubleshooting",
    summary:
      "The quality list shows what the source actually has — if 4K is not there, the original is not 4K. A file that will not play is usually a player that does not know the format rather than a broken download.",
    blocks: [
      {
        heading: "The quality you want is not listed",
        body: [
          "The list is not a menu of what we could produce; it is what the platform published. If the highest option is 720p, the upload was 720p, and no download can add detail that was never recorded.",
          "Platforms also re-encode aggressively. A video shot in 4K and posted to a social app is often stored at a fraction of that, and what you can save is the stored copy rather than the camera original.",
        ],
      },
      {
        heading: "The short ad before high-quality and photo downloads",
        body: [
          "Top-resolution video and photo downloads show a short ad first. Those are the heaviest requests to serve, and ads are what pay for the free tier existing at all.",
          "Pro removes it. So does choosing a lower resolution, which is often genuinely the better call for a clip going straight to a phone screen.",
        ],
      },
      {
        heading: "The file downloaded but will not play",
        body: [
          "Try it in VLC before assuming the file is damaged. Some phone galleries and older players refuse formats they do not recognise even when the file is perfectly intact, and a file that plays in VLC is a player problem, not a download problem.",
          "An audio download that plays with no picture is working as intended — the Audio tab extracts sound only. If you wanted the video, download it again from the Video tab.",
        ],
      },
      {
        heading: "The download stopped partway",
        body: [
          "Interrupted downloads are almost always the connection dropping mid-transfer, and a partial file will not play. Delete it and start again rather than trying to resume it.",
          "Large 4K files on a mobile connection are the usual casualty. If it keeps failing on the same video, taking one step down in resolution generally succeeds.",
        ],
      },
    ],
    faqs: [
      {
        q: "The saved video has no sound.",
        a: "Check that you used the Video tab rather than Audio, and that your player is not muted. If it is genuinely silent, try a different quality option — some platforms publish certain renditions as picture-only — and report it through the contact page if none of them carry sound.",
      },
      {
        q: "Why is the file so much larger than the video looked?",
        a: "Higher resolutions carry a lot more data than the on-screen size suggests, particularly for anything with motion. Each option shows its size before you commit, so you can pick the trade-off rather than discover it afterwards.",
      },
    ],
    related: ["when-a-link-will-not-download", "saving-your-first-video"],
  },
];

/* ----------------------------------- reads ----------------------------------- */

const BY_SLUG = new Map(SUPPORT_ARTICLES.map((a) => [a.slug, a]));

export const SUPPORT_SLUGS: string[] = SUPPORT_ARTICLES.map((a) => a.slug);

/**
 * The one place an article's URL is decided.
 *
 * One corpus feeds two centres, so an article's route follows from its SECTION —
 * and that derivation has to live in exactly one function. When it did not, every
 * consumer assumed `/trust/<slug>`: the article route generated static params for
 * the whole corpus, the sitemap listed every slug under /trust, and the search
 * index built /trust hrefs. Adding the first Help Center article to that would
 * have published it at two canonical URLs at once — the same conflict the Academy
 * hit when courses inherited their school's href, where search engines pick one,
 * ranking splits, and the loser disappears. Invisible in the UI, too: both URLs
 * render a perfectly good page.
 *
 * `support.test.ts` pins it — every article resolves to exactly one centre, and
 * neither route may generate params belonging to the other.
 */
export function articleHref(article: SupportArticle): string {
  return `${centreOf(article.section).href}/${article.slug}`;
}

/** Articles rendered under /trust, in corpus order. */
export const TRUST_ARTICLES: SupportArticle[] = SUPPORT_ARTICLES.filter((a) =>
  TRUST_SECTIONS.includes(a.section),
);

/** Articles rendered under /help, in corpus order. */
export const HELP_ARTICLES: SupportArticle[] = SUPPORT_ARTICLES.filter((a) =>
  HELP_SECTIONS.includes(a.section),
);

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
