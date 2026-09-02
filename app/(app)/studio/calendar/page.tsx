import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { CalendarBoard } from "@/features/studio/calendar-board";
import { StudioCard } from "@/features/studio/studio-ui";
import { listPlans, listPublishedInWindow, listScheduledPosts } from "@/lib/creator/plan";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Calendar" };

/**
 * Content calendar (Feature 15 · Part 9).
 *
 * The month is a URL parameter, not client state, so a month someone is looking
 * at is a link they can share with themselves across devices — and the data for
 * it is fetched on the server rather than shipped for every month at once.
 */
export default async function StudioCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/studio/calendar");

  const sp = await searchParams;
  const now = new Date();
  // `YYYY-MM`, falling back to this month for anything malformed.
  const match = /^(\d{4})-(\d{2})$/.exec(sp.m ?? "");
  const year = match ? Number(match[1]) : now.getFullYear();
  const month = match ? Number(match[2]) - 1 : now.getMonth();
  const safeMonth = month >= 0 && month <= 11 ? month : now.getMonth();

  const pad = (n: number) => String(n).padStart(2, "0");
  const from = `${year}-${pad(safeMonth + 1)}-01`;
  const to = `${year}-${pad(safeMonth + 1)}-${pad(new Date(year, safeMonth + 1, 0).getDate())}`;

  const [plans, scheduled, published] = await Promise.all([
    listPlans(user.id, from, to),
    listScheduledPosts(user.id, from, to),
    listPublishedInWindow(user.id, from, to),
  ]);

  const prev = new Date(year, safeMonth - 1, 1);
  const next = new Date(year, safeMonth + 1, 1);
  const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const label = new Date(year, safeMonth, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.03em] sm:text-3xl">Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">Scheduled posts and everything you plan to make.</p>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={`/studio/calendar?m=${key(prev)}`}
            prefetch
            aria-label="Previous month"
            className="rounded-xl bg-secondary p-2 transition hover:bg-secondary/70"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="min-w-[9rem] text-center text-sm font-semibold">{label}</span>
          <Link
            href={`/studio/calendar?m=${key(next)}`}
            prefetch
            aria-label="Next month"
            className="rounded-xl bg-secondary p-2 transition hover:bg-secondary/70"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </header>

      <StudioCard title={label} subtitle="Blue is scheduled, green already published, colours are your plans">
        <CalendarBoard year={year} month={safeMonth} plans={plans} scheduled={scheduled} published={published} />
      </StudioCard>

      <section className="rounded-3xl border border-dashed border-border/70 p-5 text-xs leading-relaxed text-muted-foreground sm:p-6">
        <p className="mb-1 font-semibold text-foreground">How scheduling actually publishes</p>
        <p>
          A scheduled post goes live within a few minutes of its time, not to the second. The publish sweep
          runs off real site traffic (and once a day on a cron), because this project&apos;s hosting plan
          gives it two cron slots and both are already taken. In practice the site is being read
          continuously, so the delay is under a minute — but it is a real dependency, and it is better
          stated here than discovered.
        </p>
      </section>
    </div>
  );
}
