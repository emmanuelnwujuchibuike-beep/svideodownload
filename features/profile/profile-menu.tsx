"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";

import { ProfileMenuPanel, type MenuUser } from "./profile-menu-panel";

/**
 * Profile menu — the owner's premium control center (owner reference:
 * public/profilemenu.jpg). The CONTENT lives in `./profile-menu-panel` so this
 * panel and the top-right header avatar menu are literally the same component.
 *
 * On desktop (lg+) it's an always-open panel docked on the right; on mobile it's a
 * bottom sheet opened from a top-right button.
 */
export function ProfileMenu(user: MenuUser) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflowY = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {/* Desktop dock — always-open panel alongside the content. */}
      <aside className="hidden shrink-0 lg:block lg:w-72">
        <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col overflow-hidden border-l border-border/60 bg-gradient-to-b from-card/70 to-card/30 backdrop-blur-xl">
          <ProfileMenuPanel user={user} />
        </div>
      </aside>

      {/* Mobile trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        className="fixed right-3 top-[calc(0.75rem+var(--frenz-safe-top))] z-[60] flex h-10 w-10 items-center justify-center rounded-xl bg-background/70 text-foreground ring-1 ring-inset ring-border/60 backdrop-blur-xl transition hover:bg-secondary lg:hidden"
      >
        <LayoutGrid className="h-[18px] w-[18px]" />
      </button>

      {/* Mobile bottom sheet (matches the reference). `open` gates pointer-events
          synchronously so a stray tap never outlives the closing animation. */}
      <div className={open ? undefined : "pointer-events-none"}>
        <AnimatePresence>
          {open ? (
            <>
              <motion.button
                type="button"
                aria-label="Close menu"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm lg:hidden"
              />
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 40 }}
                className="fixed inset-x-0 bottom-0 z-[80] flex max-h-[92vh] flex-col overflow-hidden rounded-t-[1.75rem] border-t border-border/60 bg-card pb-[env(safe-area-inset-bottom)] shadow-2xl lg:hidden"
                role="dialog"
                aria-modal="true"
                aria-label="Profile menu"
              >
                <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />
                <ProfileMenuPanel user={user} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </>
  );
}
