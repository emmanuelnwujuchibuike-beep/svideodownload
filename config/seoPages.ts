import type { PlatformId } from "@/types";

/**
 * Programmatic-SEO source of truth. Pages are generated as CLUSTER × MODIFIER.
 * Add a modifier to a cluster (or a whole cluster) → new ranked page(s) appear
 * automatically in routing, sitemap and internal links. Copy uses {brand} and
 * {thing} placeholders so every rendered page is platform-specific and unique.
 */

export interface SeoModifier {
  /** Appended to the cluster stem to form the page slug. Must be unique per cluster. */
  slug: string;
  /** <title> fragment. Supports {brand}/{thing}. */
  title: string;
  /** Primary keyword. Supports {brand}/{thing}. */
  keyword: string;
  /** Optional H1 override. */
  h1?: string;
  /** Overrides the cluster noun for this intent (e.g. "Shorts", "GIFs", "photos"). */
  thing?: string;
  /** Hero subheading. */
  tagline: string;
  /** Unique intent paragraph for the SEO body. */
  angle: string;
  /** Intent-specific benefit card. */
  benefit: { title: string; text: string };
  /** Intent-specific FAQs (1-2). */
  faqs: { q: string; a: string }[];
  /** Extra secondary keyword fragments. */
  secondary?: string[];
  /**
   * 🔴 THIS MODIFIER IS SHARED ACROSS PLATFORMS — its prose must not be printed.
   *
   * `mHd`, `mMp3`, `mIphone`, `mAndroid` and `mPc` are single objects spread
   * onto 9-11 clusters each, so every sentence in them appears on 9-11 pages
   * with only the brand swapped. Measured 2026-09-02, they were the ENTIRE
   * remaining duplication after the platform rewrite: "Downloading {brand} on
   * iPhone used to mean installing shady apps" on 11 pages, "Made for iOS" on
   * 11, "How do I save {brand} on iPhone?" on 11.
   *
   * The slug, title, keyword and tagline stay — those carry the search intent
   * and do vary by brand. The angle/benefit/faqs are suppressed by
   * `buildPage` in favour of that platform's own written content, so an
   * iPhone page for TikTok and one for Reddit no longer say the same thing.
   */
  generic?: boolean;
}

export interface SeoCluster {
  id: string;
  platformId: PlatformId;
  brand: string;
  /** Default noun for the cluster, e.g. "videos". */
  thing: string;
  /** Slug stem, e.g. "tiktok" → /tiktok-<modifier.slug>. */
  stem: string;
  /** Intro paragraph variants (rotated per page to avoid duplication). */
  intros: string[];
  /** Platform-specific paragraphs for the SEO body (rotated). */
  facts: string[];
  /** Shared benefit cards for the cluster. */
  baseBenefits: { title: string; text: string }[];
  /** Shared FAQ pool (rotated subset per page). */
  baseFaqs: { q: string; a: string }[];
  /** Ordered modifiers; index 0 is the primary page. */
  modifiers: SeoModifier[];
}

/*
  ═══════════════════════════════════════════════════════════════════════════
   🔴 ONE PAGE PER PLATFORM (2026-10-29, AdSense review, round 4).
  ═══════════════════════════════════════════════════════════════════════════

  Owner: "Keep only one page per platform." Every cluster below now has exactly
  ONE modifier — its primary page — and the shared generics are gone.

  History, so nobody rebuilds what was removed on purpose:
    · 2026-08-23 — six synonym modifiers (mp4/online/free/fast/saver/without-app)
    · 2026-08-25 — the whole YouTube cluster
    · 2026-09-02 — the device variants (-for-iphone/-android/-pc)
    · 2026-10-29 — everything else: the intent variants (no-watermark, 4k,
      story, photo, sound, idea-pin, …) and the shared HD / MP3 generics.

  Each removed URL 301s to its platform's page (lib/seo/removed-seo-pages.ts →
  next.config.ts redirects). A different OUTPUT (audio, photos, HD) is a section
  or a format choice ON the platform page, never another URL. Adding a modifier
  back re-creates a doorway page: don't.
*/

/* ------------------------------------------------------------------ *
 * Clusters
 * ------------------------------------------------------------------ */

