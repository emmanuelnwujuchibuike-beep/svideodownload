"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useRef, useState } from "react";

import { haptic } from "@/lib/motion/haptics";

/**
 * Hidden admin entry point: press and hold the wrapped element for ~600ms to
 * open the admin dashboard. Lives in the global footer, so it's reachable from
 * any page. (/admin still enforces the admin role server-side, so this is a
 * discreet shortcut, not a security bypass.)
 */
export function SecretAdminGesture({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [held, setHeld] = useState(false);

  const start = () => {
    setHeld(true);
    timer.current = setTimeout(() => {
      haptic("strong");
      router.push("/admin");
    }, 600);
  };

  const cancel = () => {
    setHeld(false);
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return (
    <span
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`cursor-pointer select-none transition-colors ${
        held ? "text-primary" : ""
      } ${className ?? ""}`}
      style={{
        touchAction: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
      title="FrenzSave"
    >
      {children ?? "FrenzSave · secure"}
    </span>
  );
}
