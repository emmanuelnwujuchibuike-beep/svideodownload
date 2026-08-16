import { Check, Cloud, Lock } from "lucide-react";

/**
 * The landing page's version of the Download page's "Cloud storage" card
 * (owner, 2026-08-16: the landing download section is missing "storage… and
 * all stat" that the Download page shows).
 *
 * ── Why this is NOT the same component as CloudStorageCard ─────────────────
 * `features/downloads/downloads-sections.tsx`'s `CloudStorageCard` renders a
 * signed-in visitor's REAL usage — bytes used, a ring gauge, a percentage.
 * None of that exists for a landing visitor who hasn't downloaded anything
 * yet, and inventing a number for them is exactly what this codebase's own
 * standing rule forbids (`⛔ NO fabricated stats — declined 3×`). This card
 * states the same PLAN CEILINGS `lib`/`features/history/usage.ts`'s
 * `PLAN_LIMIT_BYTES` actually configures (5 GB free, 50 GB Pro, unlimited
 * Business) — a real product fact, not a per-visitor measurement — paired
 * with the same benefits checklist the Download page's card uses.
 */
export function CloudStorageTeaser() {
  return (
    <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-soft dark:border-white/10 dark:bg-white/5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Cloud className="h-5 w-5 text-primary" />
        <h2 className="text-base font-bold text-slate-900 dark:text-white">Cloud storage</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/12 px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400">
          <Lock className="h-3 w-3" /> Private &amp; Secure
        </span>
      </div>

      <div className="grid items-center gap-5 sm:grid-cols-3">
        {[
          { plan: "Free", cap: "5 GB" },
          { plan: "Pro", cap: "50 GB" },
          { plan: "Business", cap: "Unlimited" },
        ].map((t) => (
          <div key={t.plan} className="rounded-2xl bg-slate-50 px-4 py-3 text-center dark:bg-white/5">
            <p className="text-lg font-extrabold tracking-tight text-slate-900 dark:text-white">{t.cap}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-white/60">{t.plan}</p>
          </div>
        ))}
      </div>

      <ul className="mt-5 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-4 dark:border-white/10">
        {["Downloads never expire", "Secure cloud backup", "Access anywhere", "100% private"].map((t) => (
          <li key={t} className="flex items-center gap-2 text-sm text-slate-600 dark:text-white/70">
            <Check className="h-4 w-4 shrink-0 text-blue-500" /> {t}
          </li>
        ))}
      </ul>
    </section>
  );
}
