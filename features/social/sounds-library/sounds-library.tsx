"use client";

import { ArrowLeft, Bookmark, Loader2, Music2, Pause, Play, Plus, Search, Video } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { toast } from "@/features/ui/toast";
import { LIBRARY_CHIPS, LIBRARY_GENRE_TILES, LIBRARY_TABS, reelsLabel, type LibrarySound, type LibraryTab } from "@/lib/social/sound-library-shared";
import { cn } from "@/lib/utils";

// the upload sheet is only needed after a tap — never in the page's first load
const UploadSoundSheet = dynamic(() => import("./upload-sound-sheet").then((m) => m.UploadSoundSheet), { ssr: false });

/*
  The Sounds library (design/frenz-sounds.html — owner, 2026-10-30). Built from the design in the app's own components
  and tokens, wired to real data (/api/sounds/library): every sound is a real row — a reel's original sound (0308) or an
  uploaded one — and every count is the real number of reels using it. Nothing autoplays: a sound plays only after a
  tap (lib/media/audio-playback.ts — a visitor's own music keeps playing until they choose otherwise), one at a time,
  through the single player at the bottom.
*/

/** The cover tile when a sound has no picture — the design's dark tiles, as palette classes. */
const TILE_TONES = ["bg-indigo-950", "bg-sky-950", "bg-rose-950", "bg-emerald-950", "bg-amber-950", "bg-zinc-800"];
/** Bars when a sound carries no measured peaks: flat, never an invented waveform. */
const FLAT_PEAKS = Array.from({ length: 34 }, () => 18);

