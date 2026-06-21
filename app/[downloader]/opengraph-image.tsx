import { ImageResponse } from "next/og";

import { OG_SIZE, OgImage } from "@/components/og-image";
import { DOWNLOADER_SLUGS, getDownloader } from "@/lib/seo/downloaders";

export const alt = "SVideoDownload";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return DOWNLOADER_SLUGS.map((downloader) => ({ downloader }));
}

export default async function Image({
  params,
}: {
  params: Promise<{ downloader: string }>;
}) {
  const { downloader } = await params;
  const page = getDownloader(downloader);
  return new ImageResponse(
    (
      <OgImage
        headline={page ? `${page.brand} ${page.noun} Downloader` : undefined}
        sub="Free · Watermark-free · HD · No login"
      />
    ),
    { ...OG_SIZE },
  );
}
