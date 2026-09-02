import type { PlatformId } from "@/types";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PER-PLATFORM ORIGINAL CONTENT — the AdSense "low value content" fix
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-02, after a THIRD rejection: "all my downloader utility pages
 * use duplicate boilerplate text and identical section structures."
 *
 * ── The measurement that justifies this file ─────────────────────────────────
 *
 * Measured across the 82 generated pages, with brand names masked so "the same
 * sentence with a different brand swapped in" counts as shared — which is
 * exactly what a crawler sees:
 *
 *     faqs           90% of instances shared across pages
 *     benefits       87%
 *     descriptions   87%
 *     about text     82%
 *     titles         74%
 *
 * One FAQ ("Does it work on iPhone and Android?") appeared on 29 of 82 pages.
 * That is the shape of Google's scaled-content-abuse policy, and it is the
 * third round of this problem — see the 2026-08-23 audit, which merged 70 thin
 * pages and explicitly left "per-platform ORIGINAL content" undone. This file
 * is that undone piece.
 *
 * ── 🔴 WHY IT IS HAND-WRITTEN AND NOT TEMPLATED ──────────────────────────────
 *
 * The old system's whole idea was one sentence with `{brand}` substituted. That
 * is precisely what was flagged, so nothing here may take a placeholder. Every
 * string below has to be true of ITS platform and false, or meaningless, of the
 * others: Instagram has Reels and Stories and a 24-hour expiry; X converts GIFs
 * to MP4 on upload so there is no GIF to fetch; TikTok's watermark is burned
 * into one rendition and absent from another; Pinterest Idea Pins are
 * multi-page. If a sentence here would read equally well with another brand's
 * name in it, it is the bug this file exists to remove.
 *
 * ── Honesty rules these strings are held to ──────────────────────────────────
 *
 * 🔴 NO CLAIM OF BYPASSING PRIVACY. Nothing here promises private accounts,
 * follower-only posts or someone else's Stories. The 2026-08-23 round already
 * had to rewrite one FAQ for reading that way. Public content only, said
 * plainly, everywhere.
 *
 * 🔴 NO FABRICATED NUMBERS. No "10 million downloads", no speed claims we do
 * not measure. Resolutions are stated as "what the source provides" because
 * that is the actual behaviour.
 */

export interface PlatformStep {
  /** Short imperative label, e.g. "Copy the link". */
  title: string;
  /** What the visitor actually does, in that platform's real UI. */
  text: string;
}

export interface PlatformFeature {
  title: string;
  text: string;
}

export interface PlatformFaq {
  q: string;
  a: string;
}

export interface PlatformContent {
  /** Unique <title>. Never derived from a shared template. */
  title: string;
  /** Unique meta description, under ~158 chars. */
  description: string;
  /** Page H1. */
  heading: string;
  /** One line under the H1. */
  subtitle: string;
  /** Two or three paragraphs about THIS platform's media specifically. */
  intro: string[];
  /** Steps inside the platform's own mobile app. */
  mobileSteps: PlatformStep[];
  /** Steps on the platform's desktop website. */
  desktopSteps: PlatformStep[];
  /** What this tool does for this platform — resolutions, formats, privacy. */
  features: PlatformFeature[];
  /** 4-5 questions that only make sense for THIS platform. */
  faqs: PlatformFaq[];
}

