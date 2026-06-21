import type { PlatformId } from "@/types";

/**
 * Programmatic-SEO data model. Each entry generates a fully server-rendered,
 * keyword-optimized landing page at `/<slug>` with metadata, SEO copy, how-to
 * steps, benefits, FAQs and JSON-LD. Add an entry → a new ranked page exists.
 */
export interface DownloaderPage {
  slug: string;
  platformId: PlatformId;
  /** Brand display name, e.g. "TikTok". */
  brand: string;
  /** What the source produces, e.g. "videos", "Reels", "Shorts". */
  noun: string;
  /** Primary target keyword. */
  keyword: string;
  /** <h1> on the page. */
  h1: string;
  /** <title> (keep ~50-60 chars). */
  title: string;
  /** Meta description (~150-160 chars). */
  description: string;
  /** Extra meta keywords. */
  keywords: string[];
  /** Short hero subheading. */
  tagline: string;
  /** 2-3 paragraph SEO content block. */
  about: string[];
  /** Benefit cards. */
  benefits: { title: string; text: string }[];
  /** FAQ entries (>= 5). */
  faqs: { q: string; a: string }[];
}

const STEPS_NOTE =
  "Copy the link from the app or website, paste it into the box above, tap Download, then choose your quality — the file saves straight to your device.";

