"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Camera, File as FileIcon, Images, MapPin, Music, User, Video as VideoIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import { ALLOWED_MIME } from "@/lib/social/message-media";

/**
 * The "+" attachment picker — Camera / Gallery / Video / Document / Audio /
 * Location / Contact / Poll (owner mockup completion; previously just
 * Camera/Gallery/Document/Audio — see docs/PROJECT_NOTES.md's Part 5 entry
 * for what's still genuinely out of reach: Cloud/Life Memories/Moments/
 * Events/AI content need infrastructure this app doesn't have). Camera vs
 * Gallery are genuinely distinct (not just two labels on the same picker):
 * Camera sets `capture` so mobile browsers open the camera directly instead
 * of the file/photo library. Video is the same Gallery input, filtered to
 * `video/*` — a dedicated tile since the mockup shows one, even though
 * Gallery already accepted video files.
 */
export function MediaComposerSheet({
  open,
  onClose,
  onFilesPicked,
  onShareLocation,
  onOpenContactPicker,
  onOpenPollComposer,
}: {
  open: boolean;
  onClose: () => void;
  onFilesPicked: (files: File[], kind: "image" | "video" | "document" | "audio") => void;
  onShareLocation: () => void;
  onOpenContactPicker: () => void;
  onOpenPollComposer: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLInputElement | null>(null);
  const documentRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLInputElement | null>(null);

  const pick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const images = list.filter((f) => f.type.startsWith("image/"));
    const videos = list.filter((f) => f.type.startsWith("video/"));
    if (images.length) onFilesPicked(images, "image");
    if (videos.length) onFilesPicked(videos, "video");
    onClose();
  };

  if (!mounted) return null;
  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[110]" role="dialog" aria-modal="true" aria-label="Add to message">
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={springs.sheet}
            className="glass-strong absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg overflow-hidden rounded-t-3xl sm:bottom-6 sm:rounded-3xl"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 className="text-base font-bold tracking-tight">Add to message</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Order + per-icon tile color matches the owner's mockup exactly:
                row 1 Gallery/Camera/Video/Audio, row 2 Location/Contact/
                Document/Poll — was Camera-first with every tile the same
                blue-violet gradient, a different order and a flatter look. */}
            <div className="grid grid-cols-4 gap-3 px-5 pb-6 pt-2">
              <PickerButton icon={Images} label="Gallery" tint="from-pink-500 to-fuchsia-600" onClick={() => galleryRef.current?.click()} />
              <PickerButton icon={Camera} label="Camera" tint="from-blue-500 to-sky-600" onClick={() => cameraRef.current?.click()} />
              <PickerButton icon={VideoIcon} label="Video" tint="from-violet-500 to-purple-600" onClick={() => videoRef.current?.click()} />
              <PickerButton icon={Music} label="Audio" tint="from-cyan-500 to-blue-600" onClick={() => audioRef.current?.click()} />
              <PickerButton
                icon={MapPin}
                label="Location"
                tint="from-amber-500 to-orange-600"
                onClick={() => {
                  onClose();
                  onShareLocation();
                }}
              />
              <PickerButton
                icon={User}
                label="Contact"
                tint="from-orange-500 to-red-600"
                onClick={() => {
                  onClose();
                  onOpenContactPicker();
                }}
              />
              <PickerButton icon={FileIcon} label="Document" tint="from-rose-500 to-red-600" onClick={() => documentRef.current?.click()} />
              <PickerButton
                icon={BarChart3}
                label="Poll"
                tint="from-violet-500 to-indigo-600"
                onClick={() => {
                  onClose();
                  onOpenPollComposer();
                }}
              />
            </div>

            {/* capture="environment" is what actually distinguishes Camera from
                Gallery on mobile browsers — without it this is just a second
                Gallery button. */}
            <input
              ref={cameraRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={(e) => pick(e.target.files)}
            />
            <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => pick(e.target.files)} />
            <input
              ref={videoRef}
              type="file"
              accept="video/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFilesPicked(Array.from(e.target.files), "video");
                onClose();
              }}
            />
            <input
              ref={documentRef}
              type="file"
              accept={ALLOWED_MIME.document.join(",")}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFilesPicked(Array.from(e.target.files), "document");
                onClose();
              }}
            />
            <input
              ref={audioRef}
              type="file"
              accept={ALLOWED_MIME.audio.join(",")}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) onFilesPicked(Array.from(e.target.files), "audio");
                onClose();
              }}
            />
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function PickerButton({
  icon: Icon,
  label,
  tint,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  tint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-secondary/30 py-4 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95"
    >
      <span className={`flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${tint} text-white`}>
        <Icon className="h-5 w-5" />
      </span>
      {label}
    </button>
  );
}