export const PLATFORM_CONTENT: Partial<Record<PlatformId, PlatformContent>> = {
  /* ─────────────────────────────── TikTok ─────────────────────────────── */
  tiktok: {
    title: "TikTok Video Downloader — Save Clips Without the Watermark",
    description:
      "Save public TikTok videos, photo slideshows and sounds. Watermark-free where TikTok serves a clean rendition, in the original resolution.",
    heading: "TikTok Downloader",
    subtitle: "Videos, photo slideshows and sounds — saved at source quality.",
    intro: [
      "TikTok serves the same post in several different renditions, and they are not equal. The one the app plays back has the creator's username and the bouncing TikTok logo burned into the pixels; the one behind the share sheet often does not. This downloader asks for the clean rendition first and only falls back to the stamped one when TikTok does not offer an alternative — which is why the same link can come back watermark-free here and stamped elsewhere.",
      "Photo posts behave differently again. A TikTok slideshow is not a video at all — it is a set of full-resolution JPEGs with a separate audio track, and TikTok stitches them together at playback time. Saving it as a video would re-encode stills into a blurry clip, so slideshows are offered as the original images plus the sound as its own file.",
    ],
    mobileSteps: [
      { title: "Open the post in the TikTok app", text: "Tap the video in your For You feed, a profile, or a search result so it is playing full-screen." },
      { title: "Tap Share, then Copy link", text: "The arrow on the right-hand rail opens the share sheet. \"Copy link\" is in the top row of icons — this is the link that carries the clean rendition." },
      { title: "Paste it here and choose a format", text: "Come back to this page and paste. You will see the watermark-free video where TikTok provides one, plus MP3 if you only want the sound." },
    ],
    desktopSteps: [
      { title: "Open tiktok.com and find the video", text: "Click through to the post's own page so the URL in the address bar ends in /video/ and a long numeric id." },
      { title: "Copy the address bar URL", text: "You do not need the share dialog on desktop — the page URL works. A profile URL will not; it has to be a single post." },
      { title: "Paste and download", text: "Pick the resolution you want. Slideshow posts list each photo separately alongside the audio track." },
    ],
    features: [
      { title: "Watermark-free when available", text: "We request TikTok's clean rendition first. If only the stamped version exists for that post, the page says so rather than pretending." },
      { title: "Slideshows stay photos", text: "Photo posts download as the original JPEGs plus the sound as a separate file — never re-encoded into a video." },
      { title: "Sounds as MP3", text: "Pull just the audio from any public video, useful for identifying a track or reusing a trending sound." },
      { title: "Source resolution", text: "Whatever TikTok holds for that upload, commonly 1080x1920. We do not upscale, and we do not re-encode when a direct file is available." },
      { title: "Public posts only", text: "Anything you can open without logging in. Private accounts and friends-only posts are not accessible and are not attempted." },
      { title: "Nothing is stored", text: "The file streams through to your device. We do not keep a copy of what you download." },
    ],
    faqs: [
      { q: "Why do some TikToks still come back with a watermark?", a: "Because for that particular post TikTok only serves the stamped rendition. The clean version is not something we can generate — it either exists on their servers for that upload or it does not. When it is missing, you get the watermarked file rather than a re-encode that would look worse." },
      { q: "Can I download a TikTok photo slideshow?", a: "Yes, and it comes back as the individual photos rather than a video. A slideshow is stored as separate full-resolution images with an audio track laid over them, so saving it as one clip would mean re-encoding stills and losing quality." },
      { q: "How do I get just the sound from a TikTok?", a: "Paste the video link and choose the MP3 option. This extracts the audio track from that specific post. It is not a music library — it only gives you the sound attached to the link you pasted." },
      { q: "Does it work with a link from the TikTok app's share sheet?", a: "Yes, and that is the recommended route on mobile. The share-sheet link resolves to the post cleanly. Shortened vm.tiktok.com links work too — they are followed automatically." },
      { q: "Can I download from a private TikTok account?", a: "No. If a post requires you to be an approved follower, it is not publicly reachable and this tool cannot fetch it. Only content that loads without signing in will download." },
    ],
  },

  /* ────────────────────────────── Instagram ───────────────────────────── */
  instagram: {
    title: "Instagram Downloader — Reels, Videos, Photos & Carousels",
    description:
      "Download public Instagram Reels, feed videos, photos and full carousels in their original resolution. No app, no login.",
    heading: "Instagram Downloader",
    subtitle: "Reels, feed posts, carousels and profile pictures at full size.",
    intro: [
      "Instagram stores several versions of every upload and the app shows you a compressed one sized for your screen. This downloader asks for the largest rendition Instagram holds, which is usually noticeably sharper than anything you can get by screenshotting or screen-recording — and for photos it is the original JPEG rather than the display copy.",
      "The post type matters more on Instagram than on most platforms. A Reel is a single vertical video; a carousel is up to twenty separate images and videos under one URL; a Story expires after twenty-four hours. Each is handled as what it actually is, so a carousel link gives you every slide as its own file instead of only the first one.",
    ],
    mobileSteps: [
      { title: "Find the post in the Instagram app", text: "Open the Reel, photo or carousel you want. It needs to be on a public account — one you can view while signed out." },
      { title: "Tap the three dots, then Copy link", text: "On a Reel the menu is on the right-hand rail; on a feed post it is at the top-right of the post. Choose \"Copy link\"." },
      { title: "Paste it here", text: "Every slide of a carousel appears separately, so you can take one image or all of them." },
    ],
    desktopSteps: [
      { title: "Open instagram.com and click into the post", text: "Click the post so it opens in its own view and the URL becomes instagram.com/p/... or /reel/..." },
      { title: "Copy the URL from the address bar", text: "A profile URL will not work — it has to point at a specific post." },
      { title: "Paste and pick your files", text: "Choose the resolution for video, or save the photos at their original dimensions." },
    ],
    features: [
      { title: "Reels at source quality", text: "The full-resolution vertical file Instagram holds for that Reel, not the compressed copy the feed plays." },
      { title: "Whole carousels", text: "One link gives you every slide in the post as a separate file, images and videos alike, in order." },
      { title: "Original photos", text: "Feed photos download as the largest JPEG Instagram stores, rather than the smaller display version." },
      { title: "Audio as MP3", text: "Pull the sound out of a Reel when you only need the track or the voiceover." },
      { title: "Public accounts only", text: "Content from private accounts, and Stories you would need to be logged in to see, are not reachable and are not attempted." },
      { title: "No account needed", text: "You never sign in to Instagram here and we never ask for your password." },
    ],
    faqs: [
      { q: "What is the difference between downloading a Reel and a feed video?", a: "Mechanically very little — both are single video files and both download at the best resolution Instagram stores. The practical difference is shape: Reels are vertical 9:16 and feed videos are often 4:5 or square, so the file you get matches how it was uploaded." },
      { q: "Can I download every image in a carousel at once?", a: "Yes. Paste the single post link and each slide is listed separately, in the order they appear in the post. Carousels mix images and videos freely and both types are handled." },
      { q: "Can I download Instagram Stories?", a: "Only Stories on public accounts that are viewable without signing in. Stories from private accounts require being an approved follower, and this tool has no access to them. Stories also disappear after 24 hours, so a link to an expired one will not resolve." },
      { q: "Why is the downloaded photo bigger than what I saw in the app?", a: "Because the app serves a display copy sized for your screen, while this fetches the largest version Instagram kept when the photo was uploaded. It is the same image, just not downscaled for a phone." },
      { q: "Does the person know I downloaded their post?", a: "No. Instagram does not notify anyone about downloads, and nothing about this tool interacts with your account or theirs. It simply fetches a publicly served file." },
    ],
  },

  /* ─────────────────────────────── Twitter ────────────────────────────── */
  twitter: {
    title: "Twitter / X Video Downloader — MP4 and GIF Posts",
    description:
      "Download videos and GIF posts from public tweets on X in the original MP4. Choose the bitrate X served, or extract the audio.",
    heading: "Twitter / X Video Downloader",
    subtitle: "Videos and animated GIFs from public posts, in their real format.",
    intro: [
      "X does not host GIFs. When someone uploads one it is transcoded to a silent, looping MP4 before it ever reaches a timeline, and the little \"GIF\" badge in the corner is a label on a video, not a file format. That is why a GIF post downloads here as an MP4: it is the file that actually exists. If you need a real .gif you will have to convert it afterwards, and you should know you are converting a video, not recovering an original.",
      "For ordinary video posts X encodes several bitrate ladders and serves whichever suits the viewer's connection. This tool lists them so you can take the top rung rather than whatever your network would have been given.",
    ],
    mobileSteps: [
      { title: "Open the post in the X app", text: "Tap the post so it opens on its own page with the video visible." },
      { title: "Tap the share icon, then Copy link", text: "The share arrow sits under the post. Choose \"Copy link\" — this gives a URL ending in /status/ and a numeric id." },
      { title: "Paste it here", text: "Pick the bitrate you want. GIF posts appear as MP4, which is what X actually stores." },
    ],
    desktopSteps: [
      { title: "Open the post on x.com", text: "Click the timestamp of the post so it opens as its own page rather than in the timeline." },
      { title: "Copy the address bar URL", text: "It should contain /status/ followed by the post id. Both x.com and twitter.com links work." },
      { title: "Paste and choose a rendition", text: "The available bitrates are listed highest first." },
    ],
    features: [
      { title: "Every bitrate X encoded", text: "Instead of whatever your connection would have been served, you pick from the full ladder X produced for that post." },
      { title: "GIF posts, honestly labelled", text: "So-called GIFs download as the silent looping MP4 X actually stores. We do not fake a .gif by re-encoding it." },
      { title: "Audio extraction", text: "Save just the sound from a video post as an MP3 when the audio is the part you want." },
      { title: "Both domains", text: "twitter.com and x.com links resolve identically, including old bookmarked URLs." },
      { title: "Public posts only", text: "Protected accounts require an approved follower, so their media is not reachable here." },
      { title: "No sign-in", text: "You never connect an X account and no credentials are involved at any point." },
    ],
    faqs: [
      { q: "Why does a GIF download as an MP4?", a: "Because that is the only file X has. Animated GIFs are converted to silent looping MP4 at upload time, so there is no .gif on their servers to fetch. Handing you an MP4 is giving you the actual asset; converting it back to GIF would make a larger, lower-quality file out of a video." },
      { q: "How do I choose the video quality?", a: "X encodes several bitrates for each video and this page lists them, highest first. The top entry is the best X produced for that upload — there is no higher-quality master to request." },
      { q: "Can I download a video from a protected account?", a: "No. Protected posts are only visible to approved followers, so they are not publicly served and cannot be fetched. Only posts you can see while signed out will work." },
      { q: "Do old twitter.com links still work?", a: "Yes. Links on either twitter.com or x.com resolve the same way, so bookmarks and older shared URLs do not need updating." },
      { q: "Can I save just the audio from a video post?", a: "Yes, choose the MP3 option after pasting. Note that GIF posts have no audio track at all — X strips it during conversion — so there is nothing to extract from those." },
    ],
  },

  /* ─────────────────────────────── Facebook ───────────────────────────── */
  facebook: {
    title: "Facebook Video Downloader — Reels, Watch and Feed Videos",
    description:
      "Download public Facebook videos, Reels and Watch clips in HD or SD. Paste a post, Watch or share link and pick your quality.",
    heading: "Facebook Video Downloader",
    subtitle: "Feed videos, Reels and Watch clips from public pages and posts.",
    intro: [
      "Facebook links come in more shapes than any other platform here. The same video might reach you as facebook.com/watch/?v=, as a /videos/ path on a Page, as an fb.watch short link from the share sheet, or as a /reel/ URL — and a share link often carries tracking parameters that make it look nothing like the canonical address. All of these resolve to the same post, and all of them are accepted.",
      "Facebook usually keeps two renditions of a video: an HD encode and a smaller SD one. Which the app plays depends on your connection, so the copy you watched is not necessarily the best available. Both are listed here so the choice is yours.",
    ],
    mobileSteps: [
      { title: "Find the video in the Facebook app", text: "It has to be on a public Page or a post shared publicly — if you can only see it because of your friend list, it is not reachable." },
      { title: "Tap the three dots, then Copy link", text: "The menu is at the top-right of the post. On Reels it is on the right-hand rail. This produces an fb.watch or facebook.com link." },
      { title: "Paste it here and choose HD or SD", text: "Both renditions are listed when Facebook has both." },
    ],
    desktopSteps: [
      { title: "Open the video on facebook.com", text: "Click the post's timestamp or the video itself so it opens on its own page." },
      { title: "Copy the URL from the address bar", text: "Any of the /watch/, /videos/ or /reel/ forms work, with or without the tracking parameters Facebook appends." },
      { title: "Paste and download", text: "Pick HD where it exists, or extract the audio as MP3." },
    ],
    features: [
      { title: "Every link shape", text: "fb.watch short links, /watch/?v=, Page /videos/ paths and /reel/ URLs all resolve, tracking parameters included." },
      { title: "HD and SD listed", text: "Facebook keeps two encodes for most videos. You choose, rather than being given whatever your connection would have loaded." },
      { title: "Reels supported", text: "Facebook Reels are vertical video posts and download as the full-resolution file, the same as feed videos." },
      { title: "Audio as MP3", text: "Extract the soundtrack from any public video when you only need the audio." },
      { title: "Public content only", text: "Videos limited to friends, or inside private groups, are not publicly served and are not attempted." },
      { title: "No login, nothing stored", text: "You never connect a Facebook account, and the file is streamed to your device rather than kept." },
    ],
    faqs: [
      { q: "Which Facebook link formats work?", a: "All the common ones: fb.watch share links, facebook.com/watch/?v=, a Page's /videos/ path, and /reel/ URLs. Tracking parameters that Facebook appends to shared links are harmless and can be left on." },
      { q: "Why is only SD offered for some videos?", a: "Because Facebook only encoded one rendition for that upload. Older videos and lower-resolution originals often have no HD version on their servers, and we would rather show you what exists than upscale an SD file and call it HD." },
      { q: "Can I download a video from a private Facebook group?", a: "No. Group content and friends-only posts are not publicly served, so they cannot be fetched. Only videos that load for a signed-out visitor will download." },
      { q: "Can I download Facebook Reels?", a: "Yes. Reels are ordinary vertical video posts as far as the file is concerned, and they download at the full resolution Facebook holds, using the same /reel/ link you copy from the share menu." },
      { q: "Does the uploader see that I downloaded it?", a: "No. Facebook gives page owners view and engagement statistics, but nothing that identifies a download, and this tool does not interact with your account or theirs." },
    ],
  },

  /* ─────────────────────────────── Pinterest ──────────────────────────── */
  pinterest: {
    title: "Pinterest Downloader — Video Pins, Idea Pins and Images",
    description:
      "Save Pinterest video Pins, multi-page Idea Pins and images at original resolution. Paste a Pin link or a pin.it short URL.",
    heading: "Pinterest Downloader",
    subtitle: "Video Pins, Idea Pins and full-resolution images.",
    intro: [
      "A Pinterest board shows you thumbnails, and a thumbnail is a long way from the file behind it. Pinterest keeps the uploaded original — often several times larger than what the grid displays — and this downloader asks for that rather than the preview you were looking at. For image Pins that difference is usually the difference between something you can print and something you cannot.",
      "Idea Pins are the awkward case. They are not one video but a sequence of pages, each of which can be a video or a still, sometimes with its own audio. Treating one as a single file would flatten it, so each page is offered separately.",
    ],
    mobileSteps: [
      { title: "Open the Pin in the Pinterest app", text: "Tap the Pin so it fills the screen. It needs to be on a public board." },
      { title: "Tap the share icon, then Copy link", text: "This gives you a pin.it short link, which works here — it is followed to the real Pin automatically." },
      { title: "Paste it here", text: "Idea Pins list each page separately so you can take one or all of them." },
    ],
    desktopSteps: [
      { title: "Open the Pin on pinterest.com", text: "Click the Pin so it opens in its own view with a /pin/ URL and a numeric id." },
      { title: "Copy the address bar URL", text: "A board URL will not work — it has to point at a single Pin." },
      { title: "Paste and save", text: "Images come back at their original upload dimensions." },
    ],
    features: [
      { title: "Original image size", text: "Not the board thumbnail — the full-resolution file as uploaded, which is frequently several times larger." },
      { title: "Idea Pins page by page", text: "Each page of a multi-page Idea Pin is offered as its own file rather than flattened into one clip." },
      { title: "Video Pins in full", text: "Video Pins download at the resolution Pinterest stores, with audio intact." },
      { title: "pin.it links resolve", text: "The short links the mobile share sheet produces are followed automatically to the real Pin." },
      { title: "Public Pins only", text: "Secret boards are visible only to their owner and collaborators, so their Pins are not reachable here." },
      { title: "No Pinterest account", text: "You do not sign in and nothing is linked to a Pinterest profile." },
    ],
    faqs: [
      { q: "Why is the downloaded image larger than the one on the board?", a: "Because the board shows a generated thumbnail sized for the grid, while this fetches the original the pinner uploaded. For photography and print-quality graphics that is often a very large difference." },
      { q: "How do Idea Pins download?", a: "As separate files, one per page. An Idea Pin is a sequence — each page can be a video or a still with its own audio — so combining them would mean re-encoding and losing the structure. Each page is listed so you can take what you need." },
      { q: "Do pin.it short links work?", a: "Yes. The Pinterest mobile app produces pin.it links when you tap Share, and they are followed automatically to the underlying Pin. You do not need to open it in a browser first." },
      { q: "Can I download an entire board at once?", a: "No. This works on a single Pin at a time — a board URL does not resolve to a file. You would paste each Pin you want individually." },
      { q: "Can I save Pins from a secret board?", a: "No. Secret boards are visible only to their owner and invited collaborators, so their Pins are not publicly served and cannot be fetched." },
    ],
  },

  /* ─────────────────────────────── Threads ────────────────────────────── */
  threads: {
    title: "Threads Video Downloader — Save Videos and Images",
    description:
      "Download videos and images from public Threads posts at full resolution. Paste a threads.net or threads.com post link.",
    heading: "Threads Downloader",
    subtitle: "Videos and images from public Threads posts.",
    intro: [
      "Threads shares Meta's media infrastructure with Instagram, which means the file behind a Threads post is stored and served much the way an Instagram post is — but the posts themselves behave differently. A single Threads post can carry several images and videos together, and replies in a thread are separate posts with their own media and their own URLs.",
      "That has a practical consequence worth knowing before you paste: a link to the top of a conversation gives you that post's media only. If the video you want is in a reply, open the reply itself and copy its link, or you will get the wrong file.",
    ],
    mobileSteps: [
      { title: "Open the post in the Threads app", text: "Tap the specific post — not just the conversation — so it is the one on screen." },
      { title: "Tap the share icon, then Copy link", text: "The paper-plane icon under the post. Copy link gives a /post/ URL for that exact entry." },
      { title: "Paste it here", text: "Every image and video attached to that post is listed separately." },
    ],
    desktopSteps: [
      { title: "Open the post on threads.com", text: "Click the post's timestamp so it opens on its own page with a /post/ path." },
      { title: "Copy the address bar URL", text: "Both threads.net and threads.com links resolve. A profile URL will not — it must be a single post." },
      { title: "Paste and download", text: "Choose the video resolution, or save the images at full size." },
    ],
    features: [
      { title: "Every attachment", text: "A post carrying several images and videos lists all of them separately, in the order they appear." },
      { title: "Replies handled individually", text: "Each reply is its own post with its own link, so you can target the exact media in a long conversation." },
      { title: "Full-resolution media", text: "The largest rendition Threads stores, rather than the copy sized for your screen." },
      { title: "Both domains", text: "threads.net and threads.com links work identically, including older shared URLs." },
      { title: "Public posts only", text: "Threads accounts can be private; those posts are not publicly served and are not attempted." },
      { title: "No account required", text: "Threads accounts are tied to Instagram logins. You do not connect either one here." },
    ],
    faqs: [
      { q: "I pasted a thread link but got the wrong video — why?", a: "Because a conversation link points at the top post, and each reply is a separate post with its own media. Open the specific reply containing the video you want, copy that link, and paste it instead." },
      { q: "Can one Threads post contain more than one video?", a: "Yes. A post can carry several attachments, images and videos mixed, and all of them are listed separately after you paste so you can pick individually." },
      { q: "Do threads.net links still work now the domain is threads.com?", a: "Yes. Both resolve to the same post, so older bookmarks and previously shared links do not need updating." },
      { q: "Can I download from a private Threads account?", a: "No. If the account is private its posts are visible only to approved followers and are not publicly served, so there is nothing for this tool to fetch." },
      { q: "Is the quality the same as Instagram's?", a: "Broadly yes — Threads uses Meta's media pipeline, so a video uploaded to Threads is stored and served much as an Instagram post is, and you get the largest rendition available rather than the display copy." },
    ],
  },

  /* ─────────────────────────────── Snapchat ───────────────────────────── */
  snapchat: {
    title: "Snapchat Downloader — Spotlight Clips and Public Stories",
    description:
      "Save public Snapchat Spotlight videos and public Story snaps at source quality. Paste a Spotlight or public profile link.",
    heading: "Snapchat Downloader",
    subtitle: "Spotlight clips and publicly shared Stories.",
    intro: [
      "Almost everything on Snapchat is designed to disappear, and most of it is genuinely unreachable — a snap sent to you personally exists for its recipients and nobody else. What is publicly served is Spotlight, Snapchat's open feed, and Stories that a creator has published publicly. Those are the two things this tool handles, and it is worth being clear that it handles nothing else.",
      "Public Stories are sequences rather than single files. A creator's Story is a run of separate snaps, each with its own duration, and each is offered individually so you take the one you actually want rather than a concatenation.",
    ],
    mobileSteps: [
      { title: "Open the Spotlight clip or public Story", text: "In the Snapchat app, find the Spotlight video or the publicly published Story you want." },
      { title: "Tap the share icon, then Copy link", text: "Snapchat produces a snapchat.com link. Personal snaps have no such link, which is the clearest sign they are not public." },
      { title: "Paste it here", text: "For a Story, each snap in the sequence is listed separately." },
    ],
    desktopSteps: [
      { title: "Open snapchat.com and find the content", text: "Spotlight clips and public profiles are browsable on the web without signing in." },
      { title: "Copy the URL from the address bar", text: "It will contain /spotlight/ or the public profile path." },
      { title: "Paste and download", text: "Snaps come back at the resolution Snapchat serves them." },
    ],
    features: [
      { title: "Spotlight clips", text: "Snapchat's public feed is fully reachable, and clips download at the resolution served." },
      { title: "Public Stories, snap by snap", text: "Each snap in a public Story is offered separately rather than joined into one file." },
      { title: "Source quality", text: "Whatever Snapchat serves for that clip — we do not re-encode when a direct file is available." },
      { title: "No account, ever", text: "You never sign in to Snapchat. Nothing here touches your account or your friends list." },
      { title: "Public content only", text: "Snaps sent to individuals, private Stories and My Eyes Only are not publicly served and cannot be fetched." },
      { title: "Nothing retained", text: "The file passes through to your device; we do not keep a copy." },
    ],
    faqs: [
      { q: "Can I download a snap somebody sent me?", a: "No, and this is worth being direct about: a snap sent to you personally is delivered to your account and is not publicly served, so there is nothing for this tool to fetch. Only Spotlight clips and publicly published Stories are reachable." },
      { q: "Will the creator know I saved their Spotlight video?", a: "Snapchat notifies people about screenshots of snaps in a private chat. Spotlight is a public feed and this tool does not interact with your account at all, so there is no screenshot event and nothing tied to you." },
      { q: "How does a public Story download?", a: "As separate files, one per snap. A Story is a sequence of individual snaps with their own durations, so each is listed on its own rather than stitched into a single video you would have to cut apart." },
      { q: "Why did my Snapchat link stop working?", a: "Most likely the content expired. Stories are removed after their window passes, and once Snapchat stops serving a snap there is nothing left to fetch. Spotlight clips are more durable but can also be deleted by the creator." },
      { q: "Do I need the Snapchat app installed?", a: "No. If you have a public link you can paste it here from any browser. The app is only useful for finding the content and copying its link in the first place." },
    ],
  },

  /* ──────────────────────────────── Reddit ────────────────────────────── */
  reddit: {
    title: "Reddit Video Downloader — With Audio, Properly Merged",
    description:
      "Download Reddit videos with the sound included. Reddit stores video and audio separately; we merge them into one MP4.",
    heading: "Reddit Video Downloader",
    subtitle: "Videos from public subreddits, with the audio actually attached.",
    intro: [
      "Reddit's own video hosting stores the picture and the sound as two entirely separate files. That is why so many saved Reddit videos turn out silent: whatever grabbed them took the video stream and never fetched the audio that goes with it. This downloader retrieves both and merges them into a single MP4, which is the whole reason it is worth using for Reddit specifically.",
      "Not every Reddit post is hosted by Reddit, though. A large share are links out to other sites, and a post that merely points somewhere else has no v.redd.it file behind it. Those are handled by fetching from wherever the media actually lives, when that source is one we support.",
    ],
    mobileSteps: [
      { title: "Open the post in the Reddit app", text: "Tap into the post itself so the video is playing, rather than staying in the subreddit feed." },
      { title: "Tap Share, then Copy link", text: "This gives a reddit.com/r/.../comments/ link. A shortened redd.it link works too." },
      { title: "Paste it here", text: "The video and its audio are merged before the file reaches you." },
    ],
    desktopSteps: [
      { title: "Open the post on reddit.com", text: "Click the post title so it opens on its own comments page." },
      { title: "Copy the address bar URL", text: "Both old.reddit.com and www.reddit.com links resolve, as do direct v.redd.it URLs." },
      { title: "Paste and download", text: "You get a single MP4 with the sound already attached." },
    ],
    features: [
      { title: "Audio merged in", text: "Reddit stores video and sound separately. Both are fetched and combined, so the file is not silent." },
      { title: "Every URL form", text: "reddit.com, old.reddit.com, short redd.it links and direct v.redd.it URLs all resolve." },
      { title: "Crossposts followed", text: "A crosspost points at the original submission; we follow it to the actual media." },
      { title: "Externally hosted posts", text: "Many Reddit posts link elsewhere. Where that destination is a platform we support, the media is fetched from there." },
      { title: "Public subreddits only", text: "Private and approved-only subreddits are not publicly served and cannot be fetched." },
      { title: "No login", text: "You never connect a Reddit account and no credentials are involved." },
    ],
    faqs: [
      { q: "Why are Reddit videos silent when I save them elsewhere?", a: "Because Reddit hosts the video and the audio as two separate files, and tools that only grab the video stream produce a silent clip. This downloader fetches both and merges them into one MP4, which is the main reason to use it for Reddit links." },
      { q: "Does it work if the post links to another site?", a: "It depends where. A large share of Reddit posts are links out rather than Reddit-hosted video, and there is no v.redd.it file behind those. If the destination is a platform supported here, the media is fetched from there instead." },
      { q: "Can I download from a private subreddit?", a: "No. Private and approved-only subreddits are not publicly served, so their posts cannot be fetched. Only content visible to a signed-out visitor will work." },
      { q: "Do old.reddit.com links work?", a: "Yes. Old Reddit, new Reddit, short redd.it links and direct v.redd.it URLs all resolve to the same submission." },
      { q: "What happens with a crosspost?", a: "It is followed to the original submission, which is where the media actually lives. You do not need to hunt down the source post yourself." },
    ],
  },

  /* ──────────────────────────────── Vimeo ─────────────────────────────── */
  vimeo: {
    title: "Vimeo Video Downloader — Public Videos in Full Quality",
    description:
      "Download public Vimeo videos at the resolution the creator published, up to 4K where available. Or extract the audio.",
    heading: "Vimeo Downloader",
    subtitle: "Public Vimeo videos at the quality they were published in.",
    intro: [
      "Vimeo is where people put work they care about the look of, and it encodes accordingly — higher bitrates than most social platforms, and often a 2K or 4K rendition where the source justified it. This downloader lists the renditions Vimeo actually produced for a given video so you can take the top one rather than a screen-sized copy.",
      "Vimeo also gives creators real control over distribution, and that control is meaningful here. Password-protected videos, private links and domain-restricted embeds are deliberate choices by the person who uploaded them, and none of them are publicly served. Only videos that play for a signed-out visitor can be fetched.",
    ],
    mobileSteps: [
      { title: "Open the video in the Vimeo app or a browser", text: "It needs to be a public video — one that plays without a password or a sign-in." },
      { title: "Tap Share, then copy the link", text: "This gives a vimeo.com URL ending in the numeric video id." },
      { title: "Paste it here", text: "Available resolutions are listed highest first." },
    ],
    desktopSteps: [
      { title: "Open the video on vimeo.com", text: "Go to the video's own page so the URL is vimeo.com followed by its numeric id." },
      { title: "Copy the address bar URL", text: "Player embed URLs on other sites also resolve where the video itself is public." },
      { title: "Paste and choose a resolution", text: "Take the highest rendition, or extract the audio as MP3." },
    ],
    features: [
      { title: "Up to 4K where it exists", text: "Vimeo encodes high-resolution renditions when the source supports it, and all of them are listed." },
      { title: "High bitrate preserved", text: "Vimeo's encodes are less aggressively compressed than most social platforms, and the file is passed through rather than re-encoded." },
      { title: "Audio as MP3", text: "Extract the soundtrack when you only need the audio — useful for talks and interviews." },
      { title: "Embed links resolve", text: "A player URL from a site that embeds the video works, provided the video itself is public." },
      { title: "Public videos only", text: "Password-protected, private-link and domain-restricted videos are deliberately not public and are not attempted." },
      { title: "Respect the licence", text: "Much of Vimeo is professional work under explicit copyright. Downloading does not grant you rights to reuse it." },
    ],
    faqs: [
      { q: "Can I download a password-protected Vimeo video?", a: "No. A password is the uploader restricting who may watch, and the video is not publicly served as a result. The same applies to private-link and domain-restricted videos. Only videos that play for a signed-out visitor can be fetched." },
      { q: "What resolutions are available?", a: "Whatever Vimeo encoded for that specific upload, listed highest first — commonly up to 1080p, and 2K or 4K when the creator uploaded a source that justified it. There is no higher master to request beyond what Vimeo produced." },
      { q: "Why does Vimeo look better than the same video elsewhere?", a: "Vimeo compresses less aggressively than most social platforms, so its encodes hold more detail at the same resolution. Since the file is passed through rather than re-encoded, that quality survives the download." },
      { q: "Can I use a Vimeo video I downloaded in my own project?", a: "Downloading a file and having the right to reuse it are separate things. A great deal of Vimeo is professional work under full copyright, so you would need permission or an appropriate licence from the creator regardless of how you obtained the file." },
      { q: "Does an embedded player link work?", a: "Yes, where the underlying video is public. Embed URLs resolve to the same video, so you can paste the player link from a site that has embedded it." },
    ],
  },

  /* ─────────────────────────────── LinkedIn ───────────────────────────── */
  linkedin: {
    title: "LinkedIn Video Downloader — Posts, Articles and Live Replays",
    description:
      "Download videos from public LinkedIn posts at source quality, or extract the audio from a talk or interview as MP3.",
    heading: "LinkedIn Video Downloader",
    subtitle: "Videos from public posts, without connecting an account.",
    intro: [
      "LinkedIn video is mostly talks, demos, interviews and conference clips — material people genuinely want to keep and refer back to rather than watch once. It is also material where the audio often matters more than the picture, which is why extracting an MP3 is a first-class option here rather than an afterthought.",
      "Visibility is the thing to check before pasting. LinkedIn lets a poster choose between public and connections-only, and the distinction is invisible once you are signed in — a post can look perfectly normal to you and be unreachable to everyone else. If it does not load in a private browsing window, it is not public and cannot be fetched.",
    ],
    mobileSteps: [
      { title: "Open the post in the LinkedIn app", text: "Tap into the post itself so the video is on screen." },
      { title: "Tap the three dots, then Copy link to post", text: "This gives a linkedin.com/posts/ or /feed/update/ URL." },
      { title: "Paste it here", text: "Choose the video, or take just the audio as MP3." },
    ],
    desktopSteps: [
      { title: "Open the post on linkedin.com", text: "Click the post's timestamp so it opens on its own page rather than in the feed." },
      { title: "Copy the address bar URL", text: "Both /posts/ and /feed/update/ forms resolve." },
      { title: "Paste and download", text: "Pick the resolution, or extract the audio." },
    ],
    features: [
      { title: "Source-quality video", text: "The best rendition LinkedIn holds for that upload, rather than the copy sized for your feed." },
      { title: "Audio as MP3", text: "Talks and interviews are often worth keeping as audio alone, and the extraction is a single choice after pasting." },
      { title: "Post and feed URLs", text: "Both /posts/ and /feed/update/ link forms resolve to the same content." },
      { title: "No account connected", text: "You never sign in to LinkedIn and no professional profile is linked to anything you download." },
      { title: "Public posts only", text: "Connections-only posts are not publicly served. If it does not load signed out, it cannot be fetched." },
      { title: "Nothing stored", text: "The file streams to your device and no copy is retained." },
    ],
    faqs: [
      { q: "How do I tell whether a LinkedIn post is public?", a: "Open the link in a private browsing window where you are not signed in. If the video plays, it is public and will download. If LinkedIn asks you to sign in, the poster limited it to connections and it cannot be fetched." },
      { q: "Can I download just the audio from a talk?", a: "Yes, choose the MP3 option after pasting. LinkedIn video is disproportionately talks, interviews and panels, where the audio is often the part worth keeping, so it is offered directly rather than buried." },
      { q: "Does the poster see that I downloaded their video?", a: "No. LinkedIn shows posters view counts and who engaged with a post, but nothing that records a download, and this tool never touches your account or theirs." },
      { q: "Which LinkedIn link formats work?", a: "Both the /posts/ form you get from Copy link to post and the /feed/update/ form the desktop site sometimes shows in the address bar. Either resolves to the same post." },
      { q: "Can I download a LinkedIn Learning video?", a: "No. LinkedIn Learning is paid, subscriber-only content behind an authenticated paywall, which is not publicly served and is not something this tool attempts." },
    ],
  },

  /* ─────────────────────────────── Telegram ───────────────────────────── */
  telegram: {
    title: "Telegram Video Downloader — Public Channel Media",
    description:
      "Download videos and files posted in public Telegram channels. Paste a t.me link to a specific message.",
    heading: "Telegram Downloader",
    subtitle: "Media from public channels, by message link.",
    intro: [
      "Telegram's public channels are effectively web pages: anyone with the link can read them without an account, and the media in them is served openly. That is the part this tool works with. A t.me link that points at a specific message in a public channel resolves to the file attached to it.",
      "Private groups, one-to-one chats and channels that require an invite are a different matter entirely. They are not publicly served, and nothing here attempts to reach them — no account is connected, no session is borrowed, and there is no mechanism by which a private conversation could be fetched.",
    ],
    mobileSteps: [
      { title: "Open the message in a public channel", text: "In the Telegram app, find the specific message carrying the video or file." },
      { title: "Tap the message, then Copy Link", text: "This produces a t.me link ending in the channel name and the message number." },
      { title: "Paste it here", text: "The attached media is fetched at the quality it was posted." },
    ],
    desktopSteps: [
      { title: "Open the channel on t.me or Telegram Web", text: "Public channels have a web preview that works without signing in." },
      { title: "Copy the message link", text: "Right-click the message and choose Copy Message Link, or take the t.me URL from the address bar." },
      { title: "Paste and download", text: "The file comes back as it was uploaded." },
    ],
    features: [
      { title: "Original file, uncompressed", text: "Telegram often carries media as an uncompressed file rather than a re-encode, so what you get is what was posted." },
      { title: "Message-level links", text: "A t.me link pointing at a specific message resolves to that message's attachment." },
      { title: "Large files supported", text: "Telegram permits far larger uploads than most social platforms, and those are handled." },
      { title: "Public channels only", text: "Private groups, direct chats and invite-only channels are not publicly served and are not attempted." },
      { title: "No account borrowed", text: "Nothing here signs into Telegram on your behalf or uses your session to reach anything." },
      { title: "Nothing retained", text: "The file passes through to your device without being stored." },
    ],
    faqs: [
      { q: "Can I download from a private Telegram group or a direct chat?", a: "No. Those are not publicly served, and this tool has no access to them — no account is connected and no session is used. Only messages in public channels, which anyone can read without signing in, can be fetched." },
      { q: "What does a Telegram message link look like?", a: "It is a t.me URL with the channel's name and the message number, produced by Copy Link on mobile or Copy Message Link on desktop. A link to the channel as a whole will not resolve to a file — it has to point at a specific message." },
      { q: "Why is Telegram media often better quality?", a: "Because Telegram frequently carries media as an uncompressed file rather than re-encoding it the way social feeds do. When that is the case, what you download is the original the uploader posted." },
      { q: "Can I download very large files?", a: "Generally yes. Telegram allows much larger uploads than most platforms, and large files are supported, though a very large one naturally takes longer to transfer." },
      { q: "Do I need a Telegram account?", a: "No. Public channels are readable on the web without one, and pasting a public message link here does not involve an account at any point." },
    ],
  },
};

/** The platform content for a page, when one has been written. */
export function platformContentFor(platformId: PlatformId): PlatformContent | undefined {
  return PLATFORM_CONTENT[platformId];
}
