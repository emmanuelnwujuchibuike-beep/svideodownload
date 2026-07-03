"use client";

import { ExternalLink, Globe, Loader2, Lock, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import type { OwnProfile, Visibility } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

const VISIBILITY: { value: Visibility; label: string; hint: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", hint: "Anyone can view", icon: Globe },
  { value: "followers", label: "Followers", hint: "Approved followers", icon: Users },
  { value: "private", label: "Private", hint: "Only you", icon: Lock },
];

export function ProfileEditor({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? "");
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [visibility, setVisibility] = useState<Visibility>(profile.visibility);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: handle.trim() || undefined,
          display_name: displayName.trim() || null,
          bio: bio.trim() || null,
          website: website.trim() || null,
          avatar_url: avatarUrl || null,
          banner_url: bannerUrl || null,
          visibility,
        }),
      });
      const json = await res.json();
      setMsg(res.ok ? { ok: true, text: "Profile saved." } : { ok: false, text: json.error ?? "Failed to save." });
      if (res.ok) router.refresh();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  };

  const input =
    "h-11 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";
  const label = "mb-1.5 block text-xs font-medium text-muted-foreground";

  return (
    <div id="profile" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <div className="mb-5 flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Edit profile</h2>
        {handle ? (
          <Link href={`/u/${handle}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View profile <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      {/* Cover + avatar */}
      <div className="relative mb-12">
        <ImageUpload kind="banner" value={bannerUrl || null} onChange={setBannerUrl} />
        <div className="absolute -bottom-9 left-4">
          <ImageUpload kind="avatar" value={avatarUrl || null} onChange={setAvatarUrl} />
        </div>
      </div>
      <p className="mb-5 text-xs text-muted-foreground">
        Tap the cover or photo to upload from your device.
      </p>

      {/* Fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Display name</label>
          <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div>
          <label className={label}>Username</label>
          <div className="flex h-11 items-center rounded-xl bg-background ring-1 ring-inset ring-border transition focus-within:ring-2 focus-within:ring-primary">
            <span className="pl-3.5 text-sm text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="yourname"
              className="h-full w-full rounded-xl bg-transparent px-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="Tell people about yourself (max 280 characters)"
            className="min-h-[80px] w-full rounded-xl bg-background p-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Business link <span className="font-normal text-muted-foreground/70">· optional</span></label>
          <input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://your-business.com" />
        </div>
      </div>

      {/* Visibility */}
      <div className="mt-5">
        <label className={label}>Who can see your profile</label>
        <div className="grid grid-cols-3 gap-2">
          {VISIBILITY.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVisibility(v.value)}
              aria-pressed={visibility === v.value}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border p-3 text-center transition",
                visibility === v.value ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
              )}
            >
              <v.icon className="h-4 w-4" />
              <span className="text-sm font-semibold">{v.label}</span>
              <span className="text-[10px]">{v.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save profile
        </button>
        {msg ? <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
