import { ImageResponse } from "next/og";

import { OG_ALT, OG_SIZE, OgImage } from "@/components/og-image";

// The large preview card shown when the link is shared on X / Twitter.
export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function TwitterImage() {
  return new ImageResponse(<OgImage />, { ...OG_SIZE });
}
