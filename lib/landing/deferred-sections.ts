import {
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BrainCircuit,
  ChevronDown,
  Clapperboard,
  Eraser,
  Film,
  FolderClock,
  Gauge,
  ImagePlay,
  Layers,
  MessageSquareText,
  Mic,
  MonitorSmartphone,
  MousePointerClick,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { FAQS } from "@/components/landing/faq-data";
import { ICON_TILE, LANDING_CARD } from "@/components/landing/landing-classes";
import { SHOWCASE_TARGETS } from "@/lib/ai/showcase/slides";
import { brandSvg, lucideSvg } from "@/lib/landing/svg-string";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { SHOWCASE_PLATFORMS } from "@/lib/platforms";
import { getPrimaryPages } from "@/lib/seo/seo-pages";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE LANDING'S LOWER SECTIONS, LOADED ONLY WHEN SCROLLED NEAR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-19: "Make sure the landing is very light … below section shouldn't load on landing."
 *
 * Measured on the built page before this: the landing document was 64 KB gzipped, and the sections
 * below the hero were ~28 KB of it — a server component's markup ships TWICE, once as HTML and once
 * again in the page's RSC payload. Now the document carries only the hero, the Promote card (its facts
 * are live ad data) and the ad slots; these five sections are plain HTML served from ONE static,
 * CDN-cached address (`/landing-sections`, app/landing-sections/route.ts) and fetched by
 * `DeferredSection` only when a visitor scrolls within about a screen of them. A visitor who never
 * scrolls never downloads them.
 *
 * Kept in the document on purpose: the FAQ's structured data (FaqJsonLd) and each section's anchor
 * id (#products, #features, #how-it-works, #platforms, #faq) — the placeholders carry the ids, so the
 * header and footer links still land, and arriving on one loads it straight away.
 *
 * The look is the Frenz system of the 2026-10-19 restyle (components/landing/landing-ui.tsx). Every
 * word is the copy these sections already had. Links are plain anchors; DeferredSection turns a tap
 * on an internal one into client navigation, so they stay instant.
 */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head(id: string, eyebrow: string, title: string, highlight?: string, sub?: string) {
  return `<header class="mb-4"><p class="m-0 text-xs font-bold uppercase tracking-[0.12em] text-frenz-violet">${esc(eyebrow)}</p><h2 id="${id}" class="m-0 mt-1.5 text-balance font-heading text-[26px] font-bold leading-[1.15] tracking-[-0.6px] text-frenz-ink">${esc(title)}${highlight ? ` <span class="text-frenz-violet">${esc(highlight)}</span>` : ""}</h2>${sub ? `<p class="m-0 mt-2 max-w-xl text-[15px] leading-relaxed text-frenz-muted">${sub}</p>` : ""}</header>`;
}

/* ─────────────────────────────── Frenz AI ─────────────────────────────── */

const TOOL_ICONS: Partial<Record<keyof typeof SHOWCASE_TARGETS, LucideIcon>> = {
  "text-to-video": Film,
  "image-to-video": ImagePlay,
  "text-to-audio": AudioLines,
  "voice-cloning": Mic,
  "lip-sync": MessageSquareText,
};

/** The live tools, from the list the AI showcase already maintains — never a second copy. */
export function aiTools() {
  return (Object.entries(SHOWCASE_TARGETS) as [keyof typeof SHOWCASE_TARGETS, { label: string; path: string }][])
    .filter(([id]) => id in TOOL_ICONS)
    .map(([id, t]) => ({ id, label: t.label, href: `/ai${t.path}`, icon: TOOL_ICONS[id]! }));
}

/**
 * PRIMARY after Download. One of the two showcase cards the gradient may fill (the same deep radial as
 * the hero's Frenz AI tile); the tools sit under it as plain white tiles. AI Reels is its secondary
 * action — where the made-with-AI work is watched.
 */
function frenzAi() {
  const tools = aiTools()
    .map(
      (t) =>
        `<li><a href="${t.href}" data-track="ai_clicked" class="${LANDING_CARD} flex h-full min-h-[60px] items-center gap-2.5 p-3 text-[14px] font-bold leading-snug text-frenz-ink no-underline transition active:scale-[0.98]"><span class="${ICON_TILE} h-9 w-9 rounded-[11px]" aria-hidden="true">${lucideSvg(t.icon, "h-[18px] w-[18px]")}</span>${esc(t.label)}</a></li>`,
    )
    .join("");
  return `<section aria-labelledby="landing-ai" class="frenz-ui mx-auto max-w-2xl px-4 py-6"><div class="relative overflow-hidden rounded-[22px] bg-[radial-gradient(circle_at_80%_10%,hsl(var(--frenz-magenta)),hsl(var(--frenz-violet))_42%,hsl(var(--frenz-ink))_95%)] p-5 text-white"><p class="m-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.12em] text-white/80">${lucideSvg(BrainCircuit, "h-4 w-4")} Frenz AI</p><h2 id="landing-ai" class="m-0 mt-2 font-heading text-[26px] font-bold leading-[1.15] tracking-[-0.6px]">Create more with AI.</h2><p class="m-0 mt-2 text-[15px] leading-relaxed text-white/85">Turn words into video, bring photos to life, and make voices and audio — right where you save and share.</p><div class="mt-5 flex flex-wrap gap-2.5"><a href="/ai" data-track="ai_clicked" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-white px-5 font-heading text-[15px] font-bold text-frenz-ink no-underline transition active:scale-[0.98] data-[pending]:opacity-80">Explore Frenz AI ${lucideSvg(ArrowRight, "h-4 w-4")}</a><a href="/reels?tab=ai" data-track="ai_reels_clicked" class="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-white/15 px-5 font-heading text-[15px] font-bold text-white no-underline ring-1 ring-inset ring-white/25 transition active:scale-[0.98] data-[pending]:opacity-80">${lucideSvg(Clapperboard, "h-4 w-4")} Watch AI Reels</a></div></div><ul class="m-0 mt-3 grid list-none grid-cols-2 gap-3 p-0">${tools}</ul></section>`;
}

/* ─────────────────────────────── Features ─────────────────────────────── */

/**
 * The six product features. One icon per feature (owner 2026-10-18: an icon must match its feature —
 * "No Watermark" had shared the shield with "Privacy First"). "HD Quality" shows the letters HD.
 * "no limits" was removed 2026-09-02 as false (free accounts have a batch cap and quality gates).
 */
export const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Eraser, title: "No Watermark", desc: "Download videos without a watermark, in high quality." },
  { icon: Zap, title: "Ultra Fast", desc: "Blazing-fast servers that deliver at lightning speed." },
  { icon: Layers, title: `${SHOWCASE_PLATFORMS.length} Platforms`, desc: "Support for every major social and media platform, plus any public video link." },
  { icon: Gauge, title: "HD Quality", desc: "Download in the highest quality available." },
  { icon: ShieldCheck, title: "Privacy First", desc: "We respect your privacy. No data is stored." },
  { icon: MonitorSmartphone, title: "Cross Device", desc: "Works perfectly on mobile, tablet and desktop." },
];