export const DOWNLOADERS: DownloaderPage[] = [
  {
    slug: "tiktok-video-downloader",
    platformId: "tiktok",
    brand: "TikTok",
    noun: "videos",
    keyword: "TikTok video downloader",
    h1: "TikTok Video Downloader — No Watermark, HD",
    title: "TikTok Video Downloader (No Watermark, HD MP4)",
    description:
      "Download TikTok videos without watermark in HD MP4 or MP3. Free, fast and unlimited — works on iPhone, Android and PC. No app or login needed.",
    keywords: [
      "tiktok downloader",
      "tiktok no watermark",
      "download tiktok video",
      "tiktok mp4",
      "tiktok mp3 downloader",
      "ssstik alternative",
    ],
    tagline: "Save any TikTok in clean HD — watermark-free — in seconds.",
    about: [
      "Our TikTok video downloader lets you save any public TikTok as a clean, watermark-free MP4 in full HD, or extract the audio as an MP3. There's nothing to install and no account to create — paste a link and the original, un-branded file downloads straight to your phone or computer.",
      "Unlike screen recording, you get the real source file at its highest available quality, with the sound intact and no TikTok logo bouncing across the frame. That makes it perfect for re-editing, reposting to other platforms, building a content archive, or just keeping a favourite clip offline.",
      "It works everywhere — iPhone, iPad, Android, Windows, Mac and Linux — directly inside your browser. Because everything runs server-side through an advanced extraction engine, even long videos process in a couple of seconds.",
    ],
    benefits: [
      { title: "No watermark", text: "Clean source MP4 with the TikTok logo removed wherever the platform allows it." },
      { title: "HD quality", text: "Download at the highest resolution the original offers, up to 1080p and beyond." },
      { title: "MP3 audio", text: "Pull just the sound or song from any TikTok as a clean MP3." },
      { title: "Any device", text: "Works on iPhone, Android, PC and Mac right in the browser — no app." },
    ],
    faqs: [
      { q: "Is the TikTok downloader free?", a: "Yes — it's completely free and unlimited, with no account, sign-up or hidden limits." },
      { q: "Does it remove the TikTok watermark?", a: "Yes. We fetch the clean, watermark-free version of the video wherever TikTok provides it, so there's no bouncing logo." },
      { q: "Can I download TikTok videos on iPhone?", a: "Yes. It works in Safari and Chrome on iPhone and iPad — the file saves to your Files or Photos. No app needed." },
      { q: "Can I download TikTok audio as MP3?", a: "Yes. Choose the Audio (MP3) option in the preview to save just the sound or song." },
      { q: "Do I need to install an app?", a: "No. Everything runs in your browser, so there's nothing to download or update." },
      { q: "Is it safe?", a: "Yes. There are no logins to compromise, we don't store your files, and all transfers are encrypted." },
    ],
  },
  {
    slug: "instagram-reels-downloader",
    platformId: "instagram",
    brand: "Instagram",
    noun: "Reels",
    keyword: "Instagram Reels downloader",
    h1: "Instagram Reels Downloader — HD Video & MP3",
    title: "Instagram Reels Downloader (HD Video Saver)",
    description:
      "Download Instagram Reels, videos and IGTV in HD MP4 or MP3. Free, fast, no login. Save Reels on iPhone, Android and PC — no app required.",
    keywords: [
      "instagram downloader",
      "download instagram reels",
      "instagram video downloader",
      "igtv downloader",
      "reels to mp4",
      "save instagram video",
    ],
    tagline: "Save Instagram Reels and videos in crisp HD — fast and free.",
    about: [
      "Use our Instagram Reels downloader to save Reels, feed videos and IGTV clips as high-quality MP4 files, or extract their audio as MP3. Just paste the post link — no Instagram login, no app, and no watermark added by us.",
      "It's built for creators and everyday users alike: archive your own Reels in original quality, save inspiration for a moodboard, or keep a clip to watch offline. The downloader grabs the real source file rather than a low-res re-encode, so your saved Reel looks exactly like the original.",
      "Everything works directly in your mobile or desktop browser — iPhone, Android, Windows or Mac — and processing happens on our servers, so even longer Reels finish in seconds.",
    ],
    benefits: [
      { title: "Full HD Reels", text: "Download Reels and videos at the original resolution, not a blurry re-encode." },
      { title: "Audio as MP3", text: "Save the song or sound from any Reel as a clean MP3 file." },
      { title: "No login", text: "Works on public Reels without ever asking for your Instagram password." },
      { title: "Mobile-first", text: "Designed for iPhone and Android — the file saves straight to your device." },
    ],
    faqs: [
      { q: "Is the Instagram Reels downloader free?", a: "Yes — free and unlimited with no account required." },
      { q: "Can I download Instagram Reels on iPhone?", a: "Yes. Paste the Reel link in Safari or Chrome and the MP4 saves to Files or Photos." },
      { q: "Do I need my Instagram login?", a: "No. We never ask for your password — public Reels and videos download without signing in." },
      { q: "Can I save just the audio from a Reel?", a: "Yes. Pick the Audio (MP3) option to extract the sound or song." },
      { q: "Will the video have a watermark?", a: "We don't add any watermark. You get the clean source file Instagram serves." },
      { q: "Is it safe to use?", a: "Yes — encrypted transfers, no stored files, and nothing to install." },
    ],
  },
  {
    slug: "youtube-shorts-downloader",
    platformId: "youtube",
    brand: "YouTube",
    noun: "Shorts",
    keyword: "YouTube Shorts downloader",
    h1: "YouTube Shorts Downloader — HD MP4 & MP3",
    title: "YouTube Shorts Downloader (HD MP4 / MP3)",
    description:
      "Download YouTube Shorts and videos in HD MP4 or convert to MP3. Free, fast, no login. Save Shorts on iPhone, Android and PC — no app needed.",
    keywords: [
      "youtube shorts downloader",
      "download youtube shorts",
      "youtube to mp4",
      "youtube to mp3",
      "shorts saver",
      "youtube video downloader",
    ],
    tagline: "Download YouTube Shorts and videos in HD — free and instant.",
    about: [
      "Our YouTube Shorts downloader saves Shorts and regular YouTube videos as HD MP4 files, or converts them to MP3 audio. Paste the Short or video URL and pick a quality — there's no app to install and no sign-in.",
      "Choose the exact resolution you want, from compact mobile sizes up to full HD and 4K where the source offers it. It's ideal for watching offline, archiving your own uploads, or repurposing short-form clips across platforms.",
      "It runs in any browser on iPhone, Android, Windows, Mac and Linux, with fast server-side processing so even high-resolution videos download quickly.",
    ],
    benefits: [
      { title: "Up to 4K", text: "Pick any quality the source provides, from 360p to HD and 4K." },
      { title: "MP3 conversion", text: "Turn any Short or video into a clean MP3 in one tap." },
      { title: "Shorts & long-form", text: "Works for both YouTube Shorts and standard videos." },
      { title: "No sign-in", text: "Download public videos without a Google account." },
    ],
    faqs: [
      { q: "Is the YouTube Shorts downloader free?", a: "Yes — completely free with no limits or account." },
      { q: "Can I convert YouTube Shorts to MP3?", a: "Yes. Choose the Audio (MP3) option to save the sound only." },
      { q: "What quality can I download?", a: "Up to the highest the source offers — HD and 4K when available. You select the resolution first." },
      { q: "Does it work on iPhone and Android?", a: "Yes, directly in your mobile browser — no app required." },
      { q: "Do I need to install software?", a: "No. Everything happens online in your browser." },
      { q: "Is it safe?", a: "Yes — no logins, no stored files and encrypted downloads." },
    ],
  },
  {
    slug: "twitter-video-downloader",
    platformId: "twitter",
    brand: "X (Twitter)",
    noun: "videos",
    keyword: "Twitter video downloader",
    h1: "Twitter / X Video Downloader — HD MP4",
    title: "Twitter Video Downloader — X to MP4 (HD)",
    description:
      "Download Twitter / X videos and GIFs in HD MP4 or MP3. Free, fast, no login. Save X videos on iPhone, Android and PC — no app required.",
    keywords: [
      "twitter video downloader",
      "x video downloader",
      "download twitter video",
      "twitter to mp4",
      "save x video",
      "twitter gif downloader",
    ],
    tagline: "Save videos from X (Twitter) in HD MP4 — fast and free.",
    about: [
      "Our Twitter video downloader (now X) saves any public tweet's video or GIF as an HD MP4, or extracts the audio as MP3. Paste the tweet link and download instantly — no X account, no app and no watermark.",
      "It even handles reposted and quoted videos, pulling the original media at its best available quality. That makes it easy to archive clips, save reaction videos, or repurpose content for other platforms.",
      "Works in every browser on iPhone, Android, Windows and Mac, with quick server-side processing so the file is ready in seconds.",
    ],
    benefits: [
      { title: "HD MP4", text: "Download X videos at the highest bitrate the tweet provides." },
      { title: "Reposts & quotes", text: "Grabs video from reposted and quote tweets, not just originals." },
      { title: "GIF & audio", text: "Save Twitter GIFs as MP4 or pull the audio as MP3." },
      { title: "No login", text: "Public tweets download without your X password." },
    ],
    faqs: [
      { q: "Is the Twitter / X video downloader free?", a: "Yes — free and unlimited, no account needed." },
      { q: "Can I download videos from reposts?", a: "Yes. We read the original media from reposted and quote tweets so reposted videos still download." },
      { q: "Does it work on iPhone?", a: "Yes — paste the link in Safari or Chrome and the MP4 saves to your device." },
      { q: "Can I save a Twitter GIF?", a: "Yes. Twitter GIFs are saved as MP4 video, which you can convert if needed." },
      { q: "Do I need the X app or login?", a: "No. Public videos download without installing anything or signing in." },
      { q: "Is it safe?", a: "Yes — encrypted, no stored files, and no account to compromise." },
    ],
  },
  {
    slug: "facebook-video-downloader",
    platformId: "facebook",
    brand: "Facebook",
    noun: "videos",
    keyword: "Facebook video downloader",
    h1: "Facebook Video Downloader — HD & SD MP4",
    title: "Facebook Video Downloader (HD MP4 Saver)",
    description:
      "Download Facebook videos and Reels in HD or SD MP4, or MP3 audio. Free, fast, no login. Save FB videos on iPhone, Android and PC — no app.",
    keywords: [
      "facebook video downloader",
      "download facebook video",
      "fb video downloader",
      "facebook reels downloader",
      "facebook to mp4",
      "save fb video",
    ],
    tagline: "Download Facebook videos and Reels in HD — free and simple.",
    about: [
      "Our Facebook video downloader saves public Facebook videos, Reels and watch clips as HD or SD MP4 files, or as MP3 audio. Paste the video link, choose your quality and download — no Facebook login, no app and nothing to install.",
      "Pick HD for the sharpest copy or SD to save data on mobile. It's great for archiving your own videos, saving tutorials to watch offline, or keeping a clip before it disappears.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac, processed quickly on our servers so even long videos finish fast.",
    ],
    benefits: [
      { title: "HD or SD", text: "Choose a sharp HD copy or a lighter SD file to save data." },
      { title: "Reels & watch", text: "Works with Facebook videos, Reels and Watch clips." },
      { title: "MP3 audio", text: "Extract the audio from any Facebook video as MP3." },
      { title: "No app", text: "Runs in the browser on every device — nothing to install." },
    ],
    faqs: [
      { q: "Is the Facebook video downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I download Facebook Reels?", a: "Yes. Paste the Reel or video link and pick your quality." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, the file saves to your device." },
      { q: "Can I choose HD or SD?", a: "Yes. We surface both qualities when available so you can pick HD or a smaller SD file." },
      { q: "Do I need to log in to Facebook?", a: "No. Public videos download without signing in." },
      { q: "Is it safe?", a: "Yes — encrypted transfers, no stored files and no login required." },
    ],
  },
  {
    slug: "snapchat-story-downloader",
    platformId: "snapchat",
    brand: "Snapchat",
    noun: "Stories",
    keyword: "Snapchat story downloader",
    h1: "Snapchat Story Downloader — Save Public Stories",
    title: "Snapchat Story Downloader (Save Stories)",
    description:
      "Download public Snapchat Stories and snaps as MP4. Free, fast, no login. Save Snapchat Stories on iPhone, Android and PC — no app required.",
    keywords: [
      "snapchat story downloader",
      "download snapchat story",
      "save snapchat story",
      "snapchat video downloader",
      "snapchat story saver",
      "snapchat to mp4",
    ],
    tagline: "Save public Snapchat Stories as clean MP4 video — no login.",
    about: [
      "Our Snapchat Story downloader saves video snaps from public Snapchat profiles and Story links as MP4 files. Paste a profile or Story URL (for example snapchat.com/@username) and download the video without installing the app or logging in.",
      "Public Story content is pulled directly from Snapchat's servers at original quality, so the saved snap looks exactly as it does in the app. It's perfect for keeping a creator's Story before it expires, archiving your own public Story, or saving a moment to share elsewhere.",
      "It works in any browser on iPhone, Android, Windows and Mac. Remember that Snapchat Stories are live for 24 hours, so download the snap while the Story is still public.",
    ],
    benefits: [
      { title: "Public Stories", text: "Save video snaps from public Snapchat profile Stories." },
      { title: "Original quality", text: "Pulled from Snapchat's CDN, so the snap looks just like the app." },
      { title: "No app or login", text: "Download in the browser without installing Snapchat or signing in." },
      { title: "Any device", text: "Works on iPhone, Android, PC and Mac." },
    ],
    faqs: [
      { q: "Is the Snapchat Story downloader free?", a: "Yes — completely free with no account or app." },
      { q: "How do I download a Snapchat Story?", a: "Paste a public profile or Story link (like snapchat.com/@username) and tap Download to save the current video snap." },
      { q: "Can I download private Stories?", a: "No. Only public Snapchat Stories and Spotlight content can be downloaded — private snaps stay private." },
      { q: "Why does it say no video found?", a: "Stories are live for only 24 hours. If a profile has no current video Story (or only photos), there's nothing to download." },
      { q: "Does it work on iPhone?", a: "Yes — paste the link in Safari or Chrome and the MP4 saves to your device." },
      { q: "Is it safe?", a: "Yes — no login, no stored files and encrypted downloads." },
    ],
  },
  {
    slug: "snapchat-spotlight-downloader",
    platformId: "snapchat",
    brand: "Snapchat Spotlight",
    noun: "Spotlight videos",
    keyword: "Snapchat Spotlight downloader",
    h1: "Snapchat Spotlight Downloader — HD MP4",
    title: "Snapchat Spotlight Downloader (HD MP4)",
    description:
      "Download Snapchat Spotlight videos in HD MP4, no watermark. Free, fast, no login. Save Spotlight clips on iPhone, Android and PC — no app.",
    keywords: [
      "snapchat spotlight downloader",
      "download snapchat spotlight",
      "snapchat spotlight video download",
      "spotlight to mp4",
      "snapchat downloader",
      "save spotlight video",
    ],
    tagline: "Download Snapchat Spotlight videos in HD MP4 — free, no login.",
    about: [
      "Our Snapchat Spotlight downloader saves Spotlight videos as clean HD MP4 files. Paste a Spotlight link — including snapchat.com/t/ share links, which we resolve automatically — and download the clip without the app or an account.",
      "Spotlight clips are public by design, so you can save trending videos, keep a favourite for offline viewing, or archive your own Spotlight submissions in original quality with no watermark added by us.",
      "It runs in your browser on iPhone, Android, Windows and Mac, with fast server-side processing so each clip is ready in seconds.",
    ],
    benefits: [
      { title: "HD MP4", text: "Save Spotlight clips at original quality with no added watermark." },
      { title: "Share links work", text: "snapchat.com/t/ short links resolve automatically to the real video." },
      { title: "No app", text: "Download in the browser — no Snapchat install or login." },
      { title: "Every device", text: "iPhone, Android, PC and Mac all supported." },
    ],
    faqs: [
      { q: "Is the Snapchat Spotlight downloader free?", a: "Yes — free and unlimited, no account needed." },
      { q: "Do Snapchat share links (snapchat.com/t/...) work?", a: "Yes. We automatically resolve /t/ short links to the underlying Spotlight video before downloading." },
      { q: "Will the video have a watermark?", a: "We don't add any watermark — you get the clean source clip Snapchat serves." },
      { q: "Does it work on iPhone and Android?", a: "Yes, directly in your mobile browser. The MP4 saves to your device." },
      { q: "Do I need the Snapchat app?", a: "No. Everything runs online with nothing to install." },
      { q: "Is it safe?", a: "Yes — encrypted, no stored files and no login." },
    ],
  },
  {
    slug: "pinterest-video-downloader",
    platformId: "pinterest",
    brand: "Pinterest",
    noun: "videos",
    keyword: "Pinterest video downloader",
    h1: "Pinterest Video Downloader — HD MP4 & GIF",
    title: "Pinterest Video Downloader (HD MP4)",
    description:
      "Download Pinterest videos and idea pins in HD MP4 or MP3. Free, fast, no login. Save Pinterest videos on iPhone, Android and PC — no app.",
    keywords: [
      "pinterest video downloader",
      "download pinterest video",
      "pinterest to mp4",
      "idea pin downloader",
      "save pinterest video",
      "pinterest gif downloader",
    ],
    tagline: "Save Pinterest videos and idea pins in HD — free and fast.",
    about: [
      "Our Pinterest video downloader saves video pins and idea pins as HD MP4 files, or extracts their audio as MP3. Paste the pin link and download instantly — no Pinterest account, no app and no watermark.",
      "Get the original source file at full quality, ideal for saving DIY tutorials, recipes and inspiration to watch offline or reuse in your own projects.",
      "It works in any browser on iPhone, Android, Windows and Mac, with fast processing so your pin downloads in seconds.",
    ],
    benefits: [
      { title: "HD video pins", text: "Download video pins and idea pins at full source quality." },
      { title: "MP3 audio", text: "Extract the sound from any video pin as MP3." },
      { title: "No login", text: "Public pins download without a Pinterest account." },
      { title: "Any device", text: "Works on iPhone, Android, PC and Mac in the browser." },
    ],
    faqs: [
      { q: "Is the Pinterest video downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I download idea pins?", a: "Yes. Paste the idea pin or video pin link to save it as MP4." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, with the file saved to your device." },
      { q: "Can I save the audio only?", a: "Yes. Choose the Audio (MP3) option in the preview." },
      { q: "Do I need to install anything?", a: "No. It runs entirely in your browser." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
  },
];

export const DOWNLOADER_SLUGS = DOWNLOADERS.map((d) => d.slug);

export function getDownloader(slug: string): DownloaderPage | undefined {
  return DOWNLOADERS.find((d) => d.slug === slug);
}

/** Shared 3-step "how to" used across pages. */
export function howToSteps(brand: string, noun: string) {
  return [
    {
      title: `Copy the ${brand} link`,
      text: `Open ${brand}, find the ${noun} you want, and copy its share link.`,
    },
    {
      title: "Paste it above",
      text: "Paste the link into the box and tap Download to fetch the media.",
    },
    {
      title: "Pick quality & save",
      text: "Choose video quality or MP3 audio — the file saves to your device.",
    },
  ];
}

export { STEPS_NOTE };
