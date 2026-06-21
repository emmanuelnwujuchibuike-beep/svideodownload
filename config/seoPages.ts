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

/* ------------------------------------------------------------------ *
 * Reusable, cross-platform modifiers (templated by {brand}/{thing}).
 * ------------------------------------------------------------------ */

const mHd: SeoModifier = {
  slug: "hd-downloader",
  title: "{brand} HD Video Downloader (1080p)",
  keyword: "{brand} HD downloader",
  tagline: "Download {brand} {thing} in crisp Full HD — free and fast.",
  angle:
    "This {brand} HD downloader saves {thing} at the highest resolution the source provides — up to 1080p and beyond. Rather than a blurry re-encode, you get the original-quality file with sharp detail and full audio, perfect for re-editing, archiving, or watching on a big screen.",
  benefit: { title: "Full-HD quality", text: "Always grabs the best available resolution, up to 1080p and 4K." },
  faqs: [
    { q: "What quality can I download?", a: "Up to the highest the source offers — Full HD and 4K where available. You choose the resolution before saving." },
  ],
  secondary: ["{brand} 1080p downloader", "{brand} full hd download", "download {brand} {thing} hd"],
};

const mMp3: SeoModifier = {
  slug: "mp3-downloader",
  title: "{brand} to MP3 — Audio Downloader",
  keyword: "{brand} to MP3",
  thing: "audio",
  tagline: "Convert any {brand} video to a clean MP3 in seconds.",
  angle:
    "Want just the sound? This {brand} to MP3 converter extracts the audio from any {brand} video and saves it as a clean MP3 file. It's ideal for grabbing a song, a voiceover, a podcast clip or a trending sound to reuse — no video, no watermark, just the audio.",
  benefit: { title: "Clean MP3 audio", text: "Extracts the soundtrack as a portable MP3 at good bitrate." },
  faqs: [
    { q: "How do I convert {brand} to MP3?", a: "Paste the link, tap Download, and choose the Audio (MP3) option — the MP3 saves straight to your device." },
    { q: "Is the MP3 conversion free?", a: "Yes, MP3 extraction is free and unlimited with no account." },
  ],
  secondary: ["{brand} mp3 converter", "{brand} audio downloader", "{brand} song download"],
};

const mMp4: SeoModifier = {
  slug: "mp4-downloader",
  title: "{brand} to MP4 — Video Downloader",
  keyword: "{brand} to MP4",
  tagline: "Save {brand} {thing} as universal MP4 files — plays anywhere.",
  angle:
    "Download {brand} {thing} as standard MP4 files that play on any phone, computer or TV. MP4 is the most compatible video format, so your saved clip works in any player or editor without conversion — and you pick the quality before you download.",
  benefit: { title: "Universal MP4", text: "Saves in the most compatible format — plays on every device." },
  faqs: [
    { q: "What format are downloads in?", a: "Videos download as MP4 (H.264), which plays on virtually every device and editor with no conversion needed." },
  ],
  secondary: ["{brand} mp4 converter", "download {brand} mp4", "save {brand} video mp4"],
};

const mIphone: SeoModifier = {
  slug: "downloader-for-iphone",
  title: "{brand} Downloader for iPhone (iOS)",
  keyword: "{brand} downloader for iPhone",
  tagline: "Save {brand} {thing} on iPhone & iPad — no app needed.",
  angle:
    "Downloading {brand} {thing} on iPhone used to mean installing shady apps. Not anymore — this works right in Safari or Chrome on iOS. Paste the link, tap Download, and the file saves to your Files app or Photos. No App Store install, no jailbreak, and no account.",
  benefit: { title: "Made for iOS", text: "Works in Safari & Chrome on iPhone and iPad — saves to Files or Photos." },
  faqs: [
    { q: "How do I save {brand} {thing} on iPhone?", a: "Open the link in Safari, paste it above, tap Download, then choose Save to Files or Photos. No app required." },
    { q: "Do I need an app from the App Store?", a: "No. Everything runs in your mobile browser, so there's nothing to install." },
  ],
  secondary: ["save {brand} video on iphone", "{brand} downloader ios", "{brand} to camera roll"],
};

const mAndroid: SeoModifier = {
  slug: "downloader-for-android",
  title: "{brand} Downloader for Android",
  keyword: "{brand} downloader for Android",
  tagline: "Download {brand} {thing} on Android — straight to your gallery.",
  angle:
    "Save {brand} {thing} on any Android phone or tablet without installing an APK. Open the link in Chrome, paste it here, and the MP4 downloads directly to your device — ready in your gallery or Downloads folder. It's free, fast and works on Samsung, Pixel, Xiaomi and every other Android brand.",
  benefit: { title: "Android-ready", text: "Downloads straight to your gallery — no APK or sideloading." },
  faqs: [
    { q: "How do I download {brand} {thing} on Android?", a: "Paste the link in Chrome, tap Download and pick your quality — the file saves to your Downloads or gallery." },
    { q: "Do I need to install an APK?", a: "No. It runs entirely in your browser, so there's no APK to sideload." },
  ],
  secondary: ["save {brand} video on android", "{brand} downloader apk free", "{brand} to gallery"],
};

