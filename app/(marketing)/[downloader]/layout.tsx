import type { ReactNode } from "react";

import "../../landing.css";

import { LaterStyles } from "@/features/perf/later-styles";

/**
 * The downloader pages paint with the landing's own small sheet (app/landing.css, 2026-10-31 — what these pages
 * import statically), and get the entry sheet right after the first paint for anything they open later.
 */
export default function DownloaderLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <LaterStyles />
    </>
  );
}