export const CLUSTERS: SeoCluster[] = [
  {
    id: "tiktok",
    platformId: "tiktok",
    brand: "TikTok",
    thing: "videos",
    stem: "tiktok",
    intros: [
      "Save any public TikTok as a file in seconds — no app and no account.",
      "Paste a TikTok link and download the original clip in full quality to your phone or computer.",
      "The fastest way to keep TikToks offline: drop in a link and get the source file, sound intact.",
    ],
    facts: [
      "Keeping your own TikToks backed up means a lost phone or a deleted account doesn't take your videos with it. We fetch the source file TikTok provides, at its original resolution.",
      "Because everything runs server-side through an advanced extraction engine, even long or high-resolution TikToks process in a couple of seconds — far better quality than a screen recording.",
      "It works everywhere — iPhone, iPad, Android, Windows, Mac and Linux — directly in your browser, with the file saved straight to your device.",
    ],
    baseBenefits: [
      { title: "Original file", text: "The source MP4 TikTok serves, at its original resolution." },
      { title: "HD quality", text: "Download at the original resolution, up to 1080p and beyond." },
      { title: "Any device", text: "iPhone, Android, PC and Mac — right in the browser, no app." },
    ],
    baseFaqs: [
      { q: "Is the TikTok downloader free?", a: "Yes — completely free and unlimited, with no account or sign-up." },
      { q: "Can I back up my own TikToks?", a: "Yes — paste the link to any of your public posts and keep the original file on your device." },
      { q: "Do I need to install an app?", a: "No. Everything runs in your browser, so there's nothing to download." },
      { q: "Is it safe?", a: "Yes — no logins to compromise, no files stored, and encrypted transfers." },
      { q: "Can I download anyone's TikTok?", a: "You can download public TikToks. Only save content you have the right to use, and respect copyright." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "TikTok Video Downloader (Original Quality)",
        keyword: "TikTok video downloader",
        h1: "Save TikTok Videos in Original Quality",
        tagline: "Back up your own TikToks and keep public videos for offline viewing, at the resolution they were uploaded.",
        angle:
          "Our TikTok video downloader saves a public TikTok as an MP4 at its original resolution, or its audio as MP3. Use it to back up videos you posted, keep a clip to watch offline, or archive a post you have permission to keep. There's nothing to install and no account — paste a link and the file saves to your device.",
        benefit: { title: "Your own backup", text: "The original file with full audio, kept on your device — so your videos outlive the app." },
        faqs: [{ q: "Can I download TikTok videos on iPhone?", a: "Yes — it works in Safari and Chrome on iPhone and iPad; the file saves to Files or Photos." }],
        // no competitor names, no "no watermark" (owner, 2026-10-29: copyright-risky wording)
        secondary: ["download tiktok video", "save tiktok video", "tiktok to mp4"],
      },
    ],
  },
  {
    id: "instagram",
    platformId: "instagram",
    brand: "Instagram",
    thing: "videos",
    stem: "instagram",
    intros: [
      "Save Instagram content in HD without the app — paste a link and download in seconds.",
      "Keep Reels, videos and photos offline in original quality, with no Instagram login required.",
      "The simple way to download from Instagram: drop in a post link and pick your quality.",
    ],
    facts: [
      "Instagram has no built-in download button for other people's posts, so saving a clip for inspiration, an edit or offline viewing needs a tool like this — and we never ask for your password.",
      "We fetch the real source file rather than a low-res re-encode, so your saved Reel or photo looks exactly like the original. Audio can be extracted separately as MP3.",
      "Everything runs in your mobile or desktop browser — iPhone, Android, Windows and Mac — with fast server-side processing.",
    ],
    baseBenefits: [
      { title: "Original quality", text: "Reels, videos and photos saved at full source quality." },
      { title: "No login", text: "Works on public posts without your Instagram password." },
      { title: "Mobile-first", text: "Designed for iPhone and Android — saves straight to your device." },
    ],
    baseFaqs: [
      { q: "Is the Instagram downloader free?", a: "Yes — free and unlimited, with no account required." },
      { q: "Do I need my Instagram login?", a: "No. We never ask for your password — public content downloads without signing in." },
      { q: "Will the file have a watermark?", a: "We don't add any watermark — you get the clean source file Instagram serves." },
      { q: "Does it work on iPhone?", a: "Yes. Paste the link in Safari or Chrome and the file saves to Files or Photos." },
      { q: "Is it safe to use?", a: "Yes — encrypted transfers, no stored files and nothing to install." },
    ],
    modifiers: [
      {
        slug: "reels-downloader",
        title: "Instagram Reels Downloader (HD)",
        keyword: "Instagram Reels downloader",
        thing: "Reels",
        h1: "Instagram Reels Downloader — HD Video & MP3",
        tagline: "Save Instagram Reels in crisp HD — fast and free.",
        angle:
          "Use our Instagram Reels downloader to save Reels as high-quality MP4 files, or extract their audio as MP3. Paste the Reel link — no login, no app — and the original-quality file downloads straight to your device. Handy for backing up your own Reels or watching one offline.",
        benefit: { title: "Full-HD Reels", text: "Download Reels at the original resolution, not a blurry copy." },
        faqs: [{ q: "Can I download Instagram Reels on iPhone?", a: "Yes — paste the Reel link in Safari or Chrome and the MP4 saves to Files or Photos." }],
        secondary: ["download instagram reels", "reels to mp4", "save instagram reel"],
      },
    ],
  },
  /*
    🔴 YOUTUBE CLUSTER REMOVED HERE 2026-08-25 (AdSense "Low value content"
    rejection — the owner's read, after two rejections, is that a
    YouTube-branded downloader specifically is the trigger: YouTube's own
    ToS and AdSense policy are markedly stricter about third-party YouTube
    download tools than about the other platforms this app supports. All 5
    pages (shorts/video/mp3/thumbnail/1080p downloader) are gone; each
    301-redirects to linkedin-video-downloader (next.config.ts /
    lib/seo/removed-seo-pages.ts), the platform promoted in its place across
    landing/marketing surfaces. The backend is untouched — detectPlatform()
    in lib/platforms.ts still recognizes youtube.com URLs pasted into the
    generic downloader, so nothing that already works breaks; this is a
    marketing-surface decision, not a feature removal.
  */
  {
    id: "twitter",
    platformId: "twitter",
    brand: "Twitter",
    thing: "videos",
    stem: "twitter",
    intros: [
      "Save videos and GIFs from X (Twitter) in HD — paste a tweet link and download.",
      "Keep any public tweet's video offline in seconds, no X account needed.",
      "The quick way to save X videos to watch offline.",
    ],
    facts: [
      "Our extractor reads the original media at its best available quality — so a video inside a quoted post still downloads.",
      "Twitter GIFs are technically short videos; we save them as MP4 so they play and share easily everywhere.",
      "Works in every browser on iPhone, Android, Windows and Mac, with quick server-side processing.",
    ],
    baseBenefits: [
      { title: "HD MP4", text: "Download X videos at the highest bitrate the tweet provides." },
      { title: "Quoted posts", text: "Reads the video inside a quoted post, not just originals." },
      { title: "No login", text: "Public tweets download without your X password." },
    ],
    baseFaqs: [
      { q: "Is the Twitter / X video downloader free?", a: "Yes — free and unlimited, no account needed." },
      { q: "Can I download a video from a quoted post?", a: "Yes — we read the original media from the quoted post." },
      { q: "Does it work on iPhone?", a: "Yes — paste the link in Safari or Chrome and the MP4 saves to your device." },
      { q: "Do I need the X app or login?", a: "No. Public videos download without installing anything or signing in." },
      { q: "Is it safe?", a: "Yes — encrypted, no stored files, and no account to compromise." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Twitter Video Downloader — X to MP4 (HD)",
        keyword: "Twitter video downloader",
        h1: "Twitter / X Video Downloader — HD MP4",
        tagline: "Save videos from X (Twitter) in HD MP4 — fast and free.",
        angle:
          "Our Twitter video downloader (now X) saves any public tweet's video as an HD MP4, or extracts the audio as MP3. Paste the post link and download instantly — no X account and no app. It also reads the video inside a quoted post, so a clip you were shown in a quote still saves for offline viewing.",
        benefit: { title: "Highest bitrate", text: "Downloads X videos at the best quality the tweet offers." },
        faqs: [{ q: "Can I save a Twitter GIF?", a: "Yes — Twitter GIFs are saved as MP4 video, which you can convert if needed." }],
        secondary: ["x video downloader", "download twitter video", "twitter to mp4"],
      },
    ],
  },
  {
    id: "facebook",
    platformId: "facebook",
    brand: "Facebook",
    thing: "videos",
    stem: "facebook",
    intros: [
      "Download Facebook videos and Reels in HD or SD — paste a link and pick your quality.",
      "Keep public Facebook clips offline in seconds, with no login and no app.",
      "The simple way to save Facebook videos, Reels and Watch clips.",
    ],
    facts: [
      "Pick HD for the sharpest copy or SD to save data on mobile — we surface both qualities whenever Facebook provides them.",
      "It's great for archiving your own videos, saving tutorials to watch offline, or keeping a clip before it disappears.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac, processed quickly on our servers.",
    ],
    baseBenefits: [
      { title: "HD or SD", text: "Choose a sharp HD copy or a lighter SD file to save data." },
      { title: "Reels & Watch", text: "Works with Facebook videos, Reels and Watch clips." },
      { title: "No app", text: "Runs in the browser on every device — nothing to install." },
    ],
    baseFaqs: [
      { q: "Is the Facebook video downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I choose HD or SD?", a: "Yes — we surface both qualities when available so you can pick." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Do I need to log in to Facebook?", a: "No. Public videos download without signing in." },
      { q: "Is it safe?", a: "Yes — encrypted transfers, no stored files and no login required." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Facebook Video Downloader (HD MP4 Saver)",
        keyword: "Facebook video downloader",
        h1: "Facebook Video Downloader — HD & SD MP4",
        tagline: "Download Facebook videos and Reels in HD — free and simple.",
        angle:
          "Our Facebook video downloader saves public Facebook videos, Reels and Watch clips as HD or SD MP4 files, or as MP3 audio. Paste the video link, choose your quality and download — no Facebook login, no app and nothing to install.",
        benefit: { title: "HD & SD options", text: "Pick a sharp HD file or a smaller SD copy to save data." },
        faqs: [{ q: "Can I download Facebook Reels?", a: "Yes — paste the Reel or video link and pick your quality." }],
        secondary: ["download facebook video", "fb video downloader", "facebook to mp4"],
      },
    ],
  },
  {
    id: "pinterest",
    platformId: "pinterest",
    brand: "Pinterest",
    thing: "videos",
    stem: "pinterest",
    intros: [
      "Download Pinterest videos, idea pins and images — paste a pin link and save.",
      "Keep Pinterest inspiration offline in original quality, no account needed.",
      "The easy way to save Pinterest video pins and images on any device.",
    ],
    facts: [
      "Get the original source file at full quality — ideal for saving DIY tutorials, recipes and inspiration to watch offline or reuse in your own projects.",
      "Idea pins (video pins) and standard images both download cleanly, and audio can be pulled out as MP3 when you only want the sound.",
      "It works in any browser on iPhone, Android, Windows and Mac, with fast processing.",
    ],
    baseBenefits: [
      { title: "Video pins & images", text: "Download video pins, idea pins and full-size images." },
      { title: "MP3 audio", text: "Extract the sound from any video pin as MP3." },
      { title: "No login", text: "Public pins download without a Pinterest account." },
    ],
    baseFaqs: [
      { q: "Is the Pinterest downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I download idea pins?", a: "Yes — paste the idea pin or video pin link to save it." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Do I need to install anything?", a: "No. It runs entirely in your browser." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Pinterest Video Downloader (HD MP4)",
        keyword: "Pinterest video downloader",
        h1: "Pinterest Video Downloader — HD MP4 & GIF",
        tagline: "Save Pinterest videos and idea pins in HD — free and fast.",
        angle:
          "Our Pinterest video downloader saves video pins and idea pins as HD MP4 files, or extracts their audio as MP3. Paste the pin link and download instantly — no Pinterest account and no app. Useful for keeping a how-to or recipe pin to follow offline.",
        benefit: { title: "Full-quality pins", text: "Download video pins at the original source quality." },
        faqs: [{ q: "Can I save the audio only?", a: "Yes — choose the Audio (MP3) option in the preview." }],
        secondary: ["download pinterest video", "pinterest to mp4", "save pinterest video"],
      },
    ],
  },
  {
    id: "snapchat",
    platformId: "snapchat",
    brand: "Snapchat",
    thing: "videos",
    stem: "snapchat",
    intros: [
      "Download public Snapchat Stories and Spotlight videos as MP4 — no app, no login.",
      "Save Snapchat content before it disappears — paste a link and download.",
      "The simple way to keep public Snapchat videos offline on any device.",
    ],
    facts: [
      "Public Story and Spotlight content is pulled directly from Snapchat's servers at original quality, so the saved clip looks exactly as it does in the app.",
      "Snapchat Stories are live for only 24 hours, so download the snap while the Story is still public — Spotlight clips stay available longer.",
      "It works in any browser on iPhone, Android, Windows and Mac, with no app to install and no account.",
    ],
    baseBenefits: [
      { title: "Public Stories & Spotlight", text: "Save video snaps from public profiles and Spotlight." },
      { title: "Original quality", text: "Pulled from Snapchat's CDN — looks just like the app." },
      { title: "No app or login", text: "Download in the browser without installing Snapchat." },
    ],
    baseFaqs: [
      { q: "Is the Snapchat downloader free?", a: "Yes — completely free with no account or app." },
      { q: "Can I download private Snapchat content?", a: "No — only public Stories and Spotlight videos can be saved. Private snaps stay private." },
      { q: "Why does it say no video found?", a: "Stories are live for only 24 hours. If a profile has no current video Story (or only photos), there's nothing to download." },
      { q: "Does it work on iPhone?", a: "Yes — paste the link in Safari or Chrome and the MP4 saves to your device." },
      { q: "Is it safe?", a: "Yes — no login, no stored files and encrypted downloads." },
    ],
    modifiers: [
      {
        slug: "story-downloader",
        title: "Snapchat Story Downloader (Save Stories)",
        keyword: "Snapchat story downloader",
        thing: "Stories",
        h1: "Snapchat Story Downloader — Save Public Stories",
        tagline: "Save public Snapchat Stories as MP4 video before they expire — no login.",
        angle:
          "Our Snapchat Story downloader saves video snaps from public Snapchat profiles and Story links as MP4 files. Paste a profile or Story URL (for example snapchat.com/@username) and download the video without installing the app or logging in.",
        benefit: { title: "Public Stories", text: "Save video snaps from public Snapchat profile Stories." },
        faqs: [{ q: "How do I download a Snapchat Story?", a: "Paste a public profile or Story link (like snapchat.com/@username) and tap Download to save the current video snap." }],
        secondary: ["download snapchat story", "save snapchat story", "snapchat story saver"],
      },
    ],
  },
  {
    id: "reddit",
    platformId: "reddit",
    brand: "Reddit",
    thing: "videos",
    stem: "reddit",
    intros: [
      "Save Reddit videos with sound — paste a post link and download in seconds.",
      "Reddit splits video and audio into separate streams; we merge them so your download actually has sound.",
      "The easy way to keep Reddit clips offline, audio included.",
    ],
    facts: [
      "Reddit serves video and audio as separate DASH streams, which is why most screen-grabs and lazy downloaders end up silent. We fetch both and merge them into one MP4 with sound.",
      "It works for v.redd.it links, full post URLs and crossposts, saving the original quality the uploader provided.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac — no app and no Reddit login.",
    ],
    baseBenefits: [
      { title: "With sound", text: "Merges Reddit's separate video + audio streams so the file isn't silent." },
      { title: "Original quality", text: "Saves the best resolution the post provides." },
      { title: "No login", text: "Public posts download without a Reddit account." },
    ],
    baseFaqs: [
      { q: "Is the Reddit video downloader free?", a: "Yes — free and unlimited, no account needed." },
      { q: "Why are my Reddit downloads usually silent?", a: "Reddit stores video and audio separately. We merge them, so your download keeps the sound." },
      { q: "Does it work with v.redd.it links?", a: "Yes — paste a v.redd.it link or the full post URL." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Reddit Video Downloader (With Sound)",
        keyword: "Reddit video downloader",
        h1: "Reddit Video Downloader — With Sound",
        tagline: "Download Reddit videos with audio — free, no login.",
        angle:
          "Our Reddit video downloader saves any public Reddit video as an MP4 with sound — merging Reddit's separate video and audio streams that usually leave downloads silent. Paste a post or v.redd.it link and download in original quality, no app and no account.",
        benefit: { title: "Audio merged", text: "Combines Reddit's split streams into one MP4 with sound." },
        faqs: [{ q: "Can I download Reddit videos with sound on iPhone?", a: "Yes — paste the link in Safari and the merged MP4 (with audio) saves to your device." }],
        secondary: ["download reddit video", "reddit video with sound", "v.redd.it downloader"],
      },
    ],
  },
  {
    id: "vimeo",
    platformId: "vimeo",
    brand: "Vimeo",
    thing: "videos",
    stem: "vimeo",
    intros: [
      "Download Vimeo videos in HD — paste a link and choose your quality.",
      "Keep Vimeo videos offline in crisp quality, no app and no account.",
      "The simple way to save public Vimeo videos on any device.",
    ],
    facts: [
      "Vimeo is built for high-quality video, and we preserve it — downloading the best resolution the uploader allows, up to Full HD and 4K where available.",
      "It's ideal for saving showreels, tutorials and films to watch offline, or archiving your own uploads in original quality.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac, with fast server-side processing.",
    ],
    baseBenefits: [
      { title: "Up to 4K", text: "Download the best resolution the video offers." },
      { title: "MP3 audio", text: "Extract the soundtrack from any Vimeo video as MP3." },
      { title: "No app", text: "Runs in the browser on every device — nothing to install." },
    ],
    baseFaqs: [
      { q: "Is the Vimeo downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "What quality can I download?", a: "Up to the highest the source offers, including HD and 4K. You pick the resolution first." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Can I download password-protected videos?", a: "No — only public Vimeo videos can be downloaded." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Vimeo Video Downloader (HD & 4K)",
        keyword: "Vimeo video downloader",
        h1: "Vimeo Video Downloader — HD & 4K",
        tagline: "Download Vimeo videos in HD or 4K — free and fast.",
        angle:
          "Our Vimeo video downloader saves public Vimeo videos as HD MP4 files at the resolution you choose, up to 4K, or extracts the audio as MP3. Paste the video link and download — no app and no account. Much of Vimeo is professional work, so keep what you save for offline viewing unless the creator has given you permission for more.",
        benefit: { title: "Pristine quality", text: "Preserves Vimeo's high quality up to 4K." },
        faqs: [{ q: "Can I download Vimeo videos in 4K?", a: "Yes, when the source offers it — we always fetch the highest available resolution." }],
        secondary: ["download vimeo video", "vimeo to mp4", "save vimeo video"],
      },
    ],
  },
  {
    id: "linkedin",
    platformId: "linkedin",
    brand: "LinkedIn",
    thing: "videos",
    stem: "linkedin",
    intros: [
      "Download LinkedIn videos in HD — paste a post link and save in seconds.",
      "Keep LinkedIn video posts offline for reference, no app and no login.",
      "The professional way to save LinkedIn videos on any device.",
    ],
    facts: [
      "Save native LinkedIn video posts as HD MP4 files — useful for keeping talks, demos, case studies and thought-leadership clips to reference offline.",
      "We fetch the original source file rather than a re-encode, so your saved video stays sharp when you watch it back.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac, with no LinkedIn login required for public posts.",
    ],
    baseBenefits: [
      { title: "HD video", text: "Download LinkedIn video posts at the original quality." },
      { title: "MP3 audio", text: "Extract the audio from any LinkedIn video as MP3." },
      { title: "No login", text: "Public posts download without your LinkedIn account." },
    ],
    baseFaqs: [
      { q: "Is the LinkedIn video downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I download any LinkedIn video?", a: "You can download public, native LinkedIn video posts. Private or members-only content can't be accessed." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Do I need to log in?", a: "No. Public video posts download without signing in." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "LinkedIn Video Downloader (HD MP4)",
        keyword: "LinkedIn video downloader",
        h1: "LinkedIn Video Downloader — HD MP4",
        tagline: "Download LinkedIn videos in HD — free, no login.",
        angle:
          "Our LinkedIn video downloader saves public LinkedIn video posts as HD MP4 files, or extracts the audio as MP3. Paste the post link and download instantly — no app and no account. Great for saving talks and demos to reference later.",
        benefit: { title: "Reference offline", text: "Keep professional videos for offline viewing or later reference." },
        faqs: [{ q: "How do I download a LinkedIn video?", a: "Open the post, copy its link, paste it here and tap Download." }],
        secondary: ["download linkedin video", "linkedin to mp4", "save linkedin video"],
      },
    ],
  },
  {
    id: "threads",
    platformId: "threads",
    brand: "Threads",
    thing: "videos",
    stem: "threads",
    intros: [
      "Download Threads videos in HD — paste a post link and save in seconds.",
      "Keep videos from Threads offline in original quality, no app and no login.",
      "The simple way to save Threads video posts on any device.",
    ],
    facts: [
      "Save native video posts from Threads as HD MP4 files, or extract the audio as MP3 — handy for archiving your own clips or watching them offline.",
      "We fetch the original source file Threads serves, so your saved video keeps its full quality and sound.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac, with no Threads login required for public posts.",
    ],
    baseBenefits: [
      { title: "HD video", text: "Download Threads videos at the original quality." },
      { title: "MP3 audio", text: "Extract the sound from any Threads video as MP3." },
      { title: "No login", text: "Public posts download without your Threads account." },
    ],
    baseFaqs: [
      { q: "Is the Threads video downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "Can I download any Threads video?", a: "You can download public Threads video posts. Private accounts can't be accessed." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Do I need to log in?", a: "No. Public video posts download without signing in." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Threads Video Downloader (HD MP4)",
        keyword: "Threads video downloader",
        h1: "Threads Video Downloader — HD MP4",
        tagline: "Download Threads videos in HD — free, no login.",
        angle:
          "Our Threads video downloader saves public Threads video posts as HD MP4 files, or extracts the audio as MP3. Paste the post link and download instantly — no app and no account. Useful for backing up your own posts or watching later offline.",
        benefit: { title: "Original quality", text: "Saves Threads videos at full source quality with sound." },
        faqs: [{ q: "How do I download a Threads video?", a: "Open the post, copy its link, paste it here and tap Download." }],
        secondary: ["download threads video", "threads to mp4", "save threads video"],
      },
    ],
  },
  {
    id: "telegram",
    platformId: "telegram",
    brand: "Telegram",
    thing: "videos",
    stem: "telegram",
    intros: [
      "Download Telegram videos in HD — paste a public channel post link and save in seconds.",
      "Save videos, photos, GIFs and voice messages from public Telegram channels, no app and no login.",
      "The simple way to download Telegram media on any device — videos, photos and audio.",
    ],
    facts: [
      "Save videos, photos, GIFs, documents and voice messages from public Telegram channels and posts — keep the original quality with full sound.",
      "Paste a t.me link to a public channel post and the media downloads straight to your device as a clean file, with no watermark added by us.",
      "Everything runs in your browser on iPhone, Android, Windows and Mac; public channel content downloads without signing in.",
    ],
    baseBenefits: [
      { title: "HD video", text: "Download Telegram videos at their original quality with sound." },
      { title: "Photos & files", text: "Save photos, GIFs, documents and voice messages too." },
      { title: "No login", text: "Public channel posts download without your Telegram account." },
    ],
    baseFaqs: [
      { q: "Is the Telegram downloader free?", a: "Yes — free and unlimited with no account." },
      { q: "What can I download from Telegram?", a: "Public channel videos, photos, GIFs, documents and voice messages — just paste the post's t.me link." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, saved to your device." },
      { q: "Can I download Telegram Stories?", a: "Public channel posts download instantly here; Stories and private content need an authenticated connection." },
      { q: "Is it safe?", a: "Yes — encrypted downloads, no stored files and no login for public content." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "Telegram Video Downloader (HD MP4)",
        keyword: "Telegram video downloader",
        h1: "Telegram Video Downloader — HD MP4",
        tagline: "Download Telegram videos in HD — free, no login.",
        angle:
          "Our Telegram video downloader saves videos from public Telegram channels and posts as HD MP4 files, or extracts the audio as MP3. Paste the t.me post link and download instantly — no app and no account. Handy for keeping a channel's lecture or tutorial to watch offline.",
        benefit: { title: "Original quality", text: "Saves Telegram videos at full source quality with sound." },
        faqs: [{ q: "How do I download a Telegram video?", a: "Open the public post in Telegram, copy its t.me link, paste it here and tap Download." }],
        secondary: ["download telegram video", "telegram to mp4", "save telegram video", "telegram channel video download"],
      },
    ],
  },
];
