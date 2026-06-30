# Frenzsave Unified Backend & Client SDK

> One backend. Four clients: **web, iOS, Android, desktop**. They all speak the
> same versioned HTTP API and share one TypeScript SDK. No business logic is
> duplicated per platform.

## The three API surfaces

| Surface | Path | Auth | Audience |
|---|---|---|---|
| **First-party app API** | `/api/v1/app/*` | Supabase session (web) **or** Supabase bearer JWT (native/desktop) | Our own apps |
| **Public developer API** | `/api/v1/*` (analyze, download, usage) | API key (`Authorization: Bearer <key>`) + daily quota | Third parties, the extension |
| **Internal worker API** | `/api/internal/*` | `x-worker-secret` | Server-to-worker only |

This document is about the **first-party app API** — the one your iOS/Android/
desktop apps consume.

## Authentication — how every client connects

Auth is centralized in `lib/api/authenticate.ts::getSessionUser`, which accepts
**either** credential so one endpoint serves all clients:

```
Web (browser)      →  Supabase session cookie        (set by @supabase/ssr)
iOS / Android      →  Authorization: Bearer <jwt>     (Supabase access_token)
Desktop            →  Authorization: Bearer <jwt>     (Supabase access_token)
```

Native and desktop apps sign in with the **Supabase client SDK for their
platform** (supabase-swift, supabase-kt, supabase-js), obtain the `access_token`,
and send it as a bearer token. Token refresh, secure storage and silent re-auth
are handled by those SDKs — we never roll our own token store. The server
validates the JWT against Supabase Auth on each request.

## Response envelope

Every `/api/v1/app/*` endpoint returns the same shape (see `lib/api/respond.ts`):

```jsonc
// success
{ "ok": true, "data": { /* ... */ }, "meta": { "nextCursor": "…", "requestId": "…" } }
// failure
{ "ok": false, "error": { "code": "unauthorized", "message": "…", "details": null } }
```

Clients branch on `error.code` (stable, machine-readable), never on `message`.
Codes: `bad_request, unauthorized, forbidden, not_found, conflict,
validation_failed, rate_limited, quota_exceeded, upstream_error, unavailable,
internal`. The SDK adds two client-side codes: `network`, `timeout`.

## Pagination

Lists are **cursor-paginated**. The cursor is **opaque** — clients pass back the
previous page's `meta.nextCursor` and stop when it is `null`. Internally it
currently encodes an offset; we can switch to keyset/seek pagination later
without changing the wire contract or breaking any client.

```
GET /api/v1/app/feed?sort=for_you&limit=12
GET /api/v1/app/feed?sort=for_you&cursor=<meta.nextCursor>
```

## Endpoints (current)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/v1/app/me` | optional | Identity + entitlements; anonymous returns `authenticated:false` (no 401). |
| `GET` | `/api/v1/app/feed` | optional | Cursor-paginated home feed; `sort=for_you\|following\|recent`. |

New endpoints follow the same recipe: `getSessionUser(request)` → do work →
`ok(data, meta)` / `fail(code)`. Add an `OPTIONS` export returning `corsPreflight()`.

## The shared SDK (`lib/sdk`)

Dependency-free, framework-free TypeScript. The same code runs in browsers,
Node, React Native/Expo, Electron and Tauri.

```ts
import { FrenzsaveClient } from "@/lib/sdk"; // web; native uses "@frenzsave/sdk"

const api = new FrenzsaveClient({
  baseUrl: "https://frenzsave.com",
  client: "ios", // or "android" | "web" | "desktop"
  getToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
});

const me = await api.me();
const first = await api.feed({ sort: "for_you" });
const next = first.nextCursor ? await api.feed({ cursor: first.nextCursor }) : null;
```

The client gives every platform the same guarantees for free: token injection,
envelope unwrapping, typed `FrenzsaveError`, retry-with-backoff on transient
failures, in-flight GET deduplication, and timeout/cancellation via `AbortSignal`.

### Shipping the SDK to native/desktop

`lib/sdk` has **no `@/` imports and no framework deps** by design, so it extracts
cleanly. Two supported paths:

1. **npm package** (recommended at scale): move `lib/sdk` to
   `packages/frenzsave-sdk`, add a `package.json` (`"name": "@frenzsave/sdk"`),
   publish, and `npm i @frenzsave/sdk` in each app. The web app imports it the
   same way.
2. **Vendor copy** (fine to start): copy the `lib/sdk` folder into the app repo.

Because the types in `lib/sdk/types.ts` mirror the server's response shapes, the
SDK is the contract — change the server shape and the SDK types, and every client
gets a compile error until it adapts.

## CORS

`/api/v1/*` and `/api/me` send permissive CORS (`lib/api/cors.ts`) covering all
REST verbs and the `Authorization`, `Content-Type`, `X-Api-Key`, `X-Client`
headers, with `X-Request-Id` exposed for log correlation. Native apps are not
origin-bound, but desktop (Tauri/Electron) webviews and the web app are.

## Versioning

The path carries the major version (`/api/v1`). Breaking changes ship under
`/api/v2` while `/api/v1` keeps working, so old app builds in the wild never
break. Additive changes (new fields, new endpoints) stay within `v1`.
