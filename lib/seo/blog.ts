export interface BlogSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO
  /** ISO date of the last real edit (Article JSON-LD `dateModified`). Absent → never edited since `date`. */
  updated?: string;
  readingMinutes: number;
  /** Related downloader slug for an internal CTA. */
  toolSlug?: string;
  body: BlogSection[];
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "how-to-save-and-archive-your-own-tiktok-videos",
    title: "How to Save and Archive Your Own TikTok Videos (2026)",
    description:
      "A step-by-step guide to backing up your own TikToks in original quality on iPhone, Android and PC — with no app to install — and keeping a tidy archive.",
    date: "2026-06-10",
    updated: "2026-10-29",
    readingMinutes: 4,
    toolSlug: "tiktok-video-downloader",
    body: [
      {
        paragraphs: [
          "Your TikToks are your work, and the app is not a backup. Accounts get locked, phones get lost, and a reinstall can take drafts with it. Keeping your own copies means your videos outlive any of that.",
          "This guide shows the fastest way to save your own TikToks in original quality on every device, how to keep an archive you can actually find things in, and what to keep in mind when a video isn't yours.",
        ],
      },
      {
        heading: "The fastest way (iPhone, Android & PC)",
        paragraphs: [
          "You don't need a desktop program or an app from an app store. A browser-based downloader does everything online:",
        ],
        bullets: [
          "Open TikTok, find your video, tap Share, then tap Copy link.",
          "Open our TikTok video downloader and paste the link.",
          "Tap Download and choose HD video (or MP3 for just the audio).",
          "The original-quality file saves straight to your device.",
        ],
      },
      {
        heading: "TikTok's own data download",
        paragraphs: [
          "TikTok also lets you request a copy of your account data from its settings, under Account. It is a useful record of your account, but it arrives as a large archive after a wait — saving a video by its link is quicker when you want the file itself, today.",
        ],
      },
      {
        heading: "Keep an archive you can find things in",
        bullets: [
          "Name files by date and topic (for example 2026-06-10-pasta-recipe.mp4) so they sort in the order you posted them.",
          "Keep two copies: one on your device and one in cloud storage or on an external drive.",
          "Save the caption in a text file next to the video, so the context isn't lost.",
        ],
      },
      {
        heading: "Offline viewing and accessibility",
        paragraphs: [
          "A saved file plays in any video player, so you can watch it on a flight or a weak connection, slow it down, or turn on your phone's live captions — things the app doesn't always make easy.",
        ],
      },
      {
        heading: "Is it safe and legal?",
        paragraphs: [
          "The tool itself is safe: there's no login to compromise, files aren't stored, and transfers are encrypted. Legally, you're responsible for only saving content you own or have permission to use, and for respecting TikTok's terms and the creator's rights. If a video isn't yours, ask the creator before saving it, and never re-upload someone else's work as your own.",
        ],
      },
    ],
  },
  {
    slug: "best-instagram-reels-downloader-methods",
    title: "The Best Instagram Reels Downloader Methods in 2026",
    description:
      "Compare the easiest ways to save Instagram Reels in HD — browser tools, mobile shortcuts and more — plus what to avoid.",
    date: "2026-06-12",
    updated: "2026-10-29",
    readingMinutes: 5,
    toolSlug: "instagram-reels-downloader",
    body: [
      {
        paragraphs: [
          "Instagram doesn't offer a download button for most Reels, so backing up your own or keeping one to watch offline takes a tool. Here are the methods that actually work in 2026 — and the ones to skip.",
        ],
      },
      {
        heading: "1. Browser-based downloader (recommended)",
        paragraphs: [
          "The simplest, safest option needs no install and no login. Copy the Reel's link from the share menu, paste it into our Instagram Reels downloader, and save the HD MP4 (or extract MP3 audio). It works identically on iPhone, Android and desktop.",
        ],
      },
      {
        heading: "2. Mobile shortcuts",
        paragraphs: [
          "On iPhone, Shortcuts can automate downloads, but they break whenever Instagram changes its API and often require fiddly setup. A web tool that's maintained for you is more reliable for most people.",
        ],
      },
      {
        heading: "What to avoid",
        bullets: [
          "Apps that demand your Instagram username and password — never hand those over.",
          "Tools that bury the file behind multiple redirects and ads.",
          "Anything promising to download private accounts — that's not legitimate.",
        ],
      },
      {
        heading: "Quality tips",
        paragraphs: [
          "Always pick the highest available resolution so your saved Reel isn't a blurry re-encode. If you only need the audio (a talk or a tutorial you'd rather listen to, for example), choose the MP3 option to save space.",
        ],
      },
    ],
  },
  {
    slug: "safe-video-downloading-guide-2026",
    title: "The Safe Video Downloading Guide (2026)",
    description:
      "How to download videos safely in 2026 — avoid malware and scams, protect your privacy, and stay on the right side of copyright.",
    date: "2026-06-15",
    readingMinutes: 6,
    body: [
      {
        paragraphs: [
          "Downloading videos is easy — doing it safely takes a little awareness. This guide covers how to avoid malware, protect your privacy, and respect copyright, so you can save the clips you want without the risks.",
        ],
      },
      {
        heading: "Avoid malware and scams",
        bullets: [
          "Never install random .exe or .apk files from a 'downloader' site — a real web tool runs in your browser.",
          "Be wary of fake Download buttons and pop-ups; they're usually ads or malware.",
          "Stick to tools that download over HTTPS and don't ask for unnecessary permissions.",
        ],
      },
      {
        heading: "Protect your privacy",
        paragraphs: [
          "You should never need to log into your social accounts to download public videos. Any tool asking for your Instagram, TikTok or Facebook password is a red flag. The safest tools store nothing — your links and files aren't kept after the download finishes.",
        ],
      },
      {
        heading: "Respect copyright",
        paragraphs: [
          "A download tool is legal, but how you use it matters. Download content you created, own, or have permission to use. Don't re-upload other people's videos as your own or use copyrighted material commercially without a licence. When in doubt, credit the original creator and check the platform's terms.",
        ],
      },
      {
        heading: "Our approach",
        paragraphs: [
          "FrenzSave runs entirely in your browser, never asks for your social passwords, encrypts transfers, and doesn't store your files. You choose the quality, and the file saves directly to your device.",
        ],
      },
    ],
  },
  {
    slug: "how-to-download-linkedin-videos",
    title: "How to Download LinkedIn Videos (HD & MP3) in 2026",
    description:
      "Save public LinkedIn video posts as HD MP4 or convert them to MP3 — free, on iPhone, Android and PC, with no app to install.",
    date: "2026-08-25",
    updated: "2026-10-29",
    readingMinutes: 4,
    toolSlug: "linkedin-video-downloader",
    body: [
      {
        paragraphs: [
          "LinkedIn doesn't give you a native way to save a video post — no download button, no share-to-file option. Whether it's a talk, a demo or a case study you want to reference offline, here's the simplest way to download a LinkedIn video in 2026.",
        ],
      },
      {
        heading: "Download a LinkedIn video in 3 steps",
        bullets: [
          "Open the post and copy its link (the ••• menu → Copy link to post).",
          "Paste it into our LinkedIn video downloader.",
          "Choose HD video or MP3 audio — the file saves to your device.",
        ],
      },
      {
        heading: "Video or MP3?",
        paragraphs: [
          "Pick MP4 video to keep the full clip for reference or offline viewing, or MP3 if you only need the audio — handy for a talk or panel you'd rather listen back to. You get the original quality, no re-encoding.",
        ],
      },
      {
        heading: "Does it work on iPhone?",
        paragraphs: [
          "Yes. It runs in Safari or Chrome with no app, and the file saves to Files or Photos. The same link works on Android and desktop too — and no LinkedIn login is required for public posts.",
        ],
      },
    ],
  },
  {
    slug: "how-to-download-twitter-x-videos",
    title: "How to Save Twitter / X Videos to Watch Offline",
    description:
      "Save videos and GIFs from X (Twitter) in HD to watch offline — including videos inside quoted posts — free and without an account.",
    updated: "2026-10-29",
    date: "2026-06-17",
    readingMinutes: 4,
    toolSlug: "twitter-video-downloader",
    body: [
      {
        paragraphs: [
          "X (formerly Twitter) doesn't let you save videos directly. This guide shows how to save a public post's video in HD to watch offline — including videos inside quoted posts — for free.",
        ],
      },
      {
        heading: "The quick method",
        bullets: [
          "Tap the share icon on the tweet and choose Copy link.",
          "Paste the link into our Twitter video downloader.",
          "Pick a quality and download the MP4.",
        ],
      },
      {
        heading: "Videos inside quoted posts",
        paragraphs: [
          "When a video lives inside a quoted post, our extractor reads the original media so it still downloads. For private or age-restricted accounts, the video can't be accessed without being logged in.",
        ],
      },
      {
        heading: "Saving Twitter GIFs",
        paragraphs: [
          "Twitter GIFs are really short videos, so they save as MP4. You can keep them as-is or convert to a real GIF with any converter.",
        ],
      },
    ],
  },
  {
    slug: "how-to-download-facebook-videos",
    title: "How to Download Facebook Videos & Reels in HD",
    description:
      "Save public Facebook videos, Reels and Watch clips in HD or SD — free, on any device, with no login.",
    date: "2026-06-18",
    readingMinutes: 4,
    toolSlug: "facebook-video-downloader",
    body: [
      {
        paragraphs: [
          "Facebook hides its download options, but saving a public video, Reel or Watch clip is straightforward. Here's how to download Facebook videos in HD on any device.",
        ],
      },
      {
        heading: "Step by step",
        bullets: [
          "Open the video, tap the three dots or Share, and Copy link.",
          "Paste it into our Facebook video downloader.",
          "Choose HD or SD and download the MP4.",
        ],
      },
      {
        heading: "A note on quality and playback",
        paragraphs: [
          "We always aim for an H.264 MP4, which plays on every device including iPhone — some Facebook HD streams use VP9, which iOS can't play, so we prefer the universally compatible version automatically.",
        ],
      },
      {
        heading: "What about private videos?",
        paragraphs: [
          "Only public Facebook videos can be downloaded. Private group or friends-only videos require being logged in and aren't accessible.",
        ],
      },
    ],
  },
  {
    slug: "how-to-download-snapchat-stories-and-spotlight",
    title: "How to Download Snapchat Stories & Spotlight Videos",
    description:
      "Save public Snapchat Stories and Spotlight clips as MP4 — free, no app, no login — before they disappear.",
    date: "2026-06-19",
    readingMinutes: 4,
    toolSlug: "snapchat-story-downloader",
    body: [
      {
        paragraphs: [
          "Snapchat is built around content that disappears, which makes saving it tricky. Here's how to download public Snapchat Stories and Spotlight videos before they're gone.",
        ],
      },
      {
        heading: "Download a public Story",
        bullets: [
          "Open a public profile or Story link (e.g. snapchat.com/@username).",
          "Paste it into our Snapchat downloader.",
          "Download the current video snap as MP4.",
        ],
      },
      {
        heading: "Spotlight and share links",
        paragraphs: [
          "Spotlight clips are public and easy to save — even snapchat.com/t/ share links work, because we resolve them to the real video automatically.",
        ],
      },
      {
        heading: "Remember the 24-hour window",
        paragraphs: [
          "Stories are live for only 24 hours. If a profile has no current video Story (or only photos), there's nothing to download — so grab Stories while they're still up.",
        ],
      },
    ],
  },
];

export const BLOG_SLUGS = BLOG_POSTS.map((p) => p.slug);

/**
 * Renamed posts → their new slug, 301'd by next.config.ts so an indexed URL never 404s.
 * 2026-10-29 (owner): the TikTok guide was retitled from "without a watermark" to saving and archiving your own videos.
 */
export const BLOG_REDIRECTS: readonly { from: string; to: string }[] = [
  { from: "how-to-download-tiktok-videos-without-watermark", to: "how-to-save-and-archive-your-own-tiktok-videos" },
];

export function getPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((p) => p.slug === slug);
}
