"use client";

import { ExternalLink, Loader2, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { OwnProfile, Visibility } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

const VISIBILITY: { value: Visibility; label: string; hint: string }[] = [
  { value: "public", label: "Public", hint: "Anyone can view your profile" },
  { value: "followers", label: "Followers", hint: "Only approved followers" },
  { value: "private", label: "Private", hint: "Only you" },
];

export function ProfileEditor({ profile }: { profile: OwnProfile }) {
  const router = useRouter();
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? "");
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
          banner_url: bannerUrl.trim() || null,
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
    "h-10 w-full rounded-xl bg-background px-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary";
  const label = "mb-1 block text-xs font-medium text-muted-foreground";

  return (
    <div id="profile" className="scroll-mt-24 border-b border-border/60 p-6 sm:p-8">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <UserCircle className="h-5 w-5 text-primary" /> Public profile
        </h2>
        {handle ? (
          <Link
            href={`/u/${handle}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View <ExternalLink className="h-3 w-3" />
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Username (handle)</label>
          <div className="flex items-center rounded-xl bg-background ring-1 ring-inset ring-border focus-within:ring-2 focus-within:ring-primary">
            <span className="pl-3 text-sm text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="yourname"
              className="h-10 w-full rounded-xl bg-transparent px-1.5 text-sm outline-none"
            />
          </div>
        </div>
        <div>
          <label className={label}>Display name</label>
          <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </div>
        <div className="sm:col-span-2">
          <label className={label}>Bio</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="A short bio (max 280 chars)"
            className="min-h-[72px] w-full rounded-xl bg-background p-3 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className={label}>Website</label>
          <input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
        </div>
        <div>
          <label className={label}>Banner image URL</label>
          <input className={input} value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://…" />
        </div>
      </div>

      <div className="mt-4">
        <label className={label}>Profile visibility</label>
        <div className="grid grid-cols-3 gap-2">
          {VISIBILITY.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setVisibility(v.value)}
              aria-pressed={visibility === v.value}
              className={cn(
                "rounded-xl border p-2.5 text-left transition",
                visibility === v.value
                  ? "border-primary bg-primary/10"
                  : "border-border/70 hover:border-foreground/20",
              )}
            >
              <span className="block text-sm font-semibold">{v.label}</span>
              <span className="block text-[11px] text-muted-foreground">{v.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save profile
        </button>
        {msg ? (
          <span className={cn("text-sm", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span>
        ) : null}
      </div>
    </div>
  );
}
