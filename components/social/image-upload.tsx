"use client";

import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState } from "react";

import { ImageCropper } from "@/components/social/image-cropper";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * Upload an image from the device (gallery/camera on mobile) straight to
 * Supabase Storage (bucket `media`, user-scoped folder). Returns the public URL.
 * Two shapes: round avatar, or wide banner. Accessible + shows progress/errors.
 */
export function ImageUpload({
  kind,
  value,
  onChange,
  className,
}: {
  kind: "avatar" | "banner";
  value: string | null;
  onChange: (url: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /*
    The chosen file waits here until it has been FRAMED.

    Previously the picker uploaded the original bytes straight through, so how a
    photo sat in the circle was decided by `object-cover` at whatever size each
    surface happened to render — a different crop in the header, the menu and a
    comment row, none of them chosen. The crop is now baked into the file, so
    every surface (including ones not written yet) shows the framing the person
    picked. See image-cropper.tsx.
  */
  const [pending, setPending] = useState<File | null>(null);

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) return setErr("Please choose an image.");
    /*
      The limit applies to what is CHOSEN, not to what is uploaded. The crop
      re-encodes to a ~512px JPEG, so the uploaded file is a fraction of this —
      but decoding a 40 MP photo to crop it still costs memory on the phone
      doing it, which is what this guards.
    */
    if (file.size > 15 * 1024 * 1024) return setErr("Image must be under 15 MB.");
    setErr(null);
    setPending(file);
  };

  /** Upload the CROPPED result and hand back its public URL. */
  const upload = async (blob: Blob) => {
    setBusy(true);
    setErr(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setErr("Please sign in.");
        return;
      }
      // Always .jpg: the cropper's canvas export is JPEG regardless of what went
      // in, so carrying the original extension would mislabel the bytes.
      const path = `${user.id}/${kind}-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("media").upload(path, blob, {
        upsert: true,
        cacheControl: "3600",
        contentType: "image/jpeg",
      });
      if (error) {
        setErr("Upload failed. Try again.");
        return;
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      onChange(`${data.publicUrl}?v=${Date.now()}`);
      setPending(null);
    } catch {
      setErr("Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const open = () => inputRef.current?.click();

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept="image/*" onChange={onFile} className="sr-only" aria-hidden tabIndex={-1} />

      {kind === "avatar" ? (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          aria-label="Change profile photo"
          className="group relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-2 ring-border"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600 to-cyan-400 text-white">
              <ImagePlus className="h-6 w-6" />
            </span>
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition group-hover:opacity-100">
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          aria-label="Change cover image"
          className="group relative block h-28 w-full overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-blue-600/30 via-sky-500/15 to-cyan-400/20 sm:h-36"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="h-full w-full object-cover" />
          ) : null}
          <span
            className={cn(
              "absolute inset-0 flex items-center justify-center gap-2 text-sm font-medium text-white transition",
              value ? "bg-black/30 opacity-0 group-hover:opacity-100" : "bg-black/10",
            )}
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-4 w-4" />}
            {busy ? "Uploading…" : "Change cover"}
          </span>
        </button>
      )}

      {err ? <p className="mt-1.5 text-xs text-red-400">{err}</p> : null}

      {/* The framing step. An avatar crops to a circle; a cover keeps its own
          wide ratio, because those are the shapes each is actually rendered in
          and cropping to the wrong one just moves the problem. */}
      {pending ? (
        <ImageCropper
          file={pending}
          aspect={kind === "avatar" ? 1 : 16 / 9}
          round={kind === "avatar"}
          busy={busy}
          onCancel={() => setPending(null)}
          onDone={(blob) => void upload(blob)}
        />
      ) : null}
    </div>
  );
}
