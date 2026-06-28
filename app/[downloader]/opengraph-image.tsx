import { ImageResponse } from "next/og";

import { OG_SIZE, OgImage } from "@/components/og-image";
import { getSeoPage, SEO_SLUGS } from "@/lib/seo/seo-pages";

export const alt = "FrenzSave";
export const size = OG_SIZE;
export const contentType = "image/png";

export function generateStaticParams() {
  return SEO_SLUGS.map((downloader) => ({ downloader }));
}

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
