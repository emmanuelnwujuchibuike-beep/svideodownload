import { UserRound } from "lucide-react";
import Link from "next/link";

/**
 * "Login to personalize your experience" — the card the owner screenshotted. It is
 * the content of the landing profile page (app/(marketing)/profile), and its button
 * routes to /login with the site's normal page transition.
 */
export function LoginPersonalizeCard() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 rounded-3xl border border-border/70 bg-card p-6 text-center shadow-card sm:flex-row sm:gap-6 sm:p-8 sm:text-left">
      <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <UserRound className="h-12 w-12" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
          Login to personalize your experience
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Save what you find, track history and more.
        </p>
        <Link
          href="/login"
          className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-500 via-violet-600 to-fuchsia-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition hover:opacity-95 active:scale-[0.99] sm:w-auto"
        >
          Login / Sign up
        </Link>
      </div>
    </div>
  );
}
