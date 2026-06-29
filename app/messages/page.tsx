import { BadgeCheck, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { listConversations } from "@/lib/social/messages";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default async function MessagesPage() {
  if (!hasSupabase) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/messages");

  const conversations = await listConversations(user.id);

  return (
    <>
      <SiteHeader />
      <main className="container max-w-2xl pb-24 pt-28 sm:pt-32">
        <h1 className="mb-5 flex items-center gap-2 text-2xl font-bold tracking-[-0.02em]">
          <MessageCircle className="h-6 w-6 text-primary" /> Messages
        </h1>

        {conversations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 p-10 text-center text-sm text-muted-foreground">
            No conversations yet. Open someone&apos;s profile and tap Message to start one.
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-soft">
            {conversations.map((c) => (
              <li key={c.id} className="border-b border-border/50 last:border-0">
                <Link href={`/messages/${c.id}`} className="flex items-center gap-3 p-3.5 transition hover:bg-secondary/40">
                  {c.other.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.other.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-cyan-400 text-base font-bold text-white">
                      {c.other.displayName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("truncate text-sm", c.unread ? "font-bold" : "font-semibold")}>{c.other.displayName}</span>
                      {c.other.isVerified ? <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(c.lastAt)}</span>
                    </div>
                    <p className={cn("mt-0.5 truncate text-sm", c.unread ? "text-foreground" : "text-muted-foreground")}>
                      {c.fromMe ? "You: " : ""}
                      {c.lastBody ?? "…"}
                    </p>
                  </div>
                  {c.unread ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" /> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
