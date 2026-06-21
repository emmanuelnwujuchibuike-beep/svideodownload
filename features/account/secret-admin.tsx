"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

/**
 * Hidden admin entry point: press and hold the footer line for ~700ms to open
 * the admin dashboard. (The /admin route still enforces the admin role server
 * side, so this is just a discreet shortcut — not a security bypass.)
 */
export function SecretAdminGesture() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [held, setHeld] = useState(false);

  const start = () => {
    setHeld(true);
    timer.current = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(35);
      }
      router.push("/admin");
    }, 700);
  };

  const cancel = () => {
    setHeld(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <p
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`mx-auto mt-12 w-fit select-none text-center text-xs transition-colors ${
        held ? "text-primary" : "text-muted-foreground/40"
      }`}
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
      aria-hidden
    >
      SVideoDownload · secure
    </p>
  );
}
