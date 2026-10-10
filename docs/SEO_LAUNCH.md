# SEO launch — Search Console and what to watch (2026-10-09)

The public SEO surface added on 2026-10-09 is listed in `lib/seo/guides.ts`
(the one content source) and tested in `lib/seo/guides.test.ts`. Nothing here
has been submitted to any search engine yet — those steps need the owner's
Google account.

## Indexing policy

| Indexed (in `sitemap.xml`) | Not indexed |
|---|---|
| `/`, downloader pages, category hubs, `/wallpapers`, `/explore` | `/ai/**` — the Frenz AI tools (noindex + robots Disallow) |
| `/frenz-ai` and its 8 guides (tools, Kling, tutorials) | `/admin/**`, `/api/**` |
| `/advertise`, `/advertise/rules`, `/advertise/{pricing,banner-ads,video-ads,campaign-guide}` | `/advertise/create`, `/advertise/campaigns`, `/advertise/payment` (noindex) |
| blog, learn, academy, topics, help, trust, glossary, legal pages | `/login`, account, studio, messages and every signed-in page |

A new guide is one entry in `lib/seo/guides.ts`; the sitemap, the page and the
tests pick it up. Its `updated` date is its sitemap `lastmod` — change it only
when the content really changes.

## Google Search Console — steps for the owner

1. Open https://search.google.com/search-console and **Add property** →
   **Domain** → `frenzsave.com`.
2. Google shows a `TXT` record (`google-site-verification=…`). Add it at the DNS
   provider for `frenzsave.com`, wait for it to propagate, then press **Verify**.
   (Never paste a token into the code — the Domain property needs DNS only.)
3. **Sitemaps** → submit `https://frenzsave.com/sitemap.xml`. Also submit
   `posts-sitemap.xml` and `news-sitemap.xml` if they are not already listed.
4. **URL inspection** → inspect and **Request indexing** for, in this order:
   1. `https://frenzsave.com/`
   2. `https://frenzsave.com/frenz-ai`
   3. `https://frenzsave.com/frenz-ai/text-to-video`
   4. `https://frenzsave.com/frenz-ai/image-to-video`
   5. `https://frenzsave.com/frenz-ai/kling-ai`
   6. `https://frenzsave.com/advertise`
   7. `https://frenzsave.com/advertise/pricing`
   8. `https://frenzsave.com/advertise/campaign-guide`
   9. `https://frenzsave.com/frenz-ai/ai-video-prompts`
   10. `https://frenzsave.com/frenz-ai/lip-sync`
5. Check **Pages** (indexing) weekly for "Crawled — currently not indexed",
   "Duplicate without user-selected canonical" and 404s; fix what it reports.
6. Check **Performance → Search results** after 3–4 weeks: which queries bring
   impressions to the guides. Write new guides only for queries that show real
   impressions and that Frenzsave genuinely serves.
7. Optional: Bing Webmaster Tools → **Import from Google Search Console**.

Indexing and ranking are Google's decisions. Submitting asks for a crawl; it does
not guarantee a page is indexed or where it ranks.

## Before each content change

- A tool page only for a Product Genome capability at stage `live`.
- No prices, resolutions or allowances written into copy — they are admin settings.
- No audience sizes, results or partnerships that are not measured or signed.
- Kling 4.0 stays "announced" until Frenz AI actually runs it.
