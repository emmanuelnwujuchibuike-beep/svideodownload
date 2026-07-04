import { ImageResponse } from "next/og";

import { OG_SIZE, OgImage } from "@/components/og-image";
import { getSeoPage } from "@/lib/seo/seo-pages";

export const alt = "FrenzSave";
export const size = OG_SIZE;
export const contentType = "image/png";

// Generate on-demand + cache (not one image per slug at build). This keeps
// builds fast — there are many downloader slugs and each render is otherwise a
// build-time cost — while the image still caches after its first request.
export const revalidate = 604800; // 7 days

export default async function Image({
  params,
}: {
  params: Promise<{ downloader: string }>;
}) {
  const { downloader } = await params;
  const page = getSeoPage(downloader);
  return new ImageResponse(
    (
      <OgImage
        headline={page ? `${page.brand} ${page.thing} Downloader` : undefined}
        sub="Free · Watermark-free · HD · No login"
      />
    ),
    { ...OG_SIZE },
  );
}
