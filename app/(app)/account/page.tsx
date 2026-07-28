import {
  BarChart3,
  Bell,
  Bookmark,
  ChevronRight,
  Code2,
  Crown,
  Download,
  KeyRound,
  Lock,
  LogOut,
  Palette,
  ShieldCheck,
  Sparkles,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DiamondCrownBadge } from "@/components/badges/diamond-crown-badge";
import { AppContent } from "@/features/app-shell/app-content";
import { isAdmin } from "@/lib/admin";
import type { BillingPlan } from "@/lib/monetization/types";
import { getOwnProfile } from "@/lib/social/profile";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Row = { href: string; Icon: LucideIcon; title: string; sub: string };

/**
 * Settings — a premium, professional LIST menu (Snapchat/TikTok-style): every
 * category is its OWN page, so nothing is packed on one long scrolling page.
 * Each row is a prefetched <Link>, so opening Settings warms every category and
 * they open instantly with no loading spinner.
 */
export default async function AccountPage() {
  if (!hasSupabase) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: sub }, ownProfile] = await Promise.all([
    supabase.from("profiles").select("role, avatar_url").eq("id", user.id).single(),
    supabase.from("subscriptions").select("plan, status").eq("user_id", user.id).maybeSingle(),
    getOwnProfile(user.id),
  ]);

  const planActive = sub?.status === "active" || sub?.status === "trialing";
  const plan = (planActive ? sub?.plan : "free") ?? "free";
  const planLabel = plan === "business" ? "Business" : plan === "pro" ? "Pro" : "Free";
  const isPremium = plan !== "free";
  const email = user.email ?? "—";
  const avatar = (user.user_metadata?.avatar_url as string | undefined) || profile?.avatar_url || null;
  const admin = isAdmin(profile?.role, user.email);
  const initial = email.charAt(0).toUpperCase();

  const groups: { heading: string; items: Row[] }[] = [
    {
      heading: "Profile",
      items: [
        { href: "/account/identity", Icon: UserCog, title: "Identity", sub: "Name, photo, video, avatar, status" },
        { href: "/account/appearance", Icon: Palette, title: "Appearance", sub: "Theme, home & feed layout" },
        { href: "/account/notifications", Icon: Bell, title: "Notifications", sub: "Alerts & activity" },
      ],
    },
    {
      heading: "Privacy & security",
      items: [
        { href: "/account/privacy", Icon: Lock, title: "Privacy", sub: "Who can see & contact you" },
        { href: "/account/security", Icon: ShieldCheck, title: "Security", sub: "2FA, passkeys, devices" },
        { href: "/account/password", Icon: KeyRound, title: "Password", sub: "Change your password" },
      ],
    },
    {
      heading: "Content & insights",
      items: [
        { href: "/downloads", Icon: Download, title: "Downloads", sub: "Your saved library" },
        { href: "/saved", Icon: Bookmark, title: "Saved", sub: "Posts you bookmarked" },
        { href: "/account/analytics", Icon: BarChart3, title: "Analytics", sub: "Your performance" },
      ],
    },
    {
      heading: "Plan & developer",
      items: [
        { href: "/account/plan", Icon: Crown, title: "Plan", sub: `${planLabel} plan · billing` },
        { href: "/account/developer", Icon: Code2, title: "Developer", sub: "API keys & usage" },
      ],
    },
  ];

  return (
    <AppContent>
      {/* No extra safe-area padding — AppTopbar (the sticky app header) already
          reserves it; adding it again doubled the top gap on notch devices. */}
      <div className="mx-auto max-w-2xl">
        <header className="mb-4">
          <h1 className="text-2xl font-bold tracking-[-0.02em] sm:text-3xl">Settings</h1>
        </header>

        {/* Profile hero */}
        <div className="mb-5 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
          <div className="h-24 w-full bg-gradient-to-br from-blue-600/30 via-sky-500/15 to-cyan-400/20 sm:h-28">
            {ownProfile?.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ownProfile.bannerUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="px-5 pb-5 sm:px-6">
            <div className="-mt-9 flex items-end justify-between gap-3">
              <div className="relative">
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt="" className="h-[72px] w-[72px] rounded-full object-cover ring-4 ring-card" />
                ) : (
                  <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-gradient-to-br from-blue-600 via-blue-500 to-cyan-400 text-2xl font-bold text-white ring-4 ring-card">
                    {initial}
                  </div>
                )}
                <DiamondCrownBadge plan={plan as BillingPlan} size="md" className="absolute -bottom-1 -right-1 ring-2 ring-card" />
              </div>
              {ownProfile?.handle ? (
                <Link href={`/u/${ownProfile.handle}`} prefetch className="mb-1 inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-medium transition hover:bg-secondary">
                  View profile
                </Link>
              ) : (
                <Link href="/account/identity" prefetch className="mb-1 inline-flex items-center rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90">
                  Set up profile
                </Link>
              )}
            </div>
            <div className="mt-3">
              <h2 className="truncate text-xl font-bold tracking-[-0.02em]">{ownProfile?.displayName || email}</h2>
              <p className="text-sm text-muted-foreground">{ownProfile?.handle ? `@${ownProfile.handle}` : email}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                {admin ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    <ShieldCheck className="h-3 w-3" /> Admin
                  </span>
                ) : null}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
                    isPremium ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {isPremium ? <Crown className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {planLabel}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Category list — each row is its own page, all prefetched on open */}
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.heading}>
              <p className="mb-1.5 px-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{g.heading}</p>
              <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
                <div className="divide-y divide-border/60">
                  {g.items.map((it) => (
                    <Link key={it.href} href={it.href} prefetch className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-secondary/40">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-inset ring-border/60">
                        <it.Icon className="h-[18px] w-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{it.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{it.sub}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {/* Admin + sign out */}
          <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
            <div className="divide-y divide-border/60">
              {admin ? (
                <Link href="/admin" className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-secondary/40">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground ring-1 ring-inset ring-border/60">
                    <ShieldCheck className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">Admin dashboard</span>
                    <span className="block truncate text-xs text-muted-foreground">Platform controls</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              ) : null}
              <form action="/auth/signout" method="post">
                <button type="submit" className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-secondary/40">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground ring-1 ring-inset ring-border/60">
                    <LogOut className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-red-500">Sign out</span>
                    <span className="block truncate text-xs text-muted-foreground">{email}</span>
                  </span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </AppContent>
  );
}
