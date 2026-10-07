"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { ImageUploadButton, VideoUploadButton, shrinkForUpload } from "@/features/admin/ai-showcase-editor";
import { CARD_TOOLS, type CardToolId, type ShowcaseCardMedia, type ShowcaseCards } from "@/lib/ai/showcase/cards";
import { SHOWCASE_VIDEO, type ShowcaseImage, type ShowcaseVideo } from "@/lib/ai/showcase/slides";
import { cn } from "@/lib/utils";

/**
 * Admin → Frenz AI → "Tool cards" (owner, 2026-10-07: "this page showcase
 * cards isn't set up in admin"). One picture per card on the Frenz AI hub, and
 * optionally a short clip that plays muted while the card is on screen. Same
 * upload route and bucket as the welcome showcase; nothing is public until
 * Save. A card with nothing uploaded keeps its drawn art (or a slide's
 * picture, if a slide opens that tool).
 */
export function AiToolCardsEditor({ initial }: { initial: ShowcaseCards }) {
  const [cards, setCards] = useState<ShowcaseCards>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const patch = (id: CardToolId, next: Partial<ShowcaseCardMedia> | null) => {
    setCards((c) => {
      const out = { ...c };
      if (next === null) delete out[id];
      else out[id] = { image: null, video: null, ...c[id], ...next };
      return out;
    });
    setDirty(true);
  };

  const uploadImage = async (id: CardToolId, picked: File) => {
    setBusy(`${id}:image`);
    setMsg(null);
    try {
      const file = picked.size > 4 * 1024 * 1024 ? await shrinkForUpload(picked) : picked;
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/ai/showcase", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; image?: ShowcaseImage };
      if (!res.ok || !json.ok || !json.image) {
        setMsg({ ok: false, text: json.error ?? "Upload failed." });
        return;
      }
      patch(id, { image: json.image });
      setMsg({ ok: true, text: `${CARD_TOOLS[id]}: picture ready. Press Save to publish.` });
    } finally {
      setBusy(null);
    }
  };

  const uploadVideo = async (id: CardToolId, file: File) => {
    setMsg(null);
    if (!(SHOWCASE_VIDEO.mimeTypes as readonly string[]).includes(file.type)) return setMsg({ ok: false, text: "Use an MP4 or WebM video." });
    if (file.size > SHOWCASE_VIDEO.maxBytes) return setMsg({ ok: false, text: `That video is over ${Math.round(SHOWCASE_VIDEO.maxBytes / (1024 * 1024))} MB — trim it to a few seconds.` });
    setBusy(`${id}:video`);
    setPct(0);
    try {
      const res = await fetch("/api/admin/ai/showcase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "video", contentType: file.type, size: file.size }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; uploadUrl?: string; video?: ShowcaseVideo };
      if (!res.ok || !json.ok || !json.uploadUrl || !json.video) {
        setMsg({ ok: false, text: json.error ?? "Could not start the upload." });
        return;
      }
      // straight to storage — the bytes never pass through a Vercel function
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", json.uploadUrl!, true);
        xhr.setRequestHeader("content-type", file.type);
        xhr.setRequestHeader("cache-control", "max-age=31536000");
        xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Storage answered ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("The upload was interrupted."));
        xhr.send(file);
      });
      patch(id, { video: json.video });
      setMsg({ ok: true, text: `${CARD_TOOLS[id]}: video ready (${(file.size / (1024 * 1024)).toFixed(1)} MB). Press Save to publish.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(null);
      setPct(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setMsg(null);
    try {
      const res = await fetch("/api/admin/ai/showcase", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; cards?: ShowcaseCards };
      if (res.ok && json.ok && json.cards) {
        setCards(json.cards);
        setDirty(false);
        setMsg({ ok: true, text: "Saved. The Frenz AI page shows these cards now." });
      } else {
        setMsg({ ok: false, text: json.error ?? "Failed to save." });
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-3xl border border-border bg-card px-3 py-6 shadow-card sm:px-6">
      <h2 className="mb-1 font-semibold">Tool cards</h2>
      <p className="mb-5 text-sm text-muted-foreground">
        The picture on each card of the Frenz AI page. Add a short video too and it plays muted while the card is on screen (the picture shows first, and stays for visitors with reduced motion or data saver). A card without a picture keeps its drawn art.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(CARD_TOOLS) as CardToolId[]).map((id) => {
          const card = cards[id];
          return (
            <li key={id} className="overflow-hidden rounded-2xl border border-border">
              <div className="relative aspect-[16/10] bg-gradient-to-br from-indigo-950 to-slate-900">
                {card?.image ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the stored 720 px webp, exactly what the card shows
                  <img src={card.image.sm} alt="" className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <span className="absolute inset-0 flex items-center justify-center text-xs text-white/60">No picture yet</span>
                )}
                {card?.video ? <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">+ video</span> : null}
              </div>
              <div className="flex flex-col gap-2 p-3">
                <p className="text-sm font-semibold">{CARD_TOOLS[id]}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <ImageUploadButton busy={busy === `${id}:image`} hasImage={!!card?.image} onFile={(f) => void uploadImage(id, f)} />
                  {card?.image ? (
                    <VideoUploadButton
                      busy={busy === `${id}:video`}
                      label={busy === `${id}:video` ? `Uploading ${pct ?? 0}%` : card.video ? "Replace video" : "Add video"}
                      onFile={(f) => void uploadVideo(id, f)}
                    />
                  ) : null}
                  {card?.video ? (
                    <button type="button" onClick={() => patch(id, { video: null })} className="min-h-[40px] rounded-full border border-border px-3 text-xs font-semibold">
                      Remove video
                    </button>
                  ) : null}
                  {card?.image ? (
                    <button type="button" aria-label={`Remove ${CARD_TOOLS[id]} picture`} onClick={() => patch(id, null)} className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full border border-border text-rose-500">
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy !== null || !dirty}
          className="inline-flex h-11 items-center justify-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {dirty ? <span className="text-xs text-muted-foreground">Unsaved changes</span> : null}
        {msg ? <p role="status" className={cn("text-sm", msg.ok ? "text-emerald-600" : "text-rose-600")}>{msg.text}</p> : null}
      </div>
    </section>
  );
}
