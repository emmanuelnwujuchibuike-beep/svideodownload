import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

/*
 * Static by contract, not by inference. Vercel was building `/` as DYNAMIC while
 * this repo built it static, which silently made it uncacheable at the edge and
 * cost ~800-4700ms of TTFB before anyone noticed. This page reads no cookies, no
 * headers and no searchParams, so it declares that rather than hoping the builder
 * infers it. ISR still applies via `revalidate` in app/layout.tsx.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Developer API",
  description:
    "Programmatic access to FrenzSave: analyze and download media from every supported platform with a simple REST API.",
  alternates: { canonical: "/developers" },
};

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border bg-card p-4 text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function DevelopersPage() {
  return (
    <>
      <SiteHeader />
      <main className="container max-w-3xl pb-24 pt-28 sm:pt-36">
        <header className="mb-10">
          <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Developer API</h1>
          <p className="mt-3 text-muted-foreground">
            Analyze and download media from every supported platform over a simple
            REST API. Create a key in your{" "}
            <Link href="/account" className="font-medium text-primary hover:underline">
              account
            </Link>
            , then authenticate with a bearer token.
          </p>
        </header>

        <section className="space-y-8">
          <div>
            <h2 className="mb-2 text-lg font-semibold">Authentication</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Send your API key as a bearer token on every request. Free keys allow
              50 requests/day; Pro 500/day; Business 10,000/day.
            </p>
            <Code>{`Authorization: Bearer svd_live_xxxxxxxxxxxxxxxxxxxxxxxx`}</Code>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">POST /v1/analyze</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Returns title, thumbnail, duration and available formats.
            </p>
            <Code>{`curl https://frenzsave.com/api/v1/analyze \\
  -H "Authorization: Bearer $SVD_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.tiktok.com/@user/video/123"}'`}</Code>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">POST /v1/download</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Resolves a ready-to-use <code className="font-mono">download_url</code>.
              Optional <code className="font-mono">formatId</code> and{" "}
              <code className="font-mono">kind</code> (<code>video</code>/<code>audio</code>/<code>image</code>).
            </p>
            <Code>{`curl https://frenzsave.com/api/v1/download \\
  -H "Authorization: Bearer $SVD_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.instagram.com/reel/abc","kind":"video"}'

# → { "title": "...", "ext": "mp4", "download_url": "https://.../api/download?..." }`}</Code>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-semibold">GET /v1/usage</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Check today&apos;s usage and your daily limit.
            </p>
            <Code>{`curl https://frenzsave.com/api/v1/usage \\
  -H "Authorization: Bearer $SVD_KEY"

# → { "plan": "free", "limit": 50, "used": 12, "remaining": 38 }`}</Code>
          </div>

          <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] to-transparent p-5">
            <h2 className="text-base font-semibold">Need higher limits?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The Business plan unlocks 10,000 requests/day and priority support.
            </p>
            <Link
              href="/pricing#business"
              className="mt-3 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
            >
              View plans
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
