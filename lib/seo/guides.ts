/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  PUBLIC GUIDES — Frenz AI explainers, Kling, and advertising (SEO, 2026-10-09)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief, 2026-10-09: a complete, accurate SEO system for Frenz AI, Kling
 * and advertising. This file is the ONE content source for those pages: route,
 * title, description, H1, body, FAQs, related links, the CTA, the product
 * capability the page depends on and the date its content last really changed.
 * The sitemap, the pages and the tests all read it.
 *
 * ── 🔴 WHY /frenz-ai AND NOT /ai ──────────────────────────────────────────────
 *
 * `/ai/**` are the TOOLS themselves: noindex, gated by the operator's public
 * switch and the middleware, and they load the generation code. The standing
 * rule (2026-09-09) that kept AI out of search was about those utility pages,
 * and it still holds for them (lib/ai/ai-pages-not-indexed.test.ts). These
 * explainers are a separate, static, read-only surface: no generation code, no
 * account, no request on view — the CTA hands the visitor to the real tool,
 * which keeps every one of its own access rules.
 *
 * ── 🔴 THE TRUTH RULE, APPLIED TO COPY ────────────────────────────────────────
 *
 *   · a tool page exists only for a Product Genome entry at stage "live"
 *     (lib/content/genome/registry.ts) — `capability` names it and a test checks;
 *   · model names come from the integration's own constants (Kling 3.0 Omni =
 *     `kling-v3-omni`); a test fails if the integration moves and the copy did not;
 *   · prices, resolutions and allowances are ADMIN settings — pages explain how
 *     pricing works and that the exact price is shown before anything is charged,
 *     never a number that could go stale;
 *   · Character Replace is retired (lib/ai/character-replace/submit.ts) — no page
 *     offers character replacement or face swap as a working tool;
 *   · Kling 4.0 was announced (late Sept 2026) and is not integrated — it is
 *     described as an announcement, never as something Frenz AI runs;
 *   · no audience sizes, rankings, testimonials or guaranteed results.
 */

export type GuideSection = "frenz-ai" | "advertise";

/** What a page's claims rest on — checked by lib/seo/guides.test.ts. */
export type GuideCapability =
  | { kind: "genome"; id: string }
  | { kind: "kling" }
  | { kind: "advertising" }
  | { kind: "tutorial" };

export interface GuideBlock {
  h2: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
}

export interface Guide {
  /** the page's own path — also its canonical */
  path: string;
  section: GuideSection;
  title: string;
  description: string;
  h1: string;
  /** the opening paragraph under the H1 */
  intro: string;
  /** the search intent this page answers (documentation for editors) */
  intent: string;
  capability: GuideCapability;
  /** the last MEANINGFUL content change — the sitemap's lastModified */
  updated: string;
  blocks: GuideBlock[];
  faqs: { q: string; a: string }[];
  related: string[];
  cta: { href: string; label: string };
  /** a tutorial is marked up as an Article */
  article?: boolean;
  /** advertising pages that show the live price/format islands */
  live?: "pricing" | "formats";
}

const UPDATED = "2026-10-09";

const CREDITS_NOTE =
  "Frenz AI runs on one credit balance shared by every tool. You can top up, or get a daily allowance with an AI plan. The exact price of a creation depends on the tool, its length and its quality, and it is shown before you confirm — nothing is charged until you do.";

