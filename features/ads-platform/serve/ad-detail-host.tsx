"use client";

import dynamic from "next/dynamic";

import { closeAdDetail, useAdDetail } from "./ad-detail-store";

const AdDetailSheet = dynamic(() => import("./ad-detail-sheet").then((m) => m.AdDetailSheet), { ssr: false });

/** Mounted once with the paid-ad layer. Renders nothing until an ad is tapped. */
export function AdDetailHost() {
  const state = useAdDetail();
  if (!state) return null;
  return <AdDetailSheet key={state.ad.cr} ad={state.ad} view={state.view} onClose={closeAdDetail} />;
}