function features() {
  const items = FEATURES.map(
    (f) =>
      `<li class="${LANDING_CARD} flex flex-col gap-2.5 p-3.5"><span class="${ICON_TILE}" aria-hidden="true">${f.title === "HD Quality" ? `<span class="font-heading text-[13px] font-extrabold">HD</span>` : lucideSvg(f.icon, "h-5 w-5")}</span><span><h3 class="m-0 text-[15px] font-bold text-frenz-ink">${esc(f.title)}</h3><p class="m-0 mt-0.5 text-[13px] leading-snug text-frenz-muted">${esc(f.desc)}</p></span></li>`,
  ).join("");
  return `<section aria-labelledby="landing-features" class="frenz-ui mx-auto max-w-2xl px-4 py-6">${head(
    "landing-features",
    "Powerful features",
    "Everything you need.",
    "All in one place.",
    "Save the posts you want to keep, then reuse them — organise them into collections, publish them to your feed, or pull the audio out. No sign-up to start, and the quality is yours to choose on every device you own.",
  )}<ul class="m-0 grid list-none grid-cols-2 gap-3 p-0">${items}</ul></section>`;
}

/* ───────────────────────────── How it works ───────────────────────────── */

/**
 * Three steps and three notes. The phone mockup that used to sit between them is gone (2026-10-19): it
 * was decoration with a made-up "85% · Video.mp4" transfer, and the real paste box is at the top of this
 * page. Step 2 names the button as it now reads — "Download" (it said "Save").
 */
export const STEPS = [
  { n: 1, title: "Paste your link", desc: "Copy and paste the link from any platform you want to download." },
  { n: 2, title: "Tap Download", desc: "We process the link and prepare your file." },
  { n: 3, title: "Save & Enjoy", desc: "Download in the quality you want and enjoy offline." },
];

const NOTES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: MousePointerClick, title: "Clean & Easy Interface", desc: "Designed for everyone." },
  { icon: Zap, title: "Real-time Progress", desc: "Track your downloads." },
  { icon: FolderClock, title: "Save History", desc: "Access anytime, anywhere." },
];