const mPc: SeoModifier = {
  slug: "downloader-for-pc",
  title: "{brand} Downloader for PC & Mac",
  keyword: "{brand} downloader for PC",
  tagline: "Download {brand} {thing} on Windows, Mac & Linux.",
  angle:
    "Use the {brand} downloader on any desktop — Windows, Mac or Linux — right in your browser. There's no software to install or update; paste the link, choose your quality, and the file saves to your Downloads folder. It's perfect for batch-saving clips, editing on a big screen, or archiving in full quality.",
  benefit: { title: "Desktop-friendly", text: "Runs in any browser on Windows, macOS and Linux — no install." },
  faqs: [
    { q: "How do I download {brand} {thing} on a computer?", a: "Paste the link in your browser, tap Download and pick a quality — it saves to your Downloads folder." },
    { q: "Do I need to install a program?", a: "No. It's a web tool, so nothing is installed on your PC or Mac." },
  ],
  secondary: ["{brand} downloader windows", "{brand} downloader mac", "{brand} download laptop"],
};

const mOnline: SeoModifier = {
  slug: "online-downloader",
  title: "{brand} Downloader Online (Free)",
  keyword: "{brand} downloader online",
  tagline: "Download {brand} {thing} online — nothing to install.",
  angle:
    "This is a fully online {brand} downloader: everything happens in your browser and on our servers, so there's nothing to download or install. Paste a link from any device and the {thing} are fetched in seconds. It works the same on mobile and desktop, with no extensions and no sign-up.",
  benefit: { title: "100% online", text: "No software, no extension — just paste a link in your browser." },
  faqs: [
    { q: "Is this {brand} downloader really online?", a: "Yes — it's entirely web-based. There's no app, extension or program to install." },
  ],
  secondary: ["{brand} online video download", "free online {brand} downloader", "{brand} saver online"],
};

const mFree: SeoModifier = {
  slug: "free-downloader",
  title: "Free {brand} Video Downloader",
  keyword: "free {brand} downloader",
  tagline: "A free {brand} downloader — unlimited, no sign-up.",
  angle:
    "Our free {brand} downloader has no hidden costs, no daily limits and no account requirement. Download as many {thing} as you like, in HD or as MP3, completely free. We keep it free by staying lightweight and ad-supported — your downloads are never throttled or paywalled.",
  benefit: { title: "Always free", text: "No subscription, no limits, no credit card — ever." },
  faqs: [
    { q: "Is it really free?", a: "Yes — 100% free and unlimited, with no account or payment required." },
    { q: "Are there download limits?", a: "No daily caps. Download as many {thing} as you want." },
  ],
  secondary: ["free {brand} video download", "{brand} downloader no sign up", "unlimited {brand} downloader"],
};

const mFast: SeoModifier = {
  slug: "fast-downloader",
  title: "Fast {brand} Video Downloader",
  keyword: "fast {brand} downloader",
  tagline: "Download {brand} {thing} in seconds — built for speed.",
  angle:
    "Speed matters. Our {brand} downloader processes links on fast servers and delivers your file in seconds, even for longer or high-resolution {thing}. There are no countdown timers, no forced waits and no multi-step redirects — paste, download, done.",
  benefit: { title: "Seconds, not minutes", text: "Server-side processing with no countdowns or forced waits." },
  faqs: [
    { q: "How fast is the download?", a: "Most {thing} are ready in a few seconds. There are no artificial wait timers." },
  ],
  secondary: ["quick {brand} downloader", "instant {brand} download", "{brand} downloader no wait"],
};

const mSave: SeoModifier = {
  slug: "video-saver",
  title: "{brand} Video Saver — Download Free",
  keyword: "{brand} video saver",
  tagline: "Save {brand} {thing} to your device — free and instant.",
  angle:
    "A {brand} video saver that keeps {thing} on your device for offline viewing. Paste a link and the clip is saved at full quality — no app, no account and no watermark. It's perfect for building a personal archive you can watch anytime, even without internet.",
  benefit: { title: "Offline ready", text: "Keep {thing} saved for offline viewing anytime." },
  faqs: [
    { q: "Where do saved {thing} go?", a: "They download to your device's Downloads, Files or gallery, depending on your browser." },
  ],
  secondary: ["save {brand} video", "{brand} video keeper", "download {brand} offline"],
};

const mWithoutApp: SeoModifier = {
  slug: "downloader-without-app",
  title: "{brand} Downloader Without App",
  keyword: "{brand} downloader without app",
  tagline: "Download {brand} {thing} without installing any app.",
  angle:
    "Skip the app stores — this {brand} downloader works entirely in your browser, so there's nothing to install, update or grant permissions to. It's safer and lighter than a dedicated app and works identically on iPhone, Android and desktop. Just paste a link and download.",
  benefit: { title: "Zero install", text: "No app, no extension, no permissions — just a web page." },
  faqs: [
    { q: "Can I download {brand} {thing} without an app?", a: "Yes — everything runs in your browser, so no app or extension is needed." },
  ],
  secondary: ["{brand} download no app", "{brand} downloader no install", "{brand} web downloader"],
};

