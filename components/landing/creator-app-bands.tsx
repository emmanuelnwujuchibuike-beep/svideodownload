import { ArrowRight, BarChart3, Gift, Lock, Share } from "lucide-react";
import Link from "next/link";

import { InstallHeaderCta } from "@/features/pwa/install-button";

/*
  The new landing design's two lower bands (design/frenz-landing.html, owner 2026-10-28: "continue to what's not done
  yet") — the rest of that design already exists on the React landing (How it works, Tools, Frenz AI, platforms, FAQ).
  New SECTIONS only: nothing here changes how a function works. Neumorphic skin: a raised card on the page, inset wells
  inside it. Server-rendered except the Install button, which is the app's own install flow.
*/
const RAISED = "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_12px_30px_-8px_rgba(16,24,40,.14),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-6px_-6px_16px_rgba(255,255,255,.045),9px_11px_26px_rgba(0,0,0,.55)]";
const WELL = "bg-frenz-fill shadow-[inset_0_2px_5px_rgba(16,24,40,.08)] dark:shadow-[inset_0_2px_6px_rgba(0,0,0,.5)]";
const CHIP = "bg-frenz-card shadow-[0_1px_1px_rgba(16,24,40,.04),0_6px_14px_-4px_rgba(16,24,40,.13),0_0_0_1px_rgba(16,24,40,.05)] dark:shadow-[-4px_-4px_10px_rgba(255,255,255,.045),5px_6px_14px_rgba(0,0,0,.55)]";

const PERKS = [
  { icon: Gift, tone: "text-amber-700 dark:text-amber-400", title: "Sticker gifts", text: "Fans send stickers paid with Gift Coins." },
  { icon: Lock, tone: "text-violet-600 dark:text-violet-400", title: "Exclusive posts", text: "Set a price and let fans subscribe." },
  { icon: BarChart3, tone: "text-frenz-blue", title: "Creator analytics", text: "Engagement, earnings and gifts in one place." },
] as const;

/** "Made something people love? Get paid for it." — the way into the Creator Lounge. */
/** `inPage`: inside a page that already pads its column (/downloads) — no container of its own. */
export function CreatorBand({ inPage = false }: { inPage?: boolean } = {}) {
  return (
    <section aria-labelledby="creator-band-title" className={inPage ? "mt-6" : "container px-3 py-6"}>
      <div className={`grid gap-[18px] rounded-[28px] p-[22px] text-frenz-ink sm:grid-cols-2 sm:items-center sm:p-8 ${RAISED}`}>
        <div>
          <h2 id="creator-band-title" className="font-heading text-[20px] font-extrabold leading-[1.15] tracking-[-0.02em]">
            Made something people love? Get paid for it.
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-frenz-muted">Turn your posts into income with sticker gifts and exclusive posts, and track all of it in Creator analytics.</p>
          <Link href="/account/creator-lounge" prefetch={false} className={`mt-[18px] inline-flex h-[52px] items-center justify-center gap-2 rounded-[17px] px-5 text-base font-bold text-frenz-violet transition active:scale-[0.98] ${CHIP}`}>
            Open Creator Lounge <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <ul className="grid gap-2.5">
          {PERKS.map((p) => (
            <li key={p.title} className={`flex items-center gap-3 rounded-[18px] p-3 ${WELL}`}>
              <span className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] ${CHIP} ${p.tone}`}>
                <p.icon className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <b className="block text-[15px]">{p.title}</b>
                <span className="mt-px block text-[13px] text-frenz-muted">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** "Frenz works best as an app" — hidden once the app is installed (the install button's own rule). */
export function AppBand({ inPage = false }: { inPage?: boolean } = {}) {
  return (
    <section aria-labelledby="app-band-title" className={inPage ? "hide-when-installed mt-6" : "hide-when-installed container px-3 py-6"}>
      <div className="relative grid gap-4 overflow-hidden rounded-[28px] bg-[linear-gradient(150deg,#15162A_0%,#221B4E_60%,#2E1C66_100%)] p-6 text-white shadow-[0_24px_48px_rgba(20,16,60,.28),inset_0_1px_0_rgba(255,255,255,.1)] sm:grid-cols-[1fr_auto] sm:items-center sm:px-9 sm:py-8">
        <span aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-[280px] w-[280px] rounded-full bg-[radial-gradient(circle,rgba(124,58,237,.55),transparent_70%)]" />
        <div className="relative">
          <h2 id="app-band-title" className="font-heading text-[20px] font-extrabold tracking-[-0.02em]">Frenz works best as an app</h2>
          <p className="mt-1.5 text-[15px] leading-relaxed text-white/80">Faster saving, your History on every device, and notifications when friends share.</p>
          <p className="mt-3 flex items-center gap-2 text-[13px] text-white/75">
            <Share className="h-4 w-4 shrink-0" aria-hidden /> On iPhone: tap Share, then &ldquo;Add to Home Screen&rdquo;.
          </p>
        </div>
        {/* on the dark band the ink button inverts to white */}
        <InstallHeaderCta className="relative h-[52px] w-full justify-center rounded-[17px] bg-white text-base text-frenz-ink shadow-none sm:w-auto sm:px-7 dark:bg-white dark:text-[#12111A]" />
      </div>
    </section>
  );
}
