import { ArrowRight, BadgeCheck, CreditCard, ImageUp, LayoutGrid, Megaphone, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";

import { TapOnceLink } from "@/features/ui/tap-once-link";

/**
 * "Your ads" for a signed-out visitor (owner, 2026-10-31: the page "has less information that the ad campaign is about
 * publishing your brand, it should describe it properly in a premium floating glass pattern and a glass sign in
 * button. The page must be static and open instant. It shouldn't touch the landing page weight or speed.").
 *
 * - Static: no hooks, no fetch — the static /advertise/campaigns page's client island renders it the moment it knows
 *   there is no session.
 * - 🔴 The landing's stylesheet does not grow: /advertise shares the marketing entry.css with the landing, compiled
 *   from the classes the marketing tree uses. So the glass is INLINE style objects and the classes are stock ones the
 *   marketing pages already use — this file adds JS to this route only, and not one CSS rule anywhere.
 * - Truth rule: every sentence is one /advertise already states; no number we have not measured.
 * - No backdrop-filter: it sits on a plain page (the glass heat note in globals.css). Colours are the theme tokens
 *   (--card, --border), so the glass follows light and dark mode.
 */
const PANEL: CSSProperties = {
  background: "linear-gradient(180deg, hsl(var(--card) / 0.92), hsl(var(--card) / 0.85))",
  border: "1px solid hsl(var(--border) / 0.55)",
  borderRadius: 28,
  boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.9), inset 0 -1px 1px rgb(0 0 0 / 0.04), 0 14px 36px rgb(14 14 20 / 0.12), 0 2px 8px rgb(14 14 20 / 0.05)",
};
const TILE: CSSProperties = {
  background: "linear-gradient(180deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.82))",
  border: "1px solid hsl(var(--border) / 0.55)",
  borderRadius: 22,
  boxShadow: "inset 0 1px 1px rgb(255 255 255 / 0.95), 0 2px 8px -4px rgb(40 30 90 / 0.18)",
};
const ORB: CSSProperties = {
  background: "linear-gradient(180deg, #2d3148, #14151d)",
  boxShadow: "0 0 0 2.5px #5b3fe6, 0 6px 18px rgb(91 63 230 / 0.35)",
};
const PILL: CSSProperties = {
  background: "linear-gradient(160deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.6))",
  border: "1px solid hsl(var(--border) / 0.55)",
  boxShadow: "inset 0 1px 1px rgb(255 255 255 / 0.9), 0 2px 6px -3px rgb(40 30 90 / 0.25)",
};
/** the glass sign-in: frosted white, violet type and edge, so it reads on white */
const SIGN_IN: CSSProperties = {
  color: "#5b3fe6",
  background: "linear-gradient(180deg, hsl(var(--card) / 0.95), hsl(var(--card) / 0.85))",
  border: "1px solid rgb(91 63 230 / 0.28)",
  boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.9), inset 0 -1px 1px rgb(91 63 230 / 0.08)",
};

const STEPS = [
  { icon: LayoutGrid, title: "Choose where it appears", text: "Pick a format and a place — the top banner, the Feed, Reels, AI pages or downloads." },
  { icon: ImageUp, title: "Upload and preview", text: "An image or a short video. We check it right away and show you a live preview." },
  { icon: CreditCard, title: "Pay and go live", text: "A clear total before you pay, with no hidden fees, on a secure checkout page." },
] as const;

const PROMISES = ["Every link is checked", "No fake buttons or misleading claims", "Ads never ask for passwords or card details"] as const;

export function GuestAdsIntro() {
  const signIn = `/login?next=${encodeURIComponent("/advertise/campaigns")}`;
  return (
    <div className="flex flex-col gap-3 text-foreground">
      <section style={PANEL} className="px-5 pb-6 pt-6">
        <span aria-hidden style={ORB} className="mb-4 flex h-12 w-12 items-center justify-center rounded-full text-white">
          <Megaphone className="h-5 w-5" strokeWidth={2.2} />
        </span>
        <h2 className="text-2xl font-bold tracking-tight">Publish your brand on Frenz</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Promote your business to Frenz users around the world. Choose a format and where it appears, upload your image or video,
          preview it and go live after payment. Your campaigns, their performance and your payments all live here.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <TapOnceLink href={signIn} style={SIGN_IN} className="inline-flex h-12 items-center gap-2 rounded-full px-6 text-base font-bold">
            Sign in to start <ArrowRight className="h-4 w-4" strokeWidth={2.6} aria-hidden />
          </TapOnceLink>
          <TapOnceLink href="/advertise" style={PILL} className="inline-flex h-12 items-center rounded-full px-5 text-sm font-semibold">
            Formats and prices
          </TapOnceLink>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Use the Frenz account you already have — or create one in a minute.</p>
      </section>

      <ol className="flex flex-col gap-2" aria-label="How it works">
        {STEPS.map(({ icon: Icon, title, text }, i) => (
          <li key={title} style={TILE} className="flex items-start gap-3 p-4">
            <span style={{ ...PILL, color: "#5b3fe6" }} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full">
              <Icon className="h-4 w-4" strokeWidth={2.2} aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-bold uppercase tracking-wider text-muted-foreground">Step {i + 1}</span>
              <span className="mt-0.5 block text-base font-bold">{title}</span>
              <span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{text}</span>
            </span>
          </li>
        ))}
      </ol>

      <section style={TILE} className="p-4" aria-label="Safe for everyone">
        <p className="flex items-center gap-2 text-sm font-bold">
          <ShieldCheck className="h-4 w-4" style={{ color: "#5b3fe6" }} aria-hidden /> Safe for everyone who sees it
        </p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {PROMISES.map((p) => (
            <li key={p} className="flex items-center gap-2 text-sm text-muted-foreground">
              <BadgeCheck className="h-4 w-4 shrink-0" style={{ color: "#10b981" }} aria-hidden /> {p}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
