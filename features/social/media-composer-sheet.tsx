"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Camera, File as FileIcon, Images, Music, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { springs } from "@/lib/motion/springs";
import { ALLOWED_MIME } from "@/lib/social/message-media";

/**
 * The "+" attachment picker — Camera / Gallery / Document / Audio, the real,
 * buildable slice of the spec's much larger composer (Cloud/Life Memories/
 * Moments/Events/Contacts/Location/Polls/AI content all need infrastructure
 * this app doesn't have — see docs/PROJECT_NOTES.md's Part 5 entry). Camera
 * vs Gallery are genuinely distinct here (not just two labels on the same
 * picker): Camera sets `capture` so mobile browsers open the camera directly
 * instead of the file/photo library.
 *
 * Audio (2026-07-12): the send/render pipeline already fully supported an
 * "audio" attachment kind — VoiceRecorder's recorded notes use it, and
 * ALLOWED_MIME.audio already allowlists mp3/m4a/wav/ogg — but this sheet
 * never offered a way to pick an EXISTING audio file from the device, only
 * record a fresh one. "Owner: couldn't see audio/music/download in chat."
 */
export function MediaComposerSheet({
  open,
  onClose,
  onFilesPicked,
}: {
  open: boolean;
  onClose: () => void;
  onFilesPicked: (files: File[], kind: "image" | "video" | "document" | "audio") => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
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

            <div className="grid grid-cols-4 gap-3 px-5 pb-6 pt-2">
              <PickerButton icon={Camera} label="Camera" onClick={() => cameraRef.current?.click()} />
              <PickerButton icon={Images} label="Gallery" onClick={() => galleryRef.current?.click()} />
              <PickerButton icon={FileIcon} label="Document" onClick={() => documentRef.current?.click()} />
              <PickerButton icon={Music} label="Audio" onClick={() => audioRef.current?.click()} />
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

function PickerButton({ icon: Icon, label, onClick }: { icon: typeof Camera; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-border/60 bg-secondary/30 py-4 text-xs font-semibold text-muted-foreground transition hover:bg-secondary hover:text-foreground active:scale-95"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-violet-600 text-white">
        <Icon className="h-5 w-5" />
      </span>
      {label}
    </button>
  );
}
