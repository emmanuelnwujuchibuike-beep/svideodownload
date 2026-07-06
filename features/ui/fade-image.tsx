"use client";

import Image, { type ImageProps } from "next/image";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Frenz Core · Loading Engine — progressive image reveal.
 *
 * Drop-in for next/image: the image fades in over 400ms once its bytes are
 * decoded instead of popping in scanline-by-scanline. Whatever sits behind it
 * (skeleton shimmer, blurred backdrop, gradient tile) stays visible until the
 * real pixels are ready, so media loading reads as intentional, never broken.
 *
 * Handles the classic hydration trap: an image that finished loading BEFORE
 * React hydrated never fires onLoad again, so we also check `complete` on
 * mount — a cached image shows instantly at full opacity.
 */
export function FadeImage({ className, style, onLoad, ...props }: ImageProps) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (ref.current?.complete) setReady(true);
  }, []);

  return (
    <Image
      {...props}
      ref={ref}
      onLoad={(e) => {
        setReady(true);
        onLoad?.(e);
      }}
      className={cn(className)}
      // Inline style (not classes) so callers' own transition/hover classes
      // are never clobbered by tailwind-merge. Transform rides along so tiles
      // with `group-hover:scale-*` keep their hover animation too.
      style={{ ...style, opacity: ready ? 1 : 0, transition: "opacity 0.4s ease-out, transform 0.3s ease" }}
    />
  );
}
