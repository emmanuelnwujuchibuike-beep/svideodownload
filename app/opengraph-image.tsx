import { ImageResponse } from "next/og";

import { OG_ALT, OG_SIZE, OgImage } from "@/components/og-image";

// The preview card shown when the link is shared (Facebook, WhatsApp, iMessage,
// LinkedIn, Slack, Discord, etc.).
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(<OgImage />, { ...OG_SIZE });
}
