"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { IdentityMode } from "@/lib/social/profile";

/**
 * Tapping a profile's avatar opens a full-screen view of whatever identity
 * they're actually displaying — the same photo, the profile video (looping,
 * full quality), or the avatar image. Portaled to <body> so it always sits
 * above the page; closes on backdrop tap, the X, or Escape.
 */
export function IdentityMediaViewer({
  mode,
  photo,
  video,
  avatar,
  name,
  children,
}: {
  mode: IdentityMode;
  photo: string | null;
  video: string | null;
  avatar: string | null;
  name: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [open]);

  const src = mode === "video" && video ? video : mode === "avatar" && avatar ? avatar : photo;
  if (!src) return <>{children}</>;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`View ${name}'s profile ${mode}`} className="block cursor-pointer appearance-none bg-transparent p-0">
        {children}
      </button>

      {mounted
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md"
                  onClick={() => setOpen(false)}
                  role="dialog"
                  aria-modal="true"
                  aria-label={`${name}'s profile ${mode}`}
                >
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="absolute right-4 top-[calc(1rem+var(--frenz-safe-top))] flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur-md transition hover:bg-white/20"
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.94, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 340, damping: 30 }}
                    onClick={(e) => e.stopPropagation()}
                    className="relative flex max-h-[85vh] max-w-[92vw] items-center justify-center"
                  >
                    {mode === "video" && video ? (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={video} autoPlay muted loop playsInline className="max-h-[85vh] max-w-[92vw] rounded-3xl object-contain shadow-2xl" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={`${name}'s profile ${mode}`} className="max-h-[85vh] max-w-[92vw] rounded-3xl object-contain shadow-2xl" />
                    )}
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </>
  );
}
