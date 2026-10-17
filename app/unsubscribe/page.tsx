import type { Metadata } from "next";
import Link from "next/link";

import { TOKEN_RE } from "@/lib/email/token-format";

/**
 * /unsubscribe — the page an optional email's "Unsubscribe" link opens (Frenzsave Part 11).
 *
 * Opening it changes NOTHING: a mail scanner or a link preview that follows the link must not
 * unsubscribe anyone, so the change is one button that POSTs the token (app/api/email/unsubscribe).
 * No sign-in, no account details on the page, outside the marketing shell (no ads, no trackers).
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Email preferences",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATES = {
  done: {
    title: "You're unsubscribed",
    body: "Frenz won't send you optional emails any more: creator announcements and new-post alerts, new-subscriber and new-member notices, renewal reminders and ad-slot alerts. You can turn them back on any time in Settings › Notifications.",
  },
  invalid: {
    title: "This link isn't valid",
    body: "It may be incomplete or out of date. Sign in and open Settings › Notifications to choose which emails you get.",
  },
  error: {
    title: "That didn't go through",
    body: "Nothing was changed. Please try the link again in a moment.",
  },
} as const;

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const state = typeof q.state === "string" && q.state in STATES ? (q.state as keyof typeof STATES) : null;
  const token = typeof q.t === "string" && TOKEN_RE.test(q.t) ? q.t : null;
  const shown = state ? STATES[state] : token ? null : STATES.invalid;

  return (
    <main className="ex-ground flex min-h-dvh w-full items-center justify-center px-4 py-10">
      <section aria-labelledby="unsub-title" className="ex-card w-full max-w-md px-6 py-7 text-center">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-primary">Frenz email</p>
        {shown ? (
          <>
            <h1 id="unsub-title" className="mt-2 text-[21px] font-bold tracking-[-0.015em]">
              {shown.title}
            </h1>
            <p role="status" className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              {shown.body}
            </p>
          </>
        ) : (
          <>
            <h1 id="unsub-title" className="mt-2 text-[21px] font-bold tracking-[-0.015em]">
              Stop optional emails?
            </h1>
            <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
              You&apos;ll stop getting creator announcements and new-post alerts, new-subscriber and new-member notices, renewal reminders and ad-slot alerts by email.
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
              Sign-in codes, receipts, withdrawal and payout updates and replies from support still arrive: they&apos;re about your account and your money.
            </p>
            <form method="post" action="/api/email/unsubscribe" className="mt-5">
              <input type="hidden" name="t" value={token!} />
              <button type="submit" className="ex-btn ex-btn--primary w-full">
                Unsubscribe
              </button>
            </form>
          </>
        )}
        <Link href="/account/notifications" prefetch={false} className="ex-btn ex-btn--quiet mt-2 w-full">
          Manage email settings
        </Link>
      </section>
    </main>
  );
}