function howItWorks() {
  // a numbered step is a small badge — one of the places the gradient may go
  const steps = STEPS.map(
    (s) =>
      `<li class="flex items-start gap-3 px-3.5 py-3.5"><span aria-hidden="true" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-frenz-gradient-x font-heading text-[14px] font-bold text-white">${s.n}</span><span class="min-w-0"><span class="block text-[15px] font-bold text-frenz-ink"><span class="sr-only">Step ${s.n}: </span>${esc(s.title)}</span><span class="mt-0.5 block text-[13px] leading-snug text-frenz-muted">${esc(s.desc)}</span></span></li>`,
  ).join("");
  const notes = NOTES.map(
    (n) =>
      `<li class="flex items-center gap-3 px-1 py-1.5 min-[400px]:flex-col min-[400px]:items-start min-[400px]:gap-2"><span class="${ICON_TILE}" aria-hidden="true">${lucideSvg(n.icon, "h-5 w-5")}</span><span><span class="block text-[14px] font-bold text-frenz-ink">${esc(n.title)}</span><span class="block text-[12.5px] text-frenz-muted">${esc(n.desc)}</span></span></li>`,
  ).join("");
  return `<section aria-labelledby="landing-how" class="frenz-ui mx-auto max-w-2xl px-4 py-6">${head("landing-how", "How it works", "3 simple steps.", "That’s it.", "From link to saved file in seconds — no tutorials, no settings to learn.")}<ol class="${LANDING_CARD} m-0 list-none divide-y divide-frenz-line p-0">${steps}</ol><ul class="m-0 mt-3 grid list-none grid-cols-1 gap-2 p-0 min-[400px]:grid-cols-3">${notes}</ul></section>`;
}

/* ────────────────────────────── Platforms ────────────────────────────── */

/**
 * The internal links to each platform page (the SEO surface — how those pages are discovered; heading
 * reworded 2026-09-02, "minimis the word downloader … use save and reuse"). Brand marks sit on the
 * light fill in ink: no per-platform gradients on a Frenz page.
 */
function platforms() {
  const rows = getPrimaryPages()
    .map((d) => {
      const Icon = BRAND_ICONS[d.platformId];
      return `<li><a href="/${d.slug}" class="flex min-h-[60px] items-center gap-3 px-3.5 py-2.5 text-frenz-ink no-underline transition-colors active:bg-frenz-fill"><span aria-hidden="true" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-frenz-fill text-frenz-ink">${Icon ? brandSvg(Icon, "h-[18px] w-[18px]") : ""}</span><span class="min-w-0 flex-1"><span class="block truncate text-[15px] font-bold">${esc(`${d.brand} ${d.thing}`)}</span><span class="block truncate text-[12.5px] text-frenz-muted">${esc(d.primaryKeyword)}</span></span>${lucideSvg(ArrowUpRight, "h-4 w-4 shrink-0 text-frenz-muted")}</a></li>`;
    })
    .join("");
  return `<section aria-labelledby="landing-platforms" class="frenz-ui mx-auto max-w-2xl px-4 py-6"><h2 id="landing-platforms" class="m-0 mb-4 text-balance font-heading text-[22px] font-bold leading-tight tracking-[-0.5px] text-frenz-ink">Save and reuse from your favourite platforms</h2><ul class="${LANDING_CARD} m-0 list-none divide-y divide-frenz-line overflow-hidden p-0">${rows}</ul><p class="m-0 mt-4 text-[14px] text-frenz-muted">Looking for something else? <a href="/#download" class="font-bold text-frenz-blue no-underline hover:underline">Save from every supported platform on the home page</a> or read our <a href="/blog" class="font-bold text-frenz-blue no-underline hover:underline">downloading guides</a>.</p></section>`;
}

/* ───────────────────────────────── FAQ ───────────────────────────────── */

/** One grouped white card, a native <details> row per question (no script), the way Settings groups rows. */
function faq() {
  const rows = FAQS.map(
    (f) =>
      `<details class="group"><summary class="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[15px] font-bold text-frenz-ink transition-colors active:bg-frenz-fill [&::-webkit-details-marker]:hidden">${esc(f.q)}${lucideSvg(ChevronDown, "h-[18px] w-[18px] shrink-0 text-frenz-muted transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none")}</summary><p class="m-0 px-4 pb-4 text-[14.5px] leading-relaxed text-frenz-muted">${esc(f.a)}</p></details>`,
  ).join("");
  return `<section aria-labelledby="landing-faq" class="frenz-ui mx-auto max-w-2xl px-4 pb-12 pt-6">${head(
    "landing-faq",
    "FAQ",
    "Frequently asked questions",
    undefined,
    `Everything you might want to know before you start. Still stuck? <a href="/support" class="font-bold text-frenz-blue no-underline hover:underline">Chat with our team</a>.`,
  )}<div class="${LANDING_CARD} divide-y divide-frenz-line overflow-hidden">${rows}</div></section>`;
}

/** The parts, by the name each `DeferredSection` asks for. */
export const DEFERRED_PARTS = ["ai", "features", "how", "platforms", "faq"] as const;
export type DeferredPart = (typeof DEFERRED_PARTS)[number];

export function renderDeferredSections(): Record<DeferredPart, string> {
  return { ai: frenzAi(), features: features(), how: howItWorks(), platforms: platforms(), faq: faq() };
}
