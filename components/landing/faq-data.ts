/** The landing's FAQ — one list for the visible questions (lib/landing/deferred-sections.ts) and the structured data (faq.tsx). */
export const FAQS: { q: string; a: string }[] = [
  {
    q: "Is FrenzSave free?",
    a: "Yes — completely free and unlimited, with no account or login required. Just paste a link and save.",
  },
  {
    // reframed 2026-10-29 (owner, AdSense review): use cases are your own content, offline viewing, archiving, accessibility
    q: "What is FrenzSave for?",
    a: "Backing up videos you posted, keeping a clip to watch offline on a flight or a weak connection, archiving content you have permission to keep, and watching at your own pace in any player. Only save content you own or have permission to use, and respect the creator's rights and the platform's terms.",
  },
  {
    q: "Which platforms are supported?",
    /*
      🔴 Rewritten 2026-08-23 (AdSense audit, Phase 8: copyright/responsible-
      use wording). Used to read "…plus public Telegram channels and, when
      configured, private/Story content" — accurate about the underlying
      feature (server/services/telegram-mtproto.ts: a signed-in user's OWN
      Telegram login reaching channels/chats THEY are already a member of,
      same as opening the Telegram app itself) but genuinely ambiguous to a
      reader who doesn't know that, and "private" sitting next to "content" on
      a downloader's own FAQ reads exactly like the wording the brief warned
      against — a claim of bypassing someone else's privacy, which this
      product does not do and never has.
    */
    a: "TikTok, Instagram, Telegram, X (Twitter), Facebook, Pinterest, Snapchat, Vimeo, Reddit, LinkedIn and Threads — including Stories, and, if you sign in with your own Telegram account, the channels and chats you're already a member of there.",
  },
  {
    q: "Can I save just the audio (MP3)?",
    a: "Yes. Choose the Audio tab in the preview to extract a clean MP3 from any supported video.",
  },
  {
    q: "What quality can I save?",
    a: "Up to the highest quality the source offers — including HD and 4K where available. You pick the resolution before saving.",
  },
  {
    q: "Is it safe to use?",
    a: "Yes. There are no accounts to hack, we never store your saved files, and transfers are encrypted. We collect the minimum data needed to run the service.",
  },
  {
    q: "Do I need to install an app?",
    a: "No — it works right in your browser on any device, desktop or mobile. A native app is on our roadmap.",
  },
  {
    // Landing + Download brief §28 (2026-10-08): the ecosystem's two other doors, answered in plain words.
    q: "What is Frenz AI?",
    a: "Frenz AI is Frenzsave's creation studio: turn text into video, bring photos to life, make natural AI audio, clone a voice and lip-sync a clip. Open it from the AI section on this page; you sign in when you create.",
  },
  {
    q: "Can I advertise on Frenzsave?",
    a: "Yes. Choose a format and where it appears — such as the Feed, Reels, AI pages or downloads — upload your image or video, preview it and pay securely. Every ad is checked against our Advertising Rules before it goes live. Start at frenzsave.com/advertise.",
  },
  {
    q: "Is saving videos legal?",
    a: "The tool itself is legal. You're responsible for only saving content you own or have permission to keep, and for respecting each platform's terms and copyright law.",
  },
];

export const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};