export function SoundsLibrary() {
  const router = useRouter();
  const [tab, setTab] = useState<LibraryTab>("trending");
  const [chip, setChip] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [sounds, setSounds] = useState<LibrarySound[] | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const listTop = useRef<HTMLDivElement>(null);

  // the search waits for a pause in typing
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setSounds(null);
    setShowAll(false);
    const params = new URLSearchParams({ tab });
    if (chip) params.set("chip", chip);
    if (q) params.set("q", q);
    fetch(`/api/sounds/library?${params}`)
      .then((r) => r.json())
      .then((j: { sounds?: LibrarySound[]; signedIn?: boolean }) => {
        if (cancelled) return;
        setSounds(j.sounds ?? []);
        if (typeof j.signedIn === "boolean") setSignedIn(j.signedIn);
      })
      .catch(() => !cancelled && setSounds([]));
    return () => {
      cancelled = true;
    };
  }, [tab, chip, q]);

  // which sounds this member saved (and whether anyone is signed in) — once
  const loadSaves = useCallback(() => {
    fetch("/api/sounds/saves")
      .then((r) => r.json())
      .then((j: { ids?: string[]; signedIn?: boolean }) => {
        setSaved(new Set(j.ids ?? []));
        setSignedIn(!!j.signedIn);
      })
      .catch(() => {});
  }, []);
  useEffect(loadSaves, [loadSaves]);

  const player = usePlayer();

  const toggleSave = async (id: string) => {
    if (signedIn === false) return router.push(`/login?next=${encodeURIComponent("/sounds")}`);
    const next = !saved.has(id);
    setSaved((s) => {
      const n = new Set(s);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });
    const res = await fetch("/api/sounds/saves", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ soundId: id, saved: next }) }).catch(() => null);
    if (!res?.ok) {
      setSaved((s) => {
        const n = new Set(s);
        if (next) n.delete(id);
        else n.add(id);
        return n;
      });
      toast(res?.status === 401 ? "Sign in to save sounds." : "Couldn't save that sound.", "error");
    }
  };

  const pickChip = (id: string | null) => {
    setChip(id);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // the featured card is the top trending sound of the unfiltered chart — "Sound of the week"
  const featured = tab === "trending" && !chip && !q ? (sounds?.[0] ?? null) : null;
  const shown = useMemo(() => (sounds ? (showAll ? sounds : sounds.slice(0, 10)) : []), [sounds, showAll]);
  const personalLocked = (tab === "following" || tab === "saved") && signedIn === false;

  return (
    <div className="mx-auto max-w-[480px] pb-[calc(var(--frenz-nav-clearance)+5.5rem)] text-frenz-ink lg:pb-28">
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <button type="button" aria-label="Back" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} className="flex h-12 w-12 items-center justify-center rounded-full bg-frenz-fill transition active:scale-95">
          <ArrowLeft className="h-[22px] w-[22px]" />
        </button>
        <div className="flex gap-2.5">
          <button type="button" aria-label="Saved sounds" onClick={() => setTab("saved")} className="flex h-12 w-12 items-center justify-center rounded-full bg-frenz-fill transition active:scale-95">
            <Bookmark className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Upload a sound"
            onClick={() => (signedIn === false ? router.push(`/login?next=${encodeURIComponent("/sounds")}`) : setUploadOpen(true))}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-frenz-ink text-frenz-page transition active:scale-95"
          >
            <Plus className="h-5 w-5" strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <header className="px-5 pt-3.5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-frenz-violet">Frenz Audio Library</p>
        <h1 className="mt-2 text-[38px] font-extrabold leading-[1.05] tracking-[-0.03em]">Sounds</h1>
        <p className="mt-2.5 text-[15px] leading-relaxed text-frenz-muted">Original audio from creators you follow. Preview, save, and build your next Reel around it.</p>
      </header>

      <label className="mx-5 mt-5 flex h-[52px] items-center gap-2.5 rounded-2xl border border-frenz-line bg-frenz-fill px-4">
        <Search className="h-[18px] w-[18px] text-frenz-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search sounds, creators, moods"
          autoComplete="off"
          aria-label="Search sounds"
          className="flex-1 bg-transparent text-[15px] outline-none placeholder:text-frenz-muted"
        />
      </label>

      <div role="tablist" aria-label="Sound lists" className="mt-[22px] flex gap-7 overflow-x-auto border-b border-frenz-line px-5 [scrollbar-width:none]">
        {LIBRARY_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("-mb-px shrink-0 border-b-[3px] pb-3.5 text-[17px] tracking-[-0.01em]", tab === t.id ? "border-frenz-violet font-bold text-frenz-ink" : "border-transparent font-semibold text-frenz-muted")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div aria-label="Filter by mood" className="flex gap-2 overflow-x-auto px-5 pb-1 pt-[18px] [scrollbar-width:none]">
        {[{ id: null as string | null, label: "All" }, ...LIBRARY_CHIPS].map((c) => (
          <button
            key={c.id ?? "all"}
            type="button"
            aria-pressed={chip === c.id}
            onClick={() => setChip(c.id)}
            className={cn("h-[38px] shrink-0 whitespace-nowrap rounded-full border px-4 text-sm font-semibold", chip === c.id ? "border-frenz-ink bg-frenz-ink text-frenz-page" : "border-frenz-line bg-frenz-card text-frenz-ink")}
          >
            {c.label}
          </button>
        ))}
      </div>

      {featured ? <Featured sound={featured} player={player} saved={saved.has(featured.id)} onSave={() => void toggleSave(featured.id)} /> : null}

      <div ref={listTop} className="flex scroll-mt-4 items-center justify-between px-5 pb-1.5 pt-[34px]">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-frenz-blue" aria-hidden />
          <h2 className="text-[13px] font-bold uppercase tracking-[0.16em] text-frenz-muted">{sectionTitle(tab, chip, q)}</h2>
        </div>
        {sounds && sounds.length > 10 && !showAll ? (
          <button type="button" onClick={() => setShowAll(true)} className="text-sm font-semibold text-frenz-violet">
            See all
          </button>
        ) : null}
      </div>

      <div className="px-5">
        {personalLocked ? (
          <EmptyNote text={tab === "saved" ? "Sign in to keep the sounds you save." : "Sign in to hear sounds from the creators you follow."} action={{ href: `/login?next=${encodeURIComponent("/sounds")}`, label: "Sign in" }} />
        ) : sounds === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-frenz-muted" aria-label="Loading sounds" />
          </div>
        ) : !sounds.length ? (
          <EmptyNote text={emptyText(tab, chip, q)} />
        ) : (
          <ol>
            {shown.map((s, i) => (
              <ChartRow key={s.id} sound={s} rank={i + 1} tone={TILE_TONES[i % TILE_TONES.length]!} player={player} />
            ))}
          </ol>
        )}
      </div>

      <div className="flex items-center gap-2.5 px-5 pb-3.5 pt-[34px]">
        <span className="h-2 w-2 rounded-full bg-frenz-blue" aria-hidden />
        <h2 className="text-[13px] font-bold uppercase tracking-[0.16em] text-frenz-muted">Browse by genre</h2>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5">
        {LIBRARY_GENRE_TILES.map((g) => (
          <button key={g.chip} type="button" onClick={() => pickChip(g.chip)} aria-pressed={chip === g.chip} className={cn("flex h-24 flex-col justify-end gap-1 rounded-[18px] p-4 text-left transition active:scale-[0.98]", g.tone)}>
            <b className="text-base tracking-[-0.01em]">{g.label}</b>
            <small className="text-xs opacity-75">{g.line}</small>
          </button>
        ))}
      </div>

      <div className="mx-5 mt-7 flex items-center gap-4 rounded-[20px] border border-frenz-line p-5">
        <div className="flex-1">
          <p className="text-base font-bold">Make your own sound</p>
          <p className="mt-1 text-sm leading-snug text-frenz-muted">Post a Reel with original audio and it&apos;s credited to you here.</p>
        </div>
        <Link href="/create/reel" className="flex h-11 items-center rounded-full bg-frenz-ink px-[18px] text-sm font-bold text-frenz-page">
          Create
        </Link>
      </div>

      <MiniPlayer player={player} />
      {uploadOpen ? (
        <UploadSoundSheet
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onPublished={() => {
            setTab("new");
            setChip(null);
            setQuery("");
          }}
        />
      ) : null}
    </div>
  );
}

