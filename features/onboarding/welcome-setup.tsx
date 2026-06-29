"use client";

import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import { cn } from "@/lib/utils";

const PERKS = ["Download from 20+ platforms", "Post, follow & chat with friends", "Trending reels & latest news"];

/** First-run onboarding — a user must claim a username before using the app. */
export function WelcomeSetup({
  email,
  initialDisplayName,
  initialAvatarUrl,
}: {
  email: string | null;
  initialDisplayName: string;
  initialAvatarUrl: string | null;
}) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState(initialDisplayName || (email ? email.split("@")[0] ?? "" : ""));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialAvatarUrl);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const cleanHandle = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  const valid = cleanHandle.length >= 3 && cleanHandle.length <= 20;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: cleanHandle,
          display_name: displayName.trim() || cleanHandle,
          avatar_url: avatarUrl || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Couldn't save. Try another username.");
        return;
      }
      router.replace("/home");
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-blue-600 via-violet-600 to-purple-700 p-12 text-white lg:flex lg:flex-col lg:justify-center">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/15 blur-3xl motion-safe:animate-drift" />
        <span className="relative inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-bold uppercase tracking-wide ring-1 ring-inset ring-white/25">
          <Sparkles className="h-3.5 w-3.5" /> Welcome to Frenz
        </span>
        <h1 className="relative mt-5 max-w-md text-4xl font-extrabold leading-[1.05] tracking-[-0.03em]">
          Let&apos;s set up your account
        </h1>
        <p className="relative mt-3 max-w-sm text-white/85">Pick a username and you&apos;re in — it&apos;s how friends find you on Frenz.</p>
        <ul className="relative mt-8 space-y-3">
          {PERKS.map((p) => (
            <li key={p} className="flex items-center gap-3 text-sm text-white/90">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15"><Check className="h-3.5 w-3.5" /></span>
              {p}
            </li>
          ))}
        </ul>
      </aside>

      {/* Form */}
      <section className="flex flex-col items-center justify-center px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-extrabold tracking-[-0.02em]">Create your profile</h2>
          <p className="mb-7 mt-1 text-sm text-muted-foreground">This takes less than a minute.</p>

          {/* Avatar */}
          <div className="mb-5 flex items-center gap-4">
            <ImageUpload kind="avatar" value={avatarUrl} onChange={setAvatarUrl} />
            <div className="text-sm">
              <p className="font-medium">Profile photo</p>
              <p className="text-muted-foreground">Optional — tap to upload.</p>
            </div>
          </div>

          {/* Username */}
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Username</label>
          <div className="flex h-12 items-center rounded-xl bg-background ring-1 ring-inset ring-border transition focus-within:ring-2 focus-within:ring-primary">
            <span className="pl-3.5 text-sm text-muted-foreground">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value.toLowerCase())}
              placeholder="yourname"
              autoFocus
              aria-label="Username"
              className="h-full w-full rounded-xl bg-transparent px-1.5 text-sm outline-none"
            />
            {valid ? <Check className="mr-3 h-4 w-4 text-emerald-500" /> : null}
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">3–20 letters, numbers or underscores. You&apos;ll be <span className="font-medium text-foreground">@{cleanHandle || "yourname"}</span></p>

          {/* Display name */}
          <label className="mb-1.5 mt-4 block text-xs font-medium text-muted-foreground">Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={40}
            placeholder="Your name"
            aria-label="Display name"
            className="h-12 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />

          {err ? <p className="mt-3 text-sm text-red-400">{err}</p> : null}

          <button
            type="button"
            onClick={submit}
            disabled={!valid || busy}
            className={cn(
              "mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white shadow-lg transition",
              valid && !busy ? "bg-gradient-to-r from-blue-600 to-violet-600 hover:opacity-95" : "cursor-not-allowed bg-muted-foreground/40",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Enter Frenz <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>
    </main>
  );
}
