"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { IdentityBadges } from "@/components/badges/identity-badges";
import { ImageUpload } from "@/components/social/image-upload";
import type { BillingPlan } from "@/lib/monetization/types";

/**
 * The Identity page's hero (owner reference: public/profile settings.jpg) —
 * cover, avatar with its camera badge, name + badges, and "View profile".
 *
 * Cover and avatar save the INSTANT they're uploaded. On a drill-down settings
 * page there is no "Save changes" button at the bottom to press, and a picture
 * that silently reverted when you navigated away would be the worst possible
 * behaviour here.
 */
export function IdentityHero({
  handle,
  displayName,
  bannerUrl,
  avatarUrl,
  verified,
  plan,
}: {
  handle: string | null;
  displayName: string | null;
  bannerUrl: string | null;
  avatarUrl: string | null;
  verified: boolean;
  plan: BillingPlan;
}) {
  const router = useRouter();
  const [banner, setBanner] = useState(bannerUrl ?? "");
  const [avatar, setAvatar] = useState(avatarUrl ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (patch: Record<string, string | null>) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setError(json.error ?? "Couldn't save that.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      <div className="relative">
        <ImageUpload
          kind="banner"
          value={banner || null}
          onChange={(url) => {
            setBanner(url);
            void save({ banner_url: url || null });
          }}
        />
        <div className="absolute -bottom-8 left-4">
          <ImageUpload
            kind="avatar"
            value={avatar || null}
            onChange={(url) => {
              setAvatar(url);
              void save({ avatar_url: url || null });
            }}
          />
        </div>
      </div>

      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-10 sm:px-5">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-bold tracking-[-0.01em]">
            <span className="truncate">{displayName || "Your name"}</span>
            <IdentityBadges verified={verified} plan={plan} size="sm" />
          </h2>
          <p className="text-sm text-muted-foreground">@{handle || "username"}</p>
        </div>
        {handle ? (
          <Link href={`/u/${handle}`} prefetch className="btn-lux btn-lux-secondary shrink-0">
            View profile <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>

      {saving ? (
        <p className="flex items-center gap-1.5 px-4 pb-3 text-xs text-muted-foreground sm:px-5">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </p>
      ) : null}
      {error ? <p className="px-4 pb-3 text-xs font-medium text-rose-500 sm:px-5">{error}</p> : null}
    </div>
  );
}
