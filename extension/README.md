# SVideoDownload Browser Extension

A Manifest V3 (Chrome/Edge/Brave) extension that downloads the media on the page
you're viewing, powered by the SVideoDownload API. It reads the current tab's URL,
fetches the available formats, and saves the file with the browser's download
manager — no copy-paste.

## How it works

```
popup opens → reads active tab URL → GET /api/me (plan + offer)
            → POST /api/metadata (formats) → click a format
            → chrome.downloads.download(/api/download?…)
```

- **Anyone can use it** with no setup (anonymous = free tier). Free users see a
  small partner offer in the popup; that offer link is the same tracked
  `/api/go/<id>` redirect the site uses, so it earns affiliate revenue.
- **Signed-in/paid users**: open **Settings** and paste your **API key** (from
  your account page). The popup then shows your plan and drops the ads/offer.
- It calls the same endpoints as the website, so it supports every platform the
  site does and benefits from all the extraction fixes automatically.

## Install (development / load unpacked)

1. Go to `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select this `extension/` folder.
4. Pin the icon, open a TikTok/Instagram/YouTube page, click it → **Fetch this media**.

Icons (16/48/128) are included in `icons/`. To regenerate them after a brand
tweak: `node extension/icons/generate-icons.mjs`.

## Configuration

- **Settings page** (`options.html`): `apiKey` (optional) and `apiBase`
  (defaults to `https://svideodownload.com`; change only if self-hosting).
- `host_permissions` in `manifest.json` must include your API domain so the
  popup can call it without CORS issues.

## Publishing

1. Add proper icons + a 1280×800 screenshot + promo copy.
2. Zip the `extension/` folder.
3. Submit to the **Chrome Web Store** (one-time $5 dev fee) / **Edge Add-ons**.
4. Update `host_permissions` and `apiBase` default to your production domain.

## Monetization tie-in

The extension is a distribution + retention channel for the same revenue stack:
free users → affiliate offer in the popup; everyone → funnel to Pro via the
account page; developers → API usage. Plan state is read live from `/api/me`.