function sectionTitle(tab: LibraryTab, chip: string | null, q: string): string {
  if (q) return "Results";
  const c = chip ? LIBRARY_CHIPS.find((x) => x.id === chip)?.label : null;
  if (tab === "trending") return c ? `Top ${c}` : "Top charts";
  if (tab === "new") return c ? `New ${c}` : "New sounds";
  if (tab === "following") return "From creators you follow";
  return "Saved";
}

function emptyText(tab: LibraryTab, chip: string | null, q: string): string {
  if (q) return `No sounds match “${q}”.`;
  if (chip) return "No sounds are tagged with this yet.";
  if (tab === "following") return "Creators you follow haven't posted a sound yet.";
  if (tab === "saved") return "Sounds you save appear here.";
  return "No sounds yet. Post a Reel and its audio becomes the first one.";
}

function EmptyNote({ text, action }: { text: string; action?: { href: string; label: string } }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-frenz-muted">{text}</p>
      {action ? (
        <Link href={action.href} className="mt-3 inline-flex h-10 items-center rounded-full bg-frenz-ink px-4 text-sm font-bold text-frenz-page">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/** The design's "by" line: the creator, a downloaded sound's source (always credited — Feature 15 Part 7), the uses. */
function byLine(s: LibrarySound): string {
  const from = s.sourceType === "downloaded" && s.sourcePlatform ? ` · from ${s.sourcePlatform}` : "";
  return `${s.artistLabel}${from} · ${reelsLabel(s.uses)}`;
}

function Featured({ sound, player, saved, onSave }: { sound: LibrarySound; player: Player; saved: boolean; onSave: () => void }) {
  const on = player.current?.id === sound.id && player.playing;
  const peaks = sound.waveformPeaks.length ? downsample(sound.waveformPeaks, 34) : FLAT_PEAKS;
  const max = Math.max(1, ...peaks);
  const lit = player.current?.id === sound.id ? Math.round(player.progress * peaks.length) : 0;
  return (
    <section aria-label="Sound of the week" className="mx-5 mt-5 flex flex-col gap-[18px] rounded-3xl bg-zinc-950 p-5 text-white">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-300">Sound of the week</span>
        <span className="text-xs text-zinc-400">{reelsLabel(sound.uses)}</span>
      </div>
      <Link href={`/sound/${sound.id}`} className="flex items-center gap-3.5">
        <span className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-indigo-950">
          {sound.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the sound's own cover on our media host
            <img src={sound.coverArtUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="h-[30px] w-[30px] text-violet-300" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xl font-bold tracking-[-0.01em]">{sound.title}</span>
          <span className="mt-1 flex items-center gap-1.5 text-sm text-zinc-300">
            <span className="truncate">{sound.artistLabel}</span>
            {sound.verified ? <VerifiedTick size="sm" /> : null}
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => player.toggle(sound)} aria-label={on ? "Pause preview" : "Play preview"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950">
          {on ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
        <div className="flex h-10 flex-1 items-center gap-[3px]" aria-hidden>
          {peaks.map((p, i) => (
            <span key={i} className={cn("flex-1 rounded-sm transition-colors", i < lit ? "bg-violet-300" : "bg-zinc-700")} style={{ height: `${Math.max(4, Math.round((p / max) * 38))}px` }} />
          ))}
        </div>
      </div>
      <div className="flex gap-2.5">
        <Link href={`/create/reel?sound=${sound.id}`} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] bg-frenz-violet text-[15px] font-bold text-white">
          <Video className="h-[18px] w-[18px]" aria-hidden />
          Use this sound
        </Link>
        <button type="button" onClick={onSave} aria-label={saved ? "Unsave sound" : "Save sound"} aria-pressed={saved} className="flex h-12 w-12 items-center justify-center rounded-[14px] border border-zinc-700">
          <Bookmark className={cn("h-[18px] w-[18px]", saved && "fill-white")} />
        </button>
      </div>
    </section>
  );
}

function ChartRow({ sound, rank, tone, player }: { sound: LibrarySound; rank: number; tone: string; player: Player }) {
  const on = player.current?.id === sound.id && player.playing;
  return (
    <li className="flex items-center gap-3.5 border-b border-frenz-line py-3.5">
      <span className="w-[22px] text-center text-[15px] font-bold tabular-nums text-frenz-muted">{rank}</span>
      <button
        type="button"
        onClick={() => player.toggle(sound)}
        aria-label={on ? `Pause ${sound.title}` : `Play ${sound.title}`}
        className={cn("relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[14px] text-white", tone, player.current?.id === sound.id && "ring-[3px] ring-frenz-violet")}
      >
        {sound.coverArtUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the sound's own cover on our media host
          <img src={sound.coverArtUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : null}
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-black/35">{on ? <Pause className="h-3.5 w-3.5 fill-current" /> : <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />}</span>
      </button>
      <Link href={`/sound/${sound.id}`} className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold tracking-[-0.01em]">{sound.title}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[13px] text-frenz-muted">
          <span className="truncate">{byLine(sound)}</span>
          {sound.verified ? <VerifiedTick size="sm" /> : null}
        </span>
      </Link>
      <Link href={`/create/reel?sound=${sound.id}`} className="flex h-9 shrink-0 items-center rounded-full border border-frenz-line bg-frenz-card px-3.5 text-[13px] font-semibold">
        Use
      </Link>
    </li>
  );
}

function MiniPlayer({ player }: { player: Player }) {
  const cur = player.current;
  if (!cur) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-[calc(var(--frenz-nav-clearance)+0.5rem)] z-40 mx-auto max-w-[480px] px-3 lg:bottom-4">
      <div className="flex items-center gap-3 rounded-[18px] bg-zinc-950 px-3 py-2.5 text-white shadow-frenz-float">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-indigo-950">
          {cur.coverArtUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the sound's own cover on our media host
            <img src={cur.coverArtUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Music2 className="h-[18px] w-[18px] text-violet-300" aria-hidden />
          )}
        </span>
        <Link href={`/sound/${cur.id}`} className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{cur.title}</span>
          <span className="block truncate text-xs text-zinc-400">{cur.artistLabel}</span>
        </Link>
        <button type="button" onClick={() => player.toggle(cur)} aria-label={player.playing ? "Pause" : "Play"} className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950">
          {player.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}
        </button>
      </div>
    </div>
  );
}

type Player = ReturnType<typeof usePlayer>;

/** One <audio> for the whole page: a tap plays a sound (and stops any other); its first play is counted once. */
function usePlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const counted = useRef(new Set<string>());
  const [current, setCurrent] = useState<LibrarySound | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    const onTime = () => setProgress(el.duration ? el.currentTime / el.duration : 0);
    const onPlay = () => setPlaying(true);
    const onStop = () => setPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onStop);
    el.addEventListener("ended", onStop);
    audio.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onStop);
      el.removeEventListener("ended", onStop);
    };
  }, []);

  const toggle = useCallback(
    (s: LibrarySound) => {
      const el = audio.current;
      if (!el) return;
      if (current?.id === s.id) {
        if (el.paused) void el.play().catch(() => {});
        else el.pause();
        return;
      }
      el.pause();
      el.src = s.audioUrl;
      setCurrent(s);
      setProgress(0);
      void el.play().catch(() => toast("Couldn't play this sound.", "error"));
      if (!counted.current.has(s.id)) {
        counted.current.add(s.id);
        void fetch(`/api/sounds/${s.id}/play`, { method: "POST" }).catch(() => {});
      }
    },
    [current],
  );

  return { current, playing, progress, toggle };
}

/** A sound's measured peaks, thinned (by the loudest of each run) to the number of bars drawn. */
function downsample(peaks: number[], n: number): number[] {
  if (peaks.length <= n) return peaks;
  const step = peaks.length / n;
  return Array.from({ length: n }, (_, i) => Math.max(...peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1))));
}
