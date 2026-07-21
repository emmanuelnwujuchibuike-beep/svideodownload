import { FrenzMark } from "@/components/brand/frenz-logo";

/**
 * The admin gate loader.
 *
 * The dashboard is a heavy server component — it awaits the revenue, subscriber
 * and placement queries before it can render a byte. Next.js shows THIS instead
 * the instant the admin link is tapped, so the gate responds immediately with a
 * branded screen rather than a frozen tap, and swaps to the real dashboard when
 * its data lands. No client JS: the animation is CSS, and it inherits the app's
 * reduced-motion handling.
 */
export default function AdminLoading() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background">
      <div className="relative flex h-28 w-28 items-center justify-center">
        {/* Breathing brand aura. */}
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-gradient-to-br from-blue-500/30 via-violet-500/25 to-fuchsia-500/30 blur-2xl motion-safe:animate-login-pulse"
        />
        {/* A single sweeping ring — the premium touch, one accent, quiet ground. */}
        <span
          aria-hidden
          className="absolute inset-2 rounded-full border-2 border-transparent border-t-primary/80 border-r-primary/30 motion-safe:animate-spin [animation-duration:1.1s]"
        />
        <div className="relative rounded-2xl bg-background/70 p-3 shadow-xl ring-1 ring-inset ring-border/60 backdrop-blur-sm">
          <FrenzMark size={44} priority />
        </div>
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold tracking-[-0.01em]">Preparing your dashboard</p>
        <p className="mt-1 text-xs text-muted-foreground">Gathering today&apos;s numbers…</p>
      </div>

      <span role="status" aria-live="polite" className="sr-only">
        Loading the admin dashboard
      </span>
    </div>
  );
}
