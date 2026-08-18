"use client";

import { Check, Globe, Loader2, Lock, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import { ProfileVideoUpload } from "@/features/social/profile-video-upload";
import type { IdentityFieldKey } from "@/features/social/identity-fields";
import { PROFILE_ACCENTS, PROFILE_MOODS } from "@/lib/social/profile-moods";
import type { IdentityMode, Visibility } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

/**
 * One Identity field, on its own screen — the drill-down half of the reference
 * list (public/profile settings.jpg).
 *
 * Each screen owns exactly one PATCH to /api/profile, so a member can change
 * their username without the request also carrying (and potentially clobbering)
 * every other field on the profile, which is what the old single-form editor did.
 */

export interface IdentityValues {
  displayName: string;
  handle: string;
  bio: string;
  website: string;
  visibility: Visibility;
  status: string;
  mood: string;
  accent: string;
  videoUrl: string;
  avatarMediaUrl: string;
  identityMode: IdentityMode;
}

const VISIBILITY: { value: Visibility; label: string; blurb: string; icon: typeof Globe }[] = [
  { value: "public", label: "Everyone", blurb: "Anyone can see your profile and posts.", icon: Globe },
  { value: "followers", label: "Followers", blurb: "Only people who follow you.", icon: Users },
  { value: "private", label: "Only me", blurb: "Your profile is hidden from everyone else.", icon: Lock },
];

const INPUT =
  "h-11 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";

export function IdentityFieldEditor({ field, values }: { field: IdentityFieldKey; values: IdentityValues }) {
  const router = useRouter();
  const [v, setV] = useState<IdentityValues>(values);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patch = async (body: Record<string, unknown>, quiet = false) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setMsg({ ok: false, text: json.error ?? "Couldn't save that." });
        return false;
      }
      if (!quiet) setMsg({ ok: true, text: "Saved." });
      router.refresh();
      return true;
    } catch {
      setMsg({ ok: false, text: "Network error." });
      return false;
    } finally {
      setBusy(false);
    }
  };

  /* Media and choice fields save the moment they change — there is nothing to
     "compose", and a picker that needed a second confirming tap would be worse. */

  const onVideo = async (url: string) => {
    const mode: IdentityMode = url ? "video" : v.identityMode === "video" ? "photo" : v.identityMode;
    setV((s) => ({ ...s, videoUrl: url, identityMode: mode }));
    await patch({ profile_video_url: url || null, identity_mode: mode }, true);
  };

  const onAvatarMedia = async (url: string) => {
    const mode: IdentityMode = url ? "avatar" : v.identityMode === "avatar" ? "photo" : v.identityMode;
    setV((s) => ({ ...s, avatarMediaUrl: url, identityMode: mode }));
    await patch({ profile_avatar_url: url || null, identity_mode: mode }, true);
  };

  const setMode = async (mode: IdentityMode) => {
    setV((s) => ({ ...s, identityMode: mode }));
    await patch({ identity_mode: mode });
  };

  const setVisibility = async (visibility: Visibility) => {
    setV((s) => ({ ...s, visibility }));
    await patch({ visibility });
  };

  const setAccent = async (accent: string) => {
    setV((s) => ({ ...s, accent }));
    await patch({ accent: accent || null });
  };

  const body = () => {
    switch (field) {
      case "video":
        return <ProfileVideoUpload value={v.videoUrl || null} onChange={(u) => void onVideo(u)} />;

      case "avatar":
        return <ImageUpload kind="avatar" value={v.avatarMediaUrl || null} onChange={(u) => void onAvatarMedia(u)} />;

      case "display-mode":
        return (
          <div className="space-y-2">
            {(["photo", "video", "avatar"] as const).map((m) => {
              const missing = (m === "video" && !v.videoUrl) || (m === "avatar" && !v.avatarMediaUrl);
              return (
                <button
                  key={m}
                  type="button"
                  disabled={missing}
                  onClick={() => void setMode(m)}
                  aria-pressed={v.identityMode === m}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition disabled:opacity-50",
                    v.identityMode === m ? "border-primary bg-primary/5" : "border-border/70 hover:border-foreground/20",
                  )}
                >
                  <span className="flex-1">
                    <span className="block text-sm font-semibold capitalize">{m}</span>
                    <span className="block text-xs text-muted-foreground">
                      {missing ? `Upload ${m === "video" ? "a profile video" : "an avatar image"} first` : `Visitors see your ${m}.`}
                    </span>
                  </span>
                  {v.identityMode === m ? <Check className="h-5 w-5 shrink-0 text-primary" /> : null}
                </button>
              );
            })}
          </div>
        );

      case "visibility":
        return (
          <div className="space-y-2">
            {VISIBILITY.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => void setVisibility(o.value)}
                aria-pressed={v.visibility === o.value}
                className={cn(
                  "flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left transition",
                  v.visibility === o.value ? "border-primary bg-primary/5" : "border-border/70 hover:border-foreground/20",
                )}
              >
                <o.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-xs text-muted-foreground">{o.blurb}</span>
                </span>
                {v.visibility === o.value ? <Check className="h-5 w-5 shrink-0 text-primary" /> : null}
              </button>
            ))}
          </div>
        );

      case "name":
        return (
          <Save onSave={() => patch({ display_name: v.displayName.trim() || null })} busy={busy}>
            <input
              className={INPUT}
              value={v.displayName}
              onChange={(e) => setV((s) => ({ ...s, displayName: e.target.value }))}
              placeholder="Your name"
              maxLength={60}
              autoFocus
            />
          </Save>
        );

      case "username":
        return (
          <Save onSave={() => patch({ handle: v.handle.trim() || undefined })} busy={busy}>
            <div className="flex h-11 items-center rounded-xl bg-background ring-1 ring-inset ring-border transition focus-within:ring-2 focus-within:ring-primary">
              <span className="pl-3.5 text-sm text-muted-foreground">@</span>
              <input
                value={v.handle}
                onChange={(e) => setV((s) => ({ ...s, handle: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                placeholder="yourname"
                maxLength={30}
                className="h-full w-full rounded-xl bg-transparent px-1.5 text-sm outline-none"
                autoFocus
              />
            </div>
          </Save>
        );

      case "bio":
        return (
          <Save onSave={() => patch({ bio: v.bio.trim() || null })} busy={busy}>
            <textarea
              value={v.bio}
              onChange={(e) => setV((s) => ({ ...s, bio: e.target.value }))}
              maxLength={280}
              placeholder="Tell people about yourself"
              className="min-h-[120px] w-full rounded-xl bg-background p-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <p className="mt-1.5 text-right text-xs text-muted-foreground">{v.bio.length}/280</p>
          </Save>
        );

      case "status":
        return (
          <Save onSave={() => patch({ status: v.status.trim() || null, mood: v.mood || null })} busy={busy}>
            <div className="space-y-2">
              <input
                className={INPUT}
                value={v.status}
                onChange={(e) => setV((s) => ({ ...s, status: e.target.value }))}
                maxLength={80}
                placeholder="What are you up to?"
              />
              <select
                className={cn(INPUT, "appearance-none")}
                value={v.mood}
                onChange={(e) => setV((s) => ({ ...s, mood: e.target.value }))}
              >
                <option value="">No mood</option>
                {PROFILE_MOODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </Save>
        );

      case "accent":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void setAccent("")}
              aria-pressed={v.accent === ""}
              className={cn(
                "inline-flex h-10 items-center rounded-xl border px-3.5 text-xs font-semibold transition",
                v.accent === "" ? "border-primary text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
              )}
            >
              Default
            </button>
            {PROFILE_ACCENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => void setAccent(a.key)}
                aria-pressed={v.accent === a.key}
                aria-label={a.label}
                title={a.label}
                className={cn(
                  "h-10 w-10 rounded-xl ring-2 ring-offset-2 ring-offset-background transition",
                  v.accent === a.key ? "ring-foreground" : "ring-transparent hover:ring-border",
                )}
                style={{ background: a.hex }}
              />
            ))}
          </div>
        );

      case "links":
        return (
          <Save onSave={() => patch({ website: v.website.trim() || null })} busy={busy}>
            <input
              className={INPUT}
              value={v.website}
              onChange={(e) => setV((s) => ({ ...s, website: e.target.value }))}
              placeholder="https://your-business.com"
              inputMode="url"
              autoFocus
            />
          </Save>
        );

      default:
        return null;
    }
  };

  return (
    <div>
      {body()}
      {busy && !msg ? (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </p>
      ) : null}
      {msg ? <p className={cn("mt-3 text-sm font-medium", msg.ok ? "text-emerald-500" : "text-rose-500")}>{msg.text}</p> : null}
    </div>
  );
}

/** Free-text fields need an explicit save; pickers don't. */
function Save({ children, onSave, busy }: { children: React.ReactNode; onSave: () => Promise<boolean>; busy: boolean }) {
  return (
    <div>
      {children}
      <button type="button" onClick={() => void onSave()} disabled={busy} className="btn-lux btn-lux-primary mt-4">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
      </button>
    </div>
  );
}
