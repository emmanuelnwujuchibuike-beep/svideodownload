"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { ProfileMenuPanel, type MenuUser } from "./profile-menu-panel";

/**
 * The profile menu as a bottom sheet — the presentation in the owner's reference
 * (public/profilemenu.jpg).
 *
 * There are three places that open the profile menu: the profile page's own
 * trigger, the profile page's mobile top bar, and the header avatar. They used to
 * be three DIFFERENT menus, which is why rebuilding one of them left the owner
 * still looking at an old drawer ("the profile menu is still the same"). They now
 * share this sheet and, through it, one `ProfileMenuPanel`.
 *
 * CSS transitions rather than framer-motion: the header's copy of this is fetched
 * on tap, and there is no reason for a menu to pull an animation library into that
 * chunk.
 */
export function ProfileMenuBottomSheet({
  open,
  user,
  onClose,
}: {
  open: boolean;
  user: MenuUser;
  onClose: () => void;
}) {
  // Keep the sheet mounted for the closing animation, then drop it.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    // `open` gates pointer-events synchronously so a stray tap never outlives the
    // closing animation.
    <div className={open ? undefined : "pointer-events-none"}>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className={`fixed inset-0 z-[70] cursor-default bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${shown ? "opacity-100" : "opacity-0"}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Profile menu"
        className={`fixed inset-x-0 bottom-0 z-[80] flex max-h-[92vh] flex-col overflow-hidden rounded-t-[1.75rem] border-t border-border/60 bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl transition-transform duration-300 [transition-timing-function:var(--ease-out)] ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />
        <ProfileMenuPanel user={user} onNavigate={onClose} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}