const GENERIC: SeoModifier[] = [
  mHd, mMp3, mMp4, mIphone, mAndroid, mPc, mOnline, mFree, mFast, mSave, mWithoutApp,
];

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
      "Save any public TikTok as a clean file in seconds — no app, no account and no watermark added by us.",
      "Paste a TikTok link and download the original, un-branded clip in full quality to your phone or computer.",
      "The fastest way to keep TikToks offline: drop in a link and get the source file, sound intact.",
    ],
    facts: [
      "TikTok's bouncing username watermark is fine for the app but gets in the way when you repost, edit or archive a clip. We fetch the clean source file wherever TikTok provides it, so there's no logo across the frame.",
      "Because everything runs server-side through an advanced extraction engine, even long or high-resolution TikToks process in a couple of seconds — far better quality than a screen recording.",
      "It works everywhere — iPhone, iPad, Android, Windows, Mac and Linux — directly in your browser, with the file saved straight to your device.",
    ],
    baseBenefits: [
      { title: "No watermark", text: "Clean source MP4 with the TikTok logo removed where the platform allows." },
      { title: "HD quality", text: "Download at the original resolution, up to 1080p and beyond." },
      { title: "Any device", text: "iPhone, Android, PC and Mac — right in the browser, no app." },
    ],
    baseFaqs: [
      { q: "Is the TikTok downloader free?", a: "Yes — completely free and unlimited, with no account or sign-up." },
      { q: "Does it remove the TikTok watermark?", a: "Yes. We fetch the clean, watermark-free version wherever TikTok provides it." },
      { q: "Do I need to install an app?", a: "No. Everything runs in your browser, so there's nothing to download." },
      { q: "Is it safe?", a: "Yes — no logins to compromise, no files stored, and encrypted transfers." },
      { q: "Can I download anyone's TikTok?", a: "You can download public TikToks. Only save content you have the right to use, and respect copyright." },
    ],
    modifiers: [
      {
        slug: "video-downloader",
        title: "TikTok Video Downloader (No Watermark, HD)",
        keyword: "TikTok video downloader",
        h1: "TikTok Video Downloader — No Watermark, HD",
        tagline: "Save any TikTok in clean HD — watermark-free — in seconds.",
        angle:
          "Our TikTok video downloader saves any public TikTok as a clean, watermark-free MP4 in full HD, or extracts the audio as MP3. There's nothing to install and no account — paste a link and the original file downloads straight to your device.",
        benefit: { title: "Clean & complete", text: "Original file, full audio, no watermark — ready to repost or edit." },
        faqs: [{ q: "Can I download TikTok videos on iPhone?", a: "Yes — it works in Safari and Chrome on iPhone and iPad; the file saves to Files or Photos." }],
        secondary: ["download tiktok video", "tiktok no watermark", "ssstik alternative"],
      },
      {
        slug: "no-watermark-downloader",
        title: "TikTok No Watermark Downloader",
        keyword: "TikTok no watermark downloader",
        tagline: "Download TikToks with the watermark removed — clean HD files.",
        angle:
          "This TikTok no-watermark downloader pulls the clean source video without the bouncing username or TikTok logo. It's the version creators use to repost across Instagram Reels and YouTube Shorts without a competing stamp — saved in full HD with the original sound.",
        benefit: { title: "Watermark removed", text: "No bouncing username, no logo — a clean canvas for editing." },
        faqs: [{ q: "How do I download a TikTok without the watermark?", a: "Paste the link and download — we automatically fetch the clean, no-watermark version when TikTok provides it." }],
        secondary: ["tiktok watermark remover", "remove tiktok watermark", "tiktok clean download"],
      },
      {
        slug: "photo-downloader",
        title: "TikTok Photo Downloader (Image Posts)",
        keyword: "TikTok photo downloader",
        thing: "photos",
        tagline: "Save TikTok photo posts and image slideshows in full quality.",
        angle:
          "TikTok photo posts (image carousels) can't be saved from the app in full quality — this downloader grabs the original images so you keep every photo crisp. Paste the photo-post link and download the pictures without the watermark or compression.",
        benefit: { title: "Full-res images", text: "Saves every photo from an image post at original quality." },
        faqs: [{ q: "Can I download TikTok photo posts?", a: "Yes. Paste the image-post link and the photos download in full resolution." }],
        secondary: ["tiktok image downloader", "tiktok carousel download", "save tiktok photos"],
      },
      {
        slug: "slideshow-downloader",
        title: "TikTok Slideshow Downloader (Photo + Music)",
        keyword: "TikTok slideshow downloader",
        thing: "slideshows",
        tagline: "Download TikTok photo slideshows with the music included.",
        angle:
          "TikTok slideshows pair photos with a sound. This downloader saves the slideshow so you keep both the images and the music, ready to re-share or remix. No watermark, no app, and the original quality intact.",
        benefit: { title: "Photos + sound", text: "Keeps the slideshow images together with the music track." },
        faqs: [{ q: "Does the slideshow keep its music?", a: "Yes — slideshow downloads include the original sound where TikTok provides it." }],
        secondary: ["tiktok slideshow save", "tiktok photo slideshow download", "tiktok slideshow to video"],
      },
      {
        slug: "sound-downloader",
        title: "TikTok Sound Downloader (MP3)",
        keyword: "TikTok sound downloader",
        thing: "sounds",
        tagline: "Save any TikTok sound or song as a clean MP3.",
        angle:
          "Grab the trending TikTok sound behind a video and save it as an MP3. Whether it's a song, a voice clip or an original audio, this downloader extracts just the sound so you can reuse it, set it as a ringtone, or keep it offline.",
        benefit: { title: "Just the sound", text: "Extracts the TikTok audio as a clean, shareable MP3." },
        faqs: [{ q: "How do I save a TikTok sound?", a: "Paste the video link and choose the Audio (MP3) option to download just the sound." }],
        secondary: ["tiktok audio download", "tiktok song download", "tiktok mp3 sound"],
      },
      {
        slug: "story-downloader",
        title: "TikTok Story Downloader",
        keyword: "TikTok story downloader",
        thing: "Stories",
        tagline: "Save public TikTok Stories before they disappear.",
        angle:
          "TikTok Stories vanish after 24 hours. This downloader saves a public TikTok Story as a video so you can keep it offline. Paste the Story link while it's still live and download the clip in full quality, watermark-free.",
        benefit: { title: "Beat the 24h timer", text: "Save public Stories before they expire from the app." },
        faqs: [{ q: "Can I download a TikTok Story?", a: "Yes, while it's public. Stories expire after 24 hours, so save them while they're still live." }],
        secondary: ["save tiktok story", "tiktok story video download", "download tiktok story"],
      },
      {
        slug: "4k-downloader",
        title: "TikTok 4K Video Downloader",
        keyword: "TikTok 4K downloader",
        tagline: "Download TikToks in the highest quality the source allows.",
        angle:
          "For the sharpest possible copy, this downloader fetches TikToks at the maximum quality the upload provides — up to 4K where available. It's the best choice for editors and anyone who wants a pristine, full-resolution file rather than a compressed re-encode.",
        benefit: { title: "Maximum quality", text: "Pulls the highest resolution the original upload offers." },
        faqs: [{ q: "Can I download TikToks in 4K?", a: "When the original was uploaded in 4K, yes — we always fetch the highest resolution available." }],
        secondary: ["tiktok hd download", "tiktok high quality download", "tiktok 2160p"],
      },
      {
        slug: "profile-video-downloader",
        title: "TikTok Profile Video Downloader",
        keyword: "TikTok profile downloader",
        tagline: "Download videos from any public TikTok profile.",
        angle:
          "Want a specific clip from a creator's page? Paste the video's link from any public TikTok profile and download it in clean HD. It's handy for saving a favourite creator's posts to watch offline or to study for your own content.",
        benefit: { title: "From any profile", text: "Save individual videos from any public creator page." },
        faqs: [{ q: "Can I download videos from a TikTok profile?", a: "Yes — open the specific video on the profile, copy its link, and paste it here to download." }],
        secondary: ["download tiktok profile video", "tiktok creator video download", "save tiktok from profile"],
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
          "Use our Instagram Reels downloader to save Reels as high-quality MP4 files, or extract their audio as MP3. Paste the Reel link — no login, no app — and the original-quality file downloads straight to your device.",
        benefit: { title: "Full-HD Reels", text: "Download Reels at the original resolution, not a blurry copy." },
        faqs: [{ q: "Can I download Instagram Reels on iPhone?", a: "Yes — paste the Reel link in Safari or Chrome and the MP4 saves to Files or Photos." }],
        secondary: ["download instagram reels", "reels to mp4", "save instagram reel"],
      },
      {
        slug: "video-downloader",
        title: "Instagram Video Downloader (HD MP4)",
        keyword: "Instagram video downloader",
        tagline: "Download Instagram feed videos in HD MP4.",
        angle:
          "Save any public Instagram feed video as an HD MP4, or pull the audio as MP3. From single-clip posts to longer videos, you get the original quality file without the app or a login — ideal for archiving and re-sharing.",
        benefit: { title: "Feed & post videos", text: "Works for single videos and multi-clip posts alike." },
        faqs: [{ q: "Can I download a video from an Instagram post?", a: "Yes — copy the post link and paste it here to save the video in HD." }],
        secondary: ["download instagram video", "ig video download", "save instagram video"],
      },
      {
        slug: "story-downloader",
        title: "Instagram Story Downloader",
        keyword: "Instagram story downloader",
        thing: "Stories",
        tagline: "Save public Instagram Stories before they vanish.",
        angle:
          "Instagram Stories disappear after 24 hours. This downloader saves a public Story's video or photo so you can keep it. Paste the Story link while it's live and download it in original quality — no login and no notification to the poster.",
        benefit: { title: "24-hour rescue", text: "Save public Stories in full quality before they expire." },
        faqs: [{ q: "Can I download Instagram Stories anonymously?", a: "You can download public Stories without logging in. Private Stories can't be accessed." }],
        secondary: ["save instagram story", "ig story download", "instagram story video download"],
      },
      {
        slug: "igtv-downloader",
        title: "Instagram IGTV & Long Video Downloader",
        keyword: "IGTV downloader",
        thing: "IGTV videos",
        tagline: "Download long-form Instagram videos and IGTV in HD.",
        angle:
          "Longer Instagram videos and legacy IGTV posts download here as HD MP4 files. Whether it's a tutorial, an interview or a vlog, you keep the full clip in original quality to watch offline or edit — no app and no sign-in.",
        benefit: { title: "Long videos", text: "Handles full-length Instagram videos, not just short clips." },
        faqs: [{ q: "Can I download long Instagram videos?", a: "Yes — paste the video or IGTV link and it downloads as an HD MP4." }],
        secondary: ["download igtv video", "instagram long video download", "igtv to mp4"],
      },
      {
        slug: "photo-downloader",
        title: "Instagram Photo Downloader (Full Size)",
        keyword: "Instagram photo downloader",
        thing: "photos",
        tagline: "Save Instagram photos in full resolution.",
        angle:
          "Download Instagram photos at full size, not the cropped thumbnail you get from a screenshot. Paste a photo-post link and the original image saves cleanly — perfect for moodboards, references or keeping a high-quality copy.",
        benefit: { title: "Full-size photos", text: "Original-resolution images, not a screenshot crop." },
        faqs: [{ q: "How do I save an Instagram photo?", a: "Copy the post link, paste it here, and the full-size photo downloads to your device." }],
        secondary: ["download instagram photo", "ig photo save", "instagram picture download"],
      },
      {
        slug: "carousel-downloader",
        title: "Instagram Carousel Downloader (All Slides)",
        keyword: "Instagram carousel downloader",
        thing: "carousels",
        tagline: "Download every photo and video from a carousel post.",
        angle:
          "Carousel posts pack several photos and videos into one post. This downloader saves every slide in the carousel at once, in full quality, so you don't have to screenshot each one. Paste the post link and grab the whole set.",
        benefit: { title: "All slides", text: "Saves each photo and video from a multi-slide carousel." },
        faqs: [{ q: "Can I download all images in a carousel?", a: "Yes — carousel posts download every slide at full quality." }],
        secondary: ["instagram album download", "ig carousel save", "download instagram multiple photos"],
      },
      {
        slug: "profile-downloader",
        title: "Instagram Profile Video Downloader",
        keyword: "Instagram profile downloader",
        tagline: "Download videos and photos from any public profile.",
        angle:
          "Save individual posts from any public Instagram profile in original quality. Open the specific Reel, video or photo, copy its link, and download it here — great for keeping a creator's content offline or for research.",
        benefit: { title: "From any profile", text: "Save specific posts from any public creator page." },
        faqs: [{ q: "Can I download from a private profile?", a: "No — only public posts can be downloaded. Private accounts stay private." }],
        secondary: ["download instagram profile video", "ig profile download", "save instagram from profile"],
      },
      {
        slug: "audio-downloader",
        title: "Instagram Audio Downloader (Reel to MP3)",
        keyword: "Instagram audio downloader",
        thing: "audio",
        tagline: "Extract the song or sound from any Reel as MP3.",
        angle:
          "Love the audio behind a Reel? This Instagram audio downloader extracts the song or sound and saves it as an MP3. Paste the Reel or video link and choose audio to keep just the track — handy for reusing trending sounds.",
        benefit: { title: "Reel audio as MP3", text: "Pulls the song or sound from a Reel into a clean MP3." },
        faqs: [{ q: "How do I get the audio from an Instagram Reel?", a: "Paste the Reel link and choose the Audio (MP3) option to save just the sound." }],
        secondary: ["instagram reel to mp3", "ig audio download", "instagram song download"],
      },
    ],
  },
  {
    id: "youtube",
    platformId: "youtube",
    brand: "YouTube",
    thing: "videos",
    stem: "youtube",
    intros: [
      "Save YouTube videos and Shorts in HD, or convert them to MP3 — no app, no sign-in.",
      "Paste a YouTube link, pick a quality up to 4K, and download in seconds.",
      "The easy way to keep YouTube content offline, on any device.",
    ],
    facts: [
      "Choose exactly the resolution you want, from compact mobile sizes up to Full HD and 4K where the source provides it — great for watching offline or repurposing clips.",
      "Audio-only is one tap away: convert any video or Short to a clean MP3 for music, podcasts or voiceovers.",
      "It runs in any browser on iPhone, Android, Windows, Mac and Linux, with fast server-side processing even for high-resolution videos.",
    ],
    baseBenefits: [
      { title: "Up to 4K", text: "Pick any quality the source offers, from 360p to HD and 4K." },
      { title: "MP3 conversion", text: "Turn any video or Short into a clean MP3 in one tap." },
      { title: "No sign-in", text: "Download public videos without a Google account." },
    ],
    baseFaqs: [
      { q: "Is the YouTube downloader free?", a: "Yes — completely free with no limits or account." },
      { q: "What quality can I download?", a: "Up to the highest the source offers, including HD and 4K. You choose the resolution first." },
      { q: "Does it work on iPhone and Android?", a: "Yes — directly in your mobile browser, no app required." },
      { q: "Do I need to install software?", a: "No. Everything happens online in your browser." },
      { q: "Is it safe?", a: "Yes — no logins, no stored files and encrypted downloads." },
    ],
    modifiers: [
      {
        slug: "shorts-downloader",
        title: "YouTube Shorts Downloader (HD MP4 / MP3)",
        keyword: "YouTube Shorts downloader",
        thing: "Shorts",
        h1: "YouTube Shorts Downloader — HD MP4 & MP3",
        tagline: "Download YouTube Shorts in HD — free and instant.",
        angle:
          "Our YouTube Shorts downloader saves Shorts as HD MP4 files or converts them to MP3 audio. Paste the Short's URL, pick a quality, and download — no app and no sign-in. It's perfect for saving short-form clips to watch offline or repurpose.",
        benefit: { title: "Shorts & long-form", text: "Works for both YouTube Shorts and standard videos." },
        faqs: [{ q: "Can I convert YouTube Shorts to MP3?", a: "Yes — choose the Audio (MP3) option to save just the sound." }],
        secondary: ["download youtube shorts", "shorts to mp4", "youtube shorts saver"],
      },
      {
        slug: "video-downloader",
        title: "YouTube Video Downloader (HD)",
        keyword: "YouTube video downloader",
        tagline: "Download YouTube videos in HD or 4K — free.",
        angle:
          "Save full-length YouTube videos as HD MP4 files in the resolution you choose, up to 4K. Whether it's a tutorial to watch offline or your own upload to archive, you get a clean file with no sign-in and nothing to install.",
        benefit: { title: "Any resolution", text: "From 360p to 4K — you pick before downloading." },
        faqs: [{ q: "Can I download full YouTube videos?", a: "Yes — paste the video link and choose a quality up to 4K where available." }],
        secondary: ["download youtube video", "youtube to mp4", "save youtube video"],
      },
      {
        slug: "to-mp3-converter",
        title: "YouTube to MP3 Converter (320kbps)",
        keyword: "YouTube to MP3",
        thing: "audio",
        tagline: "Convert YouTube videos and Shorts to MP3 — free.",
        angle:
          "Turn any YouTube video or Short into a clean MP3 with our converter. It's ideal for music, podcasts, lectures or voiceovers you want offline. Paste the link, choose audio, and the MP3 downloads in seconds — no app, no account.",
        benefit: { title: "High-quality audio", text: "Extracts a clean MP3 at the best available bitrate." },
        faqs: [{ q: "How do I convert YouTube to MP3?", a: "Paste the video link and choose the Audio (MP3) option to download the audio." }],
        secondary: ["youtube mp3 converter", "youtube music download", "yt to mp3"],
      },
      {
        slug: "thumbnail-downloader",
        title: "YouTube Thumbnail Downloader (HD)",
        keyword: "YouTube thumbnail downloader",
        thing: "thumbnails",
        tagline: "Download any YouTube video's thumbnail in full HD.",
        angle:
          "Grab the full-resolution thumbnail image from any YouTube video or Short. It's useful for research, references or designing your own thumbnails. Paste the video link and save the HD cover image — free and instant.",
        benefit: { title: "Full-HD cover", text: "Saves the highest-resolution thumbnail available." },
        faqs: [{ q: "How do I download a YouTube thumbnail?", a: "Paste the video link and the HD thumbnail image is available to save." }],
        secondary: ["youtube thumbnail grabber", "download youtube cover image", "yt thumbnail hd"],
      },
      {
        slug: "1080p-downloader",
        title: "YouTube 1080p Downloader (Full HD)",
        keyword: "YouTube 1080p downloader",
        tagline: "Download YouTube videos in Full HD 1080p.",
        angle:
          "Want crisp Full HD? This downloader saves YouTube videos and Shorts in 1080p where the source allows, giving you a sharp, high-quality file without re-encoding. Choose 1080p from the quality list and download straight to your device.",
        benefit: { title: "True 1080p", text: "Saves Full HD where the original supports it." },
        faqs: [{ q: "Can I download YouTube in 1080p?", a: "Yes — pick the 1080p option in the quality list when the source offers it." }],
        secondary: ["youtube full hd download", "download youtube 1080p", "youtube hd video download"],
      },
    ],
  },
  {
    id: "twitter",
    platformId: "twitter",
    brand: "Twitter",
    thing: "videos",
    stem: "twitter",
    intros: [
      "Save videos and GIFs from X (Twitter) in HD — paste a tweet link and download.",
      "Keep any public tweet's video offline in seconds, no X account needed.",
      "The quick way to download X videos, including reposts and quote tweets.",
    ],
    facts: [
      "Our extractor even handles reposted and quoted videos, pulling the original media at its best available quality — so a video buried in a quote tweet still downloads.",
      "Twitter GIFs are technically short videos; we save them as MP4 so they play and share easily everywhere.",
      "Works in every browser on iPhone, Android, Windows and Mac, with quick server-side processing.",
    ],
    baseBenefits: [
      { title: "HD MP4", text: "Download X videos at the highest bitrate the tweet provides." },
      { title: "Reposts & quotes", text: "Grabs video from reposted and quote tweets, not just originals." },
      { title: "No login", text: "Public tweets download without your X password." },
    ],
    baseFaqs: [
      { q: "Is the Twitter / X video downloader free?", a: "Yes — free and unlimited, no account needed." },
      { q: "Can I download videos from reposts?", a: "Yes — we read the original media from reposted and quote tweets." },
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
          "Our Twitter video downloader (now X) saves any public tweet's video as an HD MP4, or extracts the audio as MP3. Paste the tweet link and download instantly — no X account, no app and no watermark. It even handles reposted and quoted videos.",
        benefit: { title: "Highest bitrate", text: "Downloads X videos at the best quality the tweet offers." },
        faqs: [{ q: "Can I save a Twitter GIF?", a: "Yes — Twitter GIFs are saved as MP4 video, which you can convert if needed." }],
        secondary: ["x video downloader", "download twitter video", "twitter to mp4"],
      },
      {
        slug: "gif-downloader",
        title: "Twitter GIF Downloader (X GIF to MP4)",
        keyword: "Twitter GIF downloader",
        thing: "GIFs",
        tagline: "Download Twitter / X GIFs as MP4 video.",
        angle:
          "Twitter GIFs are actually short looping videos. This downloader saves them as MP4 so they play smoothly and share anywhere — paste the tweet link with the GIF and download it in seconds, no login required.",
        benefit: { title: "GIF as MP4", text: "Saves looping X GIFs as compatible MP4 clips." },
        faqs: [{ q: "How do I download a Twitter GIF?", a: "Paste the tweet containing the GIF and download — it saves as an MP4 video." }],
        secondary: ["x gif download", "save twitter gif", "twitter gif to mp4"],
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
      {
        slug: "reels-downloader",
        title: "Facebook Reels Downloader (HD)",
        keyword: "Facebook Reels downloader",
        thing: "Reels",
        tagline: "Save Facebook Reels in HD MP4 — no login.",
        angle:
          "Download Facebook Reels as clean HD MP4 files. Paste the Reel link and save it in the quality you choose, ready to watch offline or re-share. There's no app to install and no Facebook login required.",
        benefit: { title: "Reels in HD", text: "Saves Facebook Reels at the best available quality." },
        faqs: [{ q: "How do I download a Facebook Reel?", a: "Open the Reel, copy its link, paste it here and tap Download." }],
        secondary: ["download facebook reels", "fb reels save", "facebook reel to mp4"],
      },
      {
        slug: "story-downloader",
        title: "Facebook Story Downloader",
        keyword: "Facebook story downloader",
        thing: "Stories",
        tagline: "Save public Facebook Stories before they expire.",
        angle:
          "Facebook Stories last 24 hours. This downloader saves a public Story's video so you can keep it offline. Paste the Story link while it's live and download it in original quality — no login and nothing installed.",
        benefit: { title: "24-hour rescue", text: "Save public Facebook Stories before they expire." },
        faqs: [{ q: "Can I download a Facebook Story?", a: "Yes, while it's public — Stories expire after 24 hours, so save them in time." }],
        secondary: ["save facebook story", "fb story download", "facebook story video"],
      },
      {
        slug: "watch-downloader",
        title: "Facebook Watch Downloader (HD)",
        keyword: "Facebook Watch downloader",
        thing: "Watch videos",
        tagline: "Download Facebook Watch videos in HD MP4.",
        angle:
          "Save longer videos from Facebook Watch as HD MP4 files to view offline. Paste the Watch link, choose HD or SD, and download — perfect for shows, highlights and longer uploads, with no app or login.",
        benefit: { title: "Long-form Watch", text: "Handles longer Facebook Watch videos in HD." },
        faqs: [{ q: "Can I download Facebook Watch videos?", a: "Yes — paste the Watch video link and choose your quality to download." }],
        secondary: ["facebook watch video download", "download fb watch", "facebook watch to mp4"],
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
          "Our Pinterest video downloader saves video pins and idea pins as HD MP4 files, or extracts their audio as MP3. Paste the pin link and download instantly — no Pinterest account, no app and no watermark.",
        benefit: { title: "Full-quality pins", text: "Download video pins at the original source quality." },
        faqs: [{ q: "Can I save the audio only?", a: "Yes — choose the Audio (MP3) option in the preview." }],
        secondary: ["download pinterest video", "pinterest to mp4", "save pinterest video"],
      },
      {
        slug: "idea-pin-downloader",
        title: "Pinterest Idea Pin Downloader",
        keyword: "Pinterest idea pin downloader",
        thing: "idea pins",
        tagline: "Download Pinterest idea pins in full quality.",
        angle:
          "Idea pins are Pinterest's multi-page video stories, and they can't be saved from the app. This downloader grabs the idea pin video so you can keep tutorials, recipes and inspiration offline — paste the link and download in seconds.",
        benefit: { title: "Idea pin video", text: "Saves multi-page idea pin videos that the app won't let you keep." },
        faqs: [{ q: "Can I download Pinterest idea pins?", a: "Yes — paste the idea pin link and the video downloads in full quality." }],
        secondary: ["download idea pin", "pinterest story pin download", "save pinterest idea pin"],
      },
      {
        slug: "image-downloader",
        title: "Pinterest Image Downloader (Full Size)",
        keyword: "Pinterest image downloader",
        thing: "images",
        tagline: "Save Pinterest images in full resolution.",
        angle:
          "Download Pinterest images at original size rather than a compressed preview. Paste a pin link and the full-resolution image saves cleanly — perfect for moodboards, design references and inspiration folders.",
        benefit: { title: "Full-size images", text: "Original-resolution pictures, not a small preview." },
        faqs: [{ q: "How do I save a Pinterest image?", a: "Copy the pin link, paste it here, and the full-size image downloads." }],
        secondary: ["download pinterest image", "save pinterest picture", "pinterest photo download"],
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
        tagline: "Save public Snapchat Stories as clean MP4 video — no login.",
        angle:
          "Our Snapchat Story downloader saves video snaps from public Snapchat profiles and Story links as MP4 files. Paste a profile or Story URL (for example snapchat.com/@username) and download the video without installing the app or logging in.",
        benefit: { title: "Public Stories", text: "Save video snaps from public Snapchat profile Stories." },
        faqs: [{ q: "How do I download a Snapchat Story?", a: "Paste a public profile or Story link (like snapchat.com/@username) and tap Download to save the current video snap." }],
        secondary: ["download snapchat story", "save snapchat story", "snapchat story saver"],
      },
      {
        slug: "spotlight-downloader",
        title: "Snapchat Spotlight Downloader (HD MP4)",
        keyword: "Snapchat Spotlight downloader",
        thing: "Spotlight videos",
        h1: "Snapchat Spotlight Downloader — HD MP4",
        tagline: "Download Snapchat Spotlight videos in HD MP4 — free, no login.",
        angle:
          "Our Snapchat Spotlight downloader saves Spotlight videos as clean HD MP4 files. Paste a Spotlight link — including snapchat.com/t/ share links, which we resolve automatically — and download the clip without the app or an account.",
        benefit: { title: "Share links work", text: "snapchat.com/t/ short links resolve automatically to the real video." },
        faqs: [{ q: "Do Snapchat share links (snapchat.com/t/...) work?", a: "Yes — we automatically resolve /t/ short links to the underlying Spotlight video before downloading." }],
        secondary: ["download snapchat spotlight", "spotlight to mp4", "save spotlight video"],
      },
      {
        slug: "video-downloader",
        title: "Snapchat Video Downloader (MP4)",
        keyword: "Snapchat video downloader",
        tagline: "Download public Snapchat videos as MP4 — no watermark.",
        angle:
          "Save public Snapchat videos — whether from a Story or Spotlight — as clean MP4 files. Paste the link and download in original quality, with no app, no login and no watermark added by us. It works the same on phone and desktop.",
        benefit: { title: "Clean MP4", text: "Saves public Snapchat videos as universal MP4 files." },
        faqs: [{ q: "What Snapchat videos can I download?", a: "Public Story snaps and Spotlight clips. Private snaps can't be accessed." }],
        secondary: ["download snapchat video", "snapchat to mp4", "save snapchat video"],
      },
    ],
  },
];

/** Attach the shared generic modifiers to each cluster (after its specific ones). */
const without = (...slugs: string[]) =>
  GENERIC.filter((m) => !slugs.includes(m.slug));

const GENERIC_BY_CLUSTER: Record<string, SeoModifier[]> = {
  // Drop generics that would overlap a cluster's own specific intent.
  tiktok: without("mp3-downloader", "hd-downloader"), // has sound + 4k pages
  instagram: without("mp3-downloader"), // has audio page
  youtube: without("mp3-downloader", "mp4-downloader", "hd-downloader"), // has to-mp3, video, 1080p
  twitter: GENERIC,
  facebook: GENERIC,
  pinterest: GENERIC,
  snapchat: [mMp4, mIphone, mAndroid, mOnline, mFree, mSave, mWithoutApp],
};

for (const cluster of CLUSTERS) {
  cluster.modifiers = [
    ...cluster.modifiers,
    ...(GENERIC_BY_CLUSTER[cluster.id] ?? []),
  ];
}
