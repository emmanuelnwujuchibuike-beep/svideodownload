import { ImageResponse } from "next/og";

import { getOgFonts, OG_SIZE, OgImage } from "@/components/og-image";

// Same universal logo card every route uses (see components/og-image.tsx) —
// the per-page textual description lives in generateMetadata's `description`
// field, never on the image itself. The parent route's generateStaticParams +
// dynamicParams=false (app/[downloader]/page.tsx) still prerenders this once
// per slug at build time, same as before — but it's now a plain static render
// with no per-slug data lookup (the old getSeoPage() call), which is the real
// simplification here, not cross-slug caching.
export const alt = "FrenzSave";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(<OgImage />, { ...OG_SIZE, fonts: getOgFonts() });
}