export const GUIDES: readonly Guide[] = [
  /* ─────────────────────────────── Frenz AI hub ─────────────────────────────── */
  {
    path: "/frenz-ai",
    section: "frenz-ai",
    title: "Frenz AI — AI video, lip sync and voice tools | Frenzsave",
    description: "What Frenz AI can make: text-to-video and image-to-video with Kling 3.0 Omni, lip sync, natural text-to-speech and voice cloning — how each works and what it costs.",
    h1: "Frenz AI: create videos, voices and lip sync",
    intro:
      "Frenz AI is the creative studio inside Frenzsave. It turns a written idea or a photo into a short video, makes a face in a video speak new words, reads text aloud in a natural voice and builds a voice of your own from a recording you have the rights to. This page explains each tool in plain words, so you know what to expect before you open it.",
    intent: "AI video generator, AI creative tools, what Frenz AI does",
    capability: { kind: "tutorial" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What you can make",
        bullets: [
          "Text to video — describe a scene and get a short video clip.",
          "Image to video — bring a photo to life, optionally guided by more reference photos or a motion reference video.",
          "Lip sync — make a face in your video speak your own audio or typed words.",
          "Text to speech — turn a script into a natural voiceover, saved to your audio library.",
          "Voice cloning — a voice of your own, made from a short recording you have permission to use.",
        ],
      },
      {
        h2: "How it works",
        steps: [
          "Choose a tool and add what it needs: a prompt, a photo, a video or a script.",
          "Pick the options the tool offers, such as length, shape and quality.",
          "Check the price shown for that exact request, then confirm.",
          "Your creation is made in the background. It appears in your library when it is ready, and you can download it.",
        ],
      },
      { h2: "Credits and plans", paragraphs: [CREDITS_NOTE, "When a complimentary creation is on offer for new accounts, it is limited to a short, standard-quality clip and applies once per device."] },
      {
        h2: "Rules that keep it safe",
        paragraphs: [
          "Only use photos, videos and voices you own or have permission to use. Voice cloning asks you to confirm consent before anything is made. Creations that impersonate real people to deceive, or that break the law or Frenzsave's rules, are not allowed.",
        ],
      },
    ],
    faqs: [
      { q: "Do I need an account to use Frenz AI?", a: "You can read these guides without one. Creating uses your credits, so the tools ask you to sign in when you start — your choices are kept." },
      { q: "Which AI model makes the videos?", a: "Text to video and image to video use Kling 3.0 Omni, a video model from Kuaishou's Kling AI, called directly by Frenz AI. Frenzsave is not affiliated with Kling." },
      { q: "How long does a video take?", a: "It depends on the length and quality you choose and on how busy the model is. Creations run in the background, so you can leave the page and come back to your library." },
      { q: "Can I replace a character or swap a face in a video?", a: "Not at the moment. Frenz AI's earlier character replacement tool has been retired, and Frenz AI does not offer face swapping." },
    ],
    related: ["/frenz-ai/text-to-video", "/frenz-ai/image-to-video", "/frenz-ai/lip-sync", "/frenz-ai/kling-ai", "/frenz-ai/ai-video-prompts"],
    cta: { href: "/ai", label: "Open Frenz AI" },
  },

  /* ─────────────────────────────── tools ─────────────────────────────── */
  {
    path: "/frenz-ai/text-to-video",
    section: "frenz-ai",
    title: "AI text to video generator — Kling 3.0 Omni | Frenz AI",
    description: "Turn a written prompt into a short AI video with Kling 3.0 Omni in Frenz AI: lengths from 3 to 15 seconds, wide, tall or square, with optional native audio.",
    h1: "Text to video with Kling 3.0 Omni",
    intro:
      "Describe a scene in words and Frenz AI turns it into a short video. The video is made by Kling 3.0 Omni, which Frenz AI calls directly. You choose the length and shape, see the price, and the clip arrives in your library when it is ready.",
    intent: "text to video, AI video generator from text, Kling text to video",
    capability: { kind: "genome", id: "text-to-video" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What you can set",
        bullets: [
          "Length: 3 to 15 seconds. A longer one-minute option appears only when it is switched on.",
          "Shape: wide (16:9), tall (9:16) for Reels and Stories, or square (1:1).",
          "Quality: the resolutions your plan offers, shown in the tool with their price.",
          "Sound: native audio generated with the video, on plans that include it.",
          "Your prompt: up to 2,500 characters.",
        ],
      },
      {
        h2: "Step by step",
        steps: [
          "Open Text to Video in Frenz AI.",
          "Write what happens: the subject, the action, the setting, the light and the camera.",
          "Choose the length, the shape and the quality.",
          "Check the price shown and confirm.",
          "Watch and download the clip from your library when it is ready.",
        ],
      },
      {
        h2: "Tips for better results",
        bullets: [
          "Describe one clear moment rather than a whole story — a clip is seconds long.",
          "Name the camera: a slow push-in, a handheld follow, a static wide shot.",
          "Say what should stay still. Fewer moving parts means fewer glitches.",
          "Start short. A 5-second test costs less than a 15-second clip and shows you whether the prompt works.",
        ],
      },
      { h2: "Price", paragraphs: [CREDITS_NOTE] },
    ],
    faqs: [
      { q: "How long can a text-to-video clip be?", a: "From 3 to 15 seconds. A one-minute option is offered only when Frenzsave has it switched on, and its price is shown separately." },
      { q: "Can the video have sound?", a: "Yes, on plans that include native audio: Kling generates the sound with the picture. You can also turn sound off." },
      { q: "Who owns the videos I make?", a: "They are yours to use within Frenzsave's terms and the law. Don't use them to impersonate or deceive people." },
    ],
    related: ["/frenz-ai/image-to-video", "/frenz-ai/ai-video-prompts", "/frenz-ai/kling-ai", "/frenz-ai/lip-sync"],
    cta: { href: "/ai/text-to-video", label: "Open Text to Video" },
  },
  {
    path: "/frenz-ai/image-to-video",
    section: "frenz-ai",
    title: "Image to video AI — animate a photo with Kling | Frenz AI",
    description: "Animate a photo with Kling 3.0 Omni in Frenz AI. Add up to seven reference images, or follow the motion of a reference video, and describe what should happen.",
    h1: "Image to video: bring a photo to life",
    intro:
      "Start from a photo and Frenz AI animates it into a short video with Kling 3.0 Omni. The photo becomes the opening frame. You describe what should happen, and you can add reference images to keep details right, or a reference video whose movement the clip should follow.",
    intent: "image to video, animate a photo with AI, Kling image to video, motion reference video",
    capability: { kind: "genome", id: "image-to-video" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What you need",
        bullets: [
          "One clear photo — the first frame of your video.",
          "A prompt describing the movement, such as \"she turns toward the camera and smiles\".",
          "Optional: up to seven reference images (four when you also add a reference video) to hold faces, clothing or objects steady.",
          "Optional: a motion reference video. The new clip follows its movement; it is never copied into the result.",
        ],
      },
      {
        h2: "Step by step",
        steps: [
          "Open Image to Video in Frenz AI and add your photo.",
          "Describe the motion and the camera.",
          "Add reference images or a motion reference video if you want them.",
          "Choose the length (3 to 15 seconds), shape and quality, and check the price.",
          "Confirm, then download the clip from your library when it is ready.",
        ],
      },
      {
        h2: "Getting the motion right",
        bullets: [
          "Pick a photo with room to move: a subject cut off at the frame edge can't turn or walk convincingly.",
          "Keep the motion reference simple — one person, one clear action, a steady camera.",
          "A reference video is billed for its own length too, so trim it to the moment you need.",
        ],
      },
      { h2: "Price", paragraphs: [CREDITS_NOTE] },
    ],
    faqs: [
      { q: "What photos work best?", a: "Sharp, well-lit photos where the subject is clearly visible. Very small or heavily compressed images give weaker results." },
      { q: "Can I copy the movement from another video?", a: "Yes — add it as a motion reference video. The clip follows its movement while keeping your photo's subject and look. Use footage you have the right to use." },
      { q: "Will the person keep the same face?", a: "Reference images help a great deal. See our guide to keeping a character consistent for practical steps." },
    ],
    related: ["/frenz-ai/character-consistency", "/frenz-ai/text-to-video", "/frenz-ai/ai-video-prompts", "/frenz-ai/kling-ai"],
    cta: { href: "/ai/image-to-video", label: "Open Image to Video" },
  },
  {
    path: "/frenz-ai/lip-sync",
    section: "frenz-ai",
    title: "AI lip sync — make a video speak new words | Frenz AI",
    description: "Lip sync in Frenz AI: upload a video with a visible face and add audio or typed text. The video is kept and the mouth is re-animated to match the speech.",
    h1: "Lip sync: make a face in your video speak",
    intro:
      "Lip sync keeps your video as it is and re-animates the speaker's mouth so it matches new speech. Give it your own audio, or type the words and pick a voice. It is useful for dubbing, short explainers and fixing a line without reshooting.",
    intent: "AI lip sync, lip sync video online, dub a video with AI",
    capability: { kind: "genome", id: "lip-sync" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What you need",
        bullets: [
          "A video in which one face is clearly visible and roughly facing the camera.",
          "The speech: an audio file, or typed text with a chosen voice and speed.",
          "The right to use both the video and the voice.",
        ],
      },
      {
        h2: "Step by step",
        steps: [
          "Open Lip Sync in Frenz AI and add your video.",
          "Add your audio, or type the words and choose a voice.",
          "Check the price for your clip's length and confirm.",
          "Download the synced video from your library when it is ready.",
        ],
      },
      {
        h2: "For a convincing result",
        bullets: [
          "Choose footage where the mouth is unobstructed — no hands, microphones or heavy shadow in front of it.",
          "Match the speech length to the clip length.",
          "Clean audio without music or background noise syncs better.",
        ],
      },
      { h2: "Price", paragraphs: [CREDITS_NOTE] },
    ],
    faqs: [
      { q: "Which model does the lip sync?", a: "Frenz AI runs lip sync on a specialist lip-sync model. Frenzsave chooses the engine and may change it to improve quality; the price is always shown before you confirm." },
      { q: "Can I use someone else's voice?", a: "Only with their permission. To use your own voice, create it first with Voice Cloning." },
    ],
    related: ["/frenz-ai/text-to-speech", "/frenz-ai/voice-cloning", "/frenz-ai/text-to-video"],
    cta: { href: "/ai/lip-sync", label: "Open Lip Sync" },
  },
  {
    path: "/frenz-ai/text-to-speech",
    section: "frenz-ai",
    title: "AI text to speech — natural voiceovers | Frenz AI",
    description: "Turn a script into a natural-sounding voiceover with Frenz AI's text to speech. Choose a voice, generate audio and keep it in your audio library.",
    h1: "Text to speech: natural voiceovers from a script",
    intro:
      "Paste or write a script, choose a voice, and Frenz AI reads it aloud. Each voiceover is saved to your audio library, ready to download or to use with Lip Sync. Frenz AI's speech is generated with ElevenLabs.",
    intent: "AI text to speech, AI voiceover generator, text to audio",
    capability: { kind: "genome", id: "text-to-audio" },
    updated: UPDATED,
    blocks: [
      {
        h2: "Step by step",
        steps: [
          "Open Text to Audio in Frenz AI.",
          "Write or paste your script.",
          "Choose a voice — a ready-made one, or your own cloned voice.",
          "Check the price, which depends on the length of the text, and confirm.",
          "Play, download or reuse the audio from your library.",
        ],
      },
      {
        h2: "Writing for the ear",
        bullets: [
          "Write short sentences. Long ones lose the listener and the rhythm.",
          "Spell out numbers and abbreviations the way they should be said.",
          "Use punctuation for pauses: a comma for a breath, a full stop for a beat.",
        ],
      },
      { h2: "Price", paragraphs: [CREDITS_NOTE, "Text to speech is priced by the number of characters, and plans may include free characters."] },
    ],
    faqs: [
      { q: "Can I use the audio in my videos?", a: "Yes. Download it, or use it directly as the speech for Lip Sync." },
      { q: "Can it speak in my voice?", a: "Yes, once you've made your voice with Voice Cloning." },
    ],
    related: ["/frenz-ai/voice-cloning", "/frenz-ai/lip-sync", "/frenz-ai"],
    cta: { href: "/ai/text-to-audio", label: "Open Text to Audio" },
  },
  {
    path: "/frenz-ai/voice-cloning",
    section: "frenz-ai",
    title: "AI voice cloning — create your own voice | Frenz AI",
    description: "Create a voice of your own in Frenz AI from a short recording you have the rights to, with consent confirmed, then use it for voiceovers and lip sync.",
    h1: "Voice cloning: a voice of your own",
    intro:
      "Voice cloning makes a reusable voice from a short recording of you, or of someone who has given you permission. Once it is ready, you can choose it in Text to Audio and Lip Sync. Frenz AI asks you to confirm consent before a voice is made, and keeps that record.",
    intent: "AI voice cloning, clone my voice, custom AI voice",
    capability: { kind: "genome", id: "voice-cloning" },
    updated: UPDATED,
    blocks: [
      {
        h2: "Step by step",
        steps: [
          "Open Voice Cloning in Frenz AI.",
          "Record or upload a clean sample of the voice.",
          "Confirm that it is your voice, or that you have the speaker's permission.",
          "Check the price and confirm. The voice appears in your voices list when it is ready.",
        ],
      },
      {
        h2: "A better sample",
        bullets: [
          "Record in a quiet room, close to the microphone.",
          "Speak naturally, at your normal pace, with no music behind you.",
          "Use only your own voice — one speaker per sample.",
        ],
      },
      { h2: "Consent comes first", paragraphs: ["Cloning a voice without permission is not allowed. You can delete a voice you made at any time from your voices list."] },
      { h2: "Price", paragraphs: [CREDITS_NOTE] },
    ],
    faqs: [
      { q: "Can I clone a celebrity's voice?", a: "No. You may only clone your own voice, or a voice whose owner has given you permission." },
      { q: "Where can I use my cloned voice?", a: "In Text to Audio and in Lip Sync, inside Frenz AI." },
    ],
    related: ["/frenz-ai/text-to-speech", "/frenz-ai/lip-sync", "/frenz-ai"],
    cta: { href: "/ai/voice-cloning", label: "Open Voice Cloning" },
  },

  /* ─────────────────────────────── Kling ─────────────────────────────── */
  {
    path: "/frenz-ai/kling-ai",
    section: "frenz-ai",
    title: "Kling AI in Frenz AI — Kling 3.0 Omni and the announced Kling 4.0",
    description: "How Frenz AI uses Kling 3.0 Omni for text-to-video and image-to-video, what the Kling 3.0 family added, what is known about Kling 4.0, and what Frenz AI does not offer.",
    h1: "Kling AI: what Frenz AI uses, and what it doesn't",
    intro:
      "Kling AI is a family of video generation models made by Kuaishou. Frenz AI calls one of them, Kling 3.0 Omni, directly for its text-to-video and image-to-video tools. This page sets out exactly what that means for you, how the Kling versions differ, and which Kling features are not part of Frenz AI. Frenzsave is not affiliated with or endorsed by Kling or Kuaishou.",
    intent: "Kling AI, Kling 3.0, Kling 3.0 Omni, Kling 4.0, Kling character replacement",
    capability: { kind: "kling" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What Frenz AI runs on Kling",
        bullets: [
          "Text to Video — Kling 3.0 Omni, 3 to 15 seconds, wide, tall or square, with optional native audio.",
          "Image to Video — Kling 3.0 Omni, with your photo as the opening frame, up to seven reference images, or a motion reference video.",
          "Lip Sync — one of the lip-sync engines Frenz AI can use is Kling's own lip-sync model.",
        ],
      },
      {
        h2: "The Kling 3.0 family",
        paragraphs: [
          "Kling AI announced the 3.0 series on 5 February 2026: Video 3.0, Video 3.0 Omni, Image 3.0 and Image 3.0 Omni. The announcement highlighted better consistency and realism, clips of up to 15 seconds, native audio, and — for Video 3.0 Omni — generation guided by reference material, plus multi-shot storyboards.",
          "Frenz AI uses Video 3.0 Omni because it reads reference images and reference video in one request, which is what makes image-to-video with references possible.",
        ],
      },
      {
        h2: "Kling 4.0",
        paragraphs: [
          "Kuaishou announced Kling 4.0 at the end of September 2026, with a lighter Flash version in limited early access and the full model announced for October. Reports describe longer clips and more reference inputs, but the full specifications, pricing and developer access had not been published when this page was written.",
          "Frenz AI does not offer Kling 4.0. If that changes, this page and the tools will say so.",
        ],
      },
      {
        h2: "What Frenz AI does not offer",
        bullets: [
          "Character replacement or face swapping in an existing video — not offered; the earlier character replacement tool is retired.",
          "Kling's own editor, storyboards or Elements library — not offered; those live in Kling's own app.",
          "Any Kling model not listed above.",
        ],
      },
      {
        h2: "Kling inside Frenz AI, or Kling's own app?",
        paragraphs: [
          "Kling's own app offers the full range of Kling features on Kling's plans. Frenz AI gives you selected Kling-powered tools alongside lip sync and voice tools, on one Frenzsave credit balance, with every creation saved to your Frenzsave library. Choose whichever fits how you work.",
        ],
      },
    ],
    faqs: [
      { q: "Is Frenzsave an official Kling partner?", a: "No. Frenzsave is not affiliated with, endorsed by or partnered with Kling AI or Kuaishou. Frenz AI is a customer of Kling's developer API." },
      { q: "Can I use Kling 4.0 in Frenz AI?", a: "No. Kling 4.0 is not part of Frenz AI." },
      { q: "Can Frenz AI replace a character in my video with Kling?", a: "No. Frenz AI does not offer character replacement or face swapping." },
    ],
    related: ["/frenz-ai/text-to-video", "/frenz-ai/image-to-video", "/frenz-ai/ai-video-prompts", "/frenz-ai/character-consistency"],
    cta: { href: "/ai/text-to-video", label: "Try Kling 3.0 Omni in Frenz AI" },
  },

  /* ─────────────────────────────── tutorials ─────────────────────────────── */
  {
    path: "/frenz-ai/ai-video-prompts",
    section: "frenz-ai",
    title: "How to write AI video prompts that work — with examples",
    description: "A practical guide to writing AI video prompts: subject, action, setting, light and camera, with example prompts, common mistakes and fixes for glitchy results.",
    h1: "How to write AI video prompts that work",
    intro:
      "A video model can only make what your prompt makes clear. This guide shows a simple structure for prompts, gives examples you can adapt, and explains why clips glitch and how to fix them. It applies to text-to-video and image-to-video in Frenz AI, and to most video models.",
    intent: "how to write AI video prompts, prompt examples, reduce AI video glitches",
    capability: { kind: "tutorial" },
    updated: UPDATED,
    article: true,
    blocks: [
      {
        h2: "A structure that works",
        paragraphs: ["Write the prompt in this order. Each part answers a question the model would otherwise guess at."],
        steps: [
          "Subject — who or what, described by what is visible: \"a woman in a yellow raincoat\".",
          "Action — one clear movement: \"walks toward the camera, then stops\".",
          "Setting — where and when: \"a wet city street at night\".",
          "Light and mood — \"neon reflections, soft rain\".",
          "Camera — \"slow dolly in, eye level, shallow depth of field\".",
        ],
      },
      {
        h2: "Example prompts",
        bullets: [
          "\"A golden retriever runs along a beach at sunset, waves breaking behind it, low tracking shot, warm light.\"",
          "\"Close-up of hands pouring latte art into a white cup, steam rising, soft window light, static camera.\"",
          "\"A paper boat drifts down a rain gutter, slow push-in, overcast daylight, shallow depth of field.\"",
        ],
      },
      {
        h2: "Why clips glitch — and the fix",
        bullets: [
          "Too many actions in one clip → keep one main action per clip.",
          "Hands, text and small details warp → keep them out of focus, or out of frame.",
          "Faces drift between frames → use image-to-video with a clear photo and reference images.",
          "Busy crowds smear → fewer subjects and a simpler background.",
          "Fast camera moves tear the image → slow, single camera moves.",
        ],
      },
      {
        h2: "Work in small steps",
        paragraphs: [
          "Test a prompt at the shortest length first. When it looks right, make the longer, higher-quality version. Changing one thing at a time tells you which change helped.",
        ],
      },
    ],
    faqs: [
      { q: "How long should a prompt be?", a: "Usually one to three sentences. Longer prompts are allowed, but clarity matters more than length." },
      { q: "Should I describe what I don't want?", a: "State what you do want instead. \"A still lake\" works better than \"no waves\"." },
    ],
    related: ["/frenz-ai/text-to-video", "/frenz-ai/image-to-video", "/frenz-ai/character-consistency", "/frenz-ai/kling-ai"],
    cta: { href: "/ai/text-to-video", label: "Try a prompt in Text to Video" },
  },
  {
    path: "/frenz-ai/character-consistency",
    section: "frenz-ai",
    title: "Keep a character consistent across AI video clips",
    description: "How to keep the same face, clothes and look across several AI video clips: start from a photo, add reference images, reuse your wording and keep scenes simple.",
    h1: "How to keep a character consistent across AI video clips",
    intro:
      "When you make several clips of the same person or mascot, small changes add up: a different jaw, a new jacket, another hair colour. This guide shows how to keep a character looking the same from one clip to the next, using image-to-video and reference images.",
    intent: "AI character consistency, same character in AI video, consistent face AI video",
    capability: { kind: "tutorial" },
    updated: UPDATED,
    article: true,
    blocks: [
      {
        h2: "1. Start from a photo, not from words",
        paragraphs: ["Text alone lets the model reinvent the character every time. Image-to-video starts each clip from your photo, so the character begins in the same place."],
      },
      {
        h2: "2. Add reference images",
        bullets: [
          "A clear front view of the face.",
          "A full-length view that shows the clothes.",
          "A close-up of anything distinctive: a logo, a hat, glasses.",
        ],
        paragraphs: ["Image to Video accepts up to seven reference images, or four when you also add a motion reference video."],
      },
      {
        h2: "3. Reuse the same description",
        paragraphs: ["Keep one fixed sentence that describes the character — \"a man in his thirties with a short beard, navy jacket and white trainers\" — and paste it unchanged into every prompt. Change only the action and the setting."],
      },
      {
        h2: "4. Keep each scene simple",
        bullets: [
          "One character per clip where you can.",
          "Similar lighting from clip to clip.",
          "Avoid extreme angles and very fast motion — that is where faces drift.",
        ],
      },
      {
        h2: "5. Check before you scale up",
        paragraphs: ["Make a short test of each new scene first. If the character drifts, add a closer reference image or simplify the action before making the full-length version."],
      },
    ],
    faqs: [
      { q: "Can I put my character into an existing video?", a: "Frenz AI doesn't offer character replacement. You can make new clips of your character with image-to-video, and copy the movement from a video with a motion reference." },
    ],
    related: ["/frenz-ai/image-to-video", "/frenz-ai/ai-video-prompts", "/frenz-ai/kling-ai"],
    cta: { href: "/ai/image-to-video", label: "Open Image to Video" },
  },

  /* ─────────────────────────────── advertising ─────────────────────────────── */
  {
    path: "/advertise/pricing",
    section: "advertise",
    title: "Advertising prices on Frenzsave — formats, places and durations",
    description: "How Frenzsave ad prices work: the format, the placement and the number of days set the price, promotions apply automatically, and you see the exact total before paying.",
    h1: "Frenzsave advertising prices",
    intro:
      "Frenzsave ads are priced per campaign. You choose a format, where it appears and how many days it runs, and the price for that combination is shown before you pay. The prices below are the current ones, read live from Frenzsave's settings.",
    intent: "advertising campaign pricing, how much does it cost to advertise, affordable online advertising",
    capability: { kind: "advertising" },
    updated: UPDATED,
    live: "pricing",
    blocks: [
      {
        h2: "What sets the price",
        bullets: [
          "The format: a banner, a full-screen ad or a video.",
          "The placement: where on Frenzsave it shows.",
          "The duration: how many days the campaign runs.",
          "Any promotion running at the time, such as a discount or bonus days, applied automatically.",
        ],
      },
      {
        h2: "What you pay",
        paragraphs: [
          "The total shown at checkout is the price you are charged. It is fixed for your campaign once paid: later price changes don't affect a campaign you have already bought. You pay on a secure checkout page from Frenzsave's payment partner, and nothing is charged until you confirm there.",
        ],
      },
      {
        h2: "Running longer",
        paragraphs: ["A live campaign can be extended. You pay only for the extra days, at the price shown, and the end date moves once the payment is confirmed."],
      },
    ],
    faqs: [
      { q: "Is there a minimum spend?", a: "There is no separate minimum. The smallest campaign is the shortest duration offered for a placement, at its listed price." },
      { q: "Which currency will I pay in?", a: "Frenzsave sets a price for each currency it accepts, and the currency you pay in is shown with the total at checkout before you confirm." },
    ],
    related: ["/advertise", "/advertise/banner-ads", "/advertise/video-ads", "/advertise/campaign-guide"],
    cta: { href: "/advertise/create", label: "Start a campaign" },
  },
  {
    path: "/advertise/banner-ads",
    section: "advertise",
    title: "Banner ads on Frenzsave — placements and requirements",
    description: "Run an image or short-video banner on Frenzsave: at the top of pages, in the Feed and Reels, on download pages and in History. Placements, rules and how to start.",
    h1: "Banner advertising on Frenzsave",
    intro:
      "Banner ads sit inside the page, alongside what people are doing on Frenzsave: downloading, scrolling the Feed, watching Reels or browsing their History. You upload one image or short video, choose where it shows, and it rotates with other advertisers in that place.",
    intent: "banner advertising, display ads, place a banner ad online",
    capability: { kind: "advertising" },
    updated: UPDATED,
    live: "formats",
    blocks: [
      {
        h2: "Where banners appear",
        bullets: [
          "The top banner, across the site.",
          "Inside the Feed and Reels.",
          "On the download page and the download result.",
          "In the History grid and among Stories.",
          "Every place at once, with the All slots package.",
        ],
        paragraphs: ["The places open for booking right now, with their sizes and prices, are listed below."],
      },
      {
        h2: "What makes a good banner",
        bullets: [
          "One message and one clear action.",
          "Text big enough to read on a phone.",
          "A link to a page that matches the ad.",
          "Images are resized to fit each slot without cropping, so keep important content away from the edges.",
        ],
      },
      {
        h2: "How views are counted",
        paragraphs: ["A view counts once, when at least half of your ad stays on screen for a full second. Clicks, details opened and visits to your link are reported separately in your campaign dashboard, and traffic filtered as invalid is never counted."],
      },
    ],
    faqs: [
      { q: "Can I use a video in a banner?", a: "Yes, a short video where the format allows it. It plays muted, and the size and length limits are shown when you upload." },
      { q: "Will my banner be the only ad there?", a: "No. Each place rotates the live campaigns booked for it, so several advertisers share it." },
    ],
    related: ["/advertise/pricing", "/advertise/video-ads", "/advertise/campaign-guide", "/advertise/rules"],
    cta: { href: "/advertise/create", label: "Create a banner ad" },
  },
  {
    path: "/advertise/video-ads",
    section: "advertise",
    title: "Video and full-screen ads on Frenzsave — including reward videos",
    description: "Full-screen and video ads on Frenzsave: after a download completes, when someone returns to the app, and sponsor and reward videos. How they show and the rules.",
    h1: "Video and full-screen ads on Frenzsave",
    intro:
      "Full-screen ads appear at natural pauses: right after a download finishes, when someone comes back to the app, or as a sponsor video beside a saved AI creation. They can be an image or a video, and they can always be closed.",
    intent: "video advertising, rewarded video ads, interstitial ads, video ad placement",
    capability: { kind: "advertising" },
    updated: UPDATED,
    live: "formats",
    blocks: [
      {
        h2: "The full-screen moments",
        bullets: [
          "Download completed — shown after a file has finished downloading, never over the save button.",
          "Welcome back — when someone returns to Frenzsave after a short time away, at most once in a set interval.",
          "Sponsor video — beside an AI video save that has already started. It never blocks the save.",
          "Reward videos — offered before an HD or batch download for people who choose to watch.",
        ],
      },
      {
        h2: "Never a trap",
        bullets: [
          "The close button is there from the first frame.",
          "Videos play muted and stop when closed.",
          "A video counts as watched to the end only when it really reaches the end.",
        ],
      },
      {
        h2: "Making a video that works",
        bullets: [
          "Show your product in the first two seconds.",
          "Design for no sound — add captions or on-screen text.",
          "Upload common formats such as MP4 or MOV; the video is converted for every device.",
        ],
      },
    ],
    faqs: [
      { q: "What is a reward video ad?", a: "A video someone chooses to watch to unlock an HD or batch download. Your ad is shown to people who opted in, and a completion is counted only when the video plays to the end." },
      { q: "How often are full-screen ads shown?", a: "Each moment has a minimum gap set by Frenzsave, so the same person doesn't see one over and over." },
    ],
    related: ["/advertise/pricing", "/advertise/banner-ads", "/advertise/campaign-guide", "/advertise/rules"],
    cta: { href: "/advertise/create", label: "Create a video ad" },
  },
  {
    path: "/advertise/campaign-guide",
    section: "advertise",
    title: "How to run an ad campaign on Frenzsave — step-by-step guide",
    description: "A step-by-step guide to promoting your business, app or website on Frenzsave: choose a placement, prepare your ad, pay, go live after checks, and read the results.",
    h1: "How to run an ad campaign on Frenzsave",
    intro:
      "This guide walks through a Frenzsave campaign from start to finish, whether you are promoting a shop, an app, a website or a service. Everything here is self-service: you can set up a campaign in a few minutes and manage it yourself.",
    intent: "how to advertise a business online, promote your app, promote your website, run an online ad campaign",
    capability: { kind: "advertising" },
    updated: UPDATED,
    blocks: [
      {
        h2: "What you can promote",
        paragraphs: ["Businesses, apps, websites, online shops, services, events and creators — anything legal that follows the Advertising Rules. Every ad links to a destination you choose, and that link is checked."],
      },
      {
        h2: "The steps",
        steps: [
          "Choose a format and where it appears.",
          "Name your campaign and choose how many days it runs.",
          "Upload your image or video, and add a headline, a short description and your link. You see a live preview.",
          "Review the price and the Advertising Rules.",
          "Pay on the payment partner's secure checkout.",
          "Once the payment is confirmed, automated validation and safety checks run on your ad and its link.",
          "If everything passes, your campaign goes live automatically. If something needs a closer look, it is reviewed and you are told why.",
        ],
      },
      {
        h2: "After launch",
        bullets: [
          "Follow views, clicks, click-through rate, details opened and visits to your link in your campaign dashboard.",
          "Replace the image or video, or edit the words and link — the current ad keeps showing until the new one passes its checks.",
          "Pause and resume. Pausing doesn't stop the clock: the campaign still ends on its end date.",
          "Extend a live campaign by buying more days.",
        ],
      },
      {
        h2: "Tips for a stronger campaign",
        bullets: [
          "Send people to a page that continues the ad's message.",
          "Test one message at a time so you can see what works.",
          "Choose the place where your audience already is: downloads, the Feed, Reels or AI pages.",
        ],
      },
    ],
    faqs: [
      { q: "How quickly does a campaign go live?", a: "Usually soon after the payment is confirmed, once the automated checks pass. If an ad needs a manual look, that takes longer, and you are told." },
      { q: "Can I choose a country or audience?", a: "Not at the moment. Campaigns are booked by format, placement and duration." },
      { q: "Do I need an account?", a: "Only to upload your ad and pay, so the campaign belongs to you." },
    ],
    related: ["/advertise", "/advertise/pricing", "/advertise/banner-ads", "/advertise/video-ads", "/advertise/rules"],
    cta: { href: "/advertise/create", label: "Start your campaign" },
  },
];

export function guideByPath(path: string): Guide | undefined {
  return GUIDES.find((g) => g.path === path);
}

/** The slug after a section prefix (`/frenz-ai/lip-sync` → `lip-sync`); the hub has none. */
export function guideSlug(g: Guide): string | null {
  const rest = g.path.slice(`/${g.section}`.length).replace(/^\//, "");
  return rest || null;
}

export function guidesIn(section: GuideSection): Guide[] {
  return GUIDES.filter((g) => g.section === section && guideSlug(g) !== null);
}

/** A short label for related-link cards: the H1 is the page's own words. */
export function guideLabel(path: string): string {
  return guideByPath(path)?.h1 ?? LINK_LABELS[path] ?? path;
}

/** Labels for the existing pages the guides link to. */
const LINK_LABELS: Record<string, string> = {
  "/advertise": "Advertise on Frenzsave",
  "/advertise/rules": "Frenzsave Advertising Rules",
};
