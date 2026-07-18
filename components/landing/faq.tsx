import { ChevronDown } from "lucide-react";

import { Reveal } from "@/components/ui/reveal";
import { jsonLd } from "@/lib/seo/json-ld";

const FAQS: { q: string; a: string }[] = [
  {
    q: "Is FrenzSave free?",
    a: "Yes — completely free and unlimited, with no account or login required. Just paste a link and download.",
  },
  {
    q: "Do downloads have a watermark?",
    a: "No. We fetch clean, watermark-free versions wherever the platform provides them — including TikTok — so your videos look professional.",
  },
  {
    q: "Which platforms are supported?",
    a: "TikTok, Instagram, YouTube, X (Twitter), Facebook, Pinterest, Snapchat, Vimeo, Reddit, LinkedIn and Threads.",
  },
  {
    q: "Can I download just the audio (MP3)?",
    a: "Yes. Choose the Audio tab in the preview to extract a clean MP3 from any supported video.",
  },
  {
    q: "What quality can I download?",
    a: "Up to the highest quality the source offers — including HD and 4K where available. You pick the resolution before downloading.",
  },
  {
    q: "Is it safe to use?",
    a: "Yes. There are no accounts to hack, we never store your downloaded files, and transfers are encrypted. We collect the minimum data needed to run the service.",
  },
  {
    q: "Do I need to install an app?",
    a: "No — it works right in your browser on any device, desktop or mobile. A native app is on our roadmap.",
  },
  {
    q: "Is downloading videos legal?",
    a: "The tool itself is legal. You're responsible for only downloading content you own or have permission to save, and for respecting each platform's terms and copyright law.",
  },
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export function Faq() {
  return (
    <section id="faq" className="border-t border-border/60 py-28 sm:py-36">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd) }}
      />
      <div className="container max-w-3xl">
        <Reveal className="mb-14 text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            FAQ
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.75rem] sm:leading-[1.1]">
            Frequently asked questions
          </h2>
        </Reveal>

        <div className="space-y-3">
          {FAQS.map((f, i) => (
            <Reveal key={f.q} delay={(i % 4) * 0.04}>
              <details className="group rounded-2xl border border-border bg-card p-5 shadow-soft transition-shadow open:shadow-card sm:p-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-medium [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-300 group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  {f.a}
                </p>
              </details>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
