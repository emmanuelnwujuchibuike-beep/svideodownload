"use client";

import { AtSign, Check, ExternalLink, Eye, FileText, Globe, Image as ImageIcon, Link as LinkIcon, Loader2, Lock, Palette, Pencil, Smile, Sparkles, UserRound, Users, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { ImageUpload } from "@/components/social/image-upload";
import { SETTINGS_TINTS, SettingsGroup } from "@/features/account/settings-ui";
import { ProfileVideoUpload } from "@/features/social/profile-video-upload";
import { PROFILE_ACCENTS, PROFILE_MOODS, type IdentityMode, type OwnProfile, type Visibility } from "@/lib/social/profile";
import { cn } from "@/lib/utils";

const VISIBILITY: { value: Visibility; label: string; icon: typeof Globe }[] = [
  { value: "public", label: "Public", icon: Globe },
  { value: "followers", label: "Followers", icon: Users },
  { value: "private", label: "Private", icon: Lock },
];

/** A settings field presented like the reference (public/profile settings.jpg):
 *  a tinted icon tile + title/description, with the editing control below it. */
function FieldRow({
  icon: Icon,
  tint,
  title,
  tag,
  description,
  children,
}: {
  icon: typeof Globe;
  tint: string;
  title: string;
  tag?: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", SETTINGS_TINTS[tint] ?? SETTINGS_TINTS.slate)}>
          <Icon className="h-[19px] w-[19px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{title}</span>
            {tag ? <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{tag}</span> : null}
          </div>
          {description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children ? <div className="mt-2.5">{children}</div> : null}
    </div>
  );
}

export function ProfileEditor({
  profile,
  extras,
  media,
}: {
  profile: OwnProfile;
  extras?: { status: string | null; mood: string | null; accent: string | null };
  media?: { videoUrl: string | null; avatarUrl: string | null; identityMode: IdentityMode };
}) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState(profile.avatarUrl ?? "");
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? "");
  const [handle, setHandle] = useState(profile.handle ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [website, setWebsite] = useState(profile.website ?? "");
  const [status, setStatus] = useState(extras?.status ?? "");
  const [mood, setMood] = useState(extras?.mood ?? "");
  const [accent, setAccent] = useState(extras?.accent ?? "");
  const [profileVideoUrl, setProfileVideoUrl] = useState(media?.videoUrl ?? "");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState(media?.avatarUrl ?? "");
  const [identityMode, setIdentityMode] = useState<IdentityMode>(media?.identityMode ?? "photo");
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
          status: status.trim() || null,
          mood: mood || null,
          accent: accent || null,
          profile_video_url: profileVideoUrl || null,
          profile_avatar_url: profileAvatarUrl || null,
          identity_mode: identityMode,
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
    "h-10 w-full rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary";
  const seg = (active: boolean) =>
    cn(
      "flex items-center justify-center gap-1.5 rounded-xl border py-2 text-sm font-semibold capitalize transition",
      active ? "border-primary bg-primary/10 text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20",
    );

  // Uploading a video or avatar makes it what visitors see, immediately — the
  // owner shouldn't have to separately flip a "show as" switch after uploading.
  // Removing the active one falls back to your photo.
  const onVideoChange = (url: string) => {
    setProfileVideoUrl(url);
    if (url) setIdentityMode("video");
    else if (identityMode === "video") setIdentityMode("photo");
  };
  const onAvatarMediaChange = (url: string) => {
    setProfileAvatarUrl(url);
    if (url) setIdentityMode("avatar");
    else if (identityMode === "avatar") setIdentityMode("photo");
  };

  return (
    <div>
      {/* Hero — cover + avatar + identity + view profile (design: profile settings.jpg) */}
      <div className="relative">
        <ImageUpload kind="banner" value={bannerUrl || null} onChange={setBannerUrl} />
        <div className="absolute -bottom-7 left-3">
          <ImageUpload kind="avatar" value={avatarUrl || null} onChange={setAvatarUrl} />
        </div>
      </div>
      <div className="mb-1 mt-9 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 truncate text-base font-bold tracking-[-0.01em]">
            {displayName || "Your name"}
            {profile.handle ? <Sparkles className="h-4 w-4 shrink-0 text-violet-500" /> : null}
          </h2>
          <p className="text-sm text-muted-foreground">@{handle || "username"}</p>
        </div>
        {profile.handle ? (
          <Link href={`/u/${profile.handle}`} className="btn-lux btn-lux-secondary shrink-0">
            View profile <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>

      {/* Digital identity */}
      <SettingsGroup label="DIGITAL IDENTITY" description="Uploading a video or avatar makes it your profile display right away.">
        <FieldRow icon={Video} tint="violet" title="Profile video" tag="Optional" description="A ~3-second clip. Silent, loops. Under 20 MB.">
          <ProfileVideoUpload value={profileVideoUrl || null} onChange={onVideoChange} />
        </FieldRow>
        <FieldRow icon={UserRound} tint="blue" title="Avatar image" tag="Optional" description="Show your style with an avatar image.">
          <ImageUpload kind="avatar" value={profileAvatarUrl || null} onChange={onAvatarMediaChange} />
        </FieldRow>
        <FieldRow icon={ImageIcon} tint="purple" title="Show on your profile" description="Which identity visitors see by default.">
          <div className="grid grid-cols-3 gap-2">
            {(["photo", "video", "avatar"] as const).map((m) => (
              <button key={m} type="button" onClick={() => setIdentityMode(m)} aria-pressed={identityMode === m} className={seg(identityMode === m)}>
                {m}
              </button>
            ))}
          </div>
        </FieldRow>
        <FieldRow icon={Eye} tint="emerald" title="Profile visibility" description="Choose who can see your profile.">
          <div className="grid grid-cols-3 gap-2">
            {VISIBILITY.map((v) => (
              <button key={v.value} type="button" onClick={() => setVisibility(v.value)} aria-pressed={visibility === v.value} className={seg(visibility === v.value)}>
                <v.icon className="h-4 w-4" /> {v.label}
              </button>
            ))}
          </div>
        </FieldRow>
      </SettingsGroup>

      {/* Details */}
      <SettingsGroup label="DETAILS">
        <FieldRow icon={Pencil} tint="amber" title="Name">
          <input className={input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Your name" />
        </FieldRow>
        <FieldRow icon={AtSign} tint="purple" title="Username">
          <div className="flex h-11 items-center rounded-xl bg-background ring-1 ring-inset ring-border transition focus-within:ring-2 focus-within:ring-primary">
            <span className="pl-3.5 text-sm text-muted-foreground">@</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase())} placeholder="yourname" className="h-full w-full rounded-xl bg-transparent px-1.5 text-sm outline-none" />
          </div>
        </FieldRow>
        <FieldRow icon={FileText} tint="blue" title="Bio">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={280}
            placeholder="Tell people about yourself (max 280 characters)"
            className="min-h-[80px] w-full rounded-xl bg-background p-3.5 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
          />
        </FieldRow>
        <FieldRow icon={Smile} tint="rose" title="Status & mood" description="A short line about what you're up to.">
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={input} value={status} onChange={(e) => setStatus(e.target.value)} maxLength={80} placeholder="What are you up to?" />
            <select className={cn(input, "appearance-none")} value={mood} onChange={(e) => setMood(e.target.value)}>
              <option value="">No mood</option>
              {PROFILE_MOODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </FieldRow>
        <FieldRow icon={Palette} tint="violet" title="Accent colour" description="Shown on your profile.">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setAccent("")}
              aria-pressed={accent === ""}
              className={cn("inline-flex h-9 items-center rounded-xl border px-3 text-xs font-semibold transition", accent === "" ? "border-primary text-primary" : "border-border/70 text-muted-foreground hover:border-foreground/20")}
            >
              Default
            </button>
            {PROFILE_ACCENTS.map((a) => (
              <button
                key={a.key}
                type="button"
                onClick={() => setAccent(a.key)}
                aria-pressed={accent === a.key}
                aria-label={a.label}
                title={a.label}
                className={cn("h-9 w-9 rounded-xl ring-2 ring-offset-2 ring-offset-background transition", accent === a.key ? "ring-foreground" : "ring-transparent hover:ring-border")}
                style={{ background: a.hex }}
              />
            ))}
          </div>
        </FieldRow>
        <FieldRow icon={LinkIcon} tint="cyan" title="Links" description="Add your website or business link.">
          <input className={input} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://your-business.com" />
        </FieldRow>
      </SettingsGroup>

      {/* Save */}
      <div className="mt-6 flex items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className="btn-lux btn-lux-primary">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save changes
        </button>
        {msg ? <span className={cn("text-sm font-medium", msg.ok ? "text-green-500" : "text-red-400")}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
