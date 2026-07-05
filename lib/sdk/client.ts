/**
 * Frenzsave SDK — the client every platform shares.
 *
 * Zero dependencies, framework-free, built on the global `fetch` available in
 * browsers, Node 18+, React Native (Expo), Electron and Tauri. The same instance
 * pattern powers web, iOS, Android and desktop:
 *
 *   const api = new FrenzsaveClient({
 *     baseUrl: "https://frenzsave.com",
 *     getToken: () => supabase.auth.getSession().then(s => s.data.session?.access_token ?? null),
 *     client: "ios",
 *   });
 *   const me = await api.me();
 *   const page = await api.feed({ sort: "for_you" });
 *
 * It injects the Supabase access token, unwraps the response envelope, throws a
 * typed FrenzsaveError, retries transient failures with backoff, dedupes
 * identical in-flight GETs, and supports timeouts/cancellation.
 */
import type { ApiEnvelope, FeedResponse, FeedSort, MeResponse, Page } from "./types";

export type TokenProvider = () => string | null | undefined | Promise<string | null | undefined>;

export interface FrenzsaveClientOptions {
  /** API origin, e.g. "https://frenzsave.com" (no trailing slash needed). */
  baseUrl: string;
  /** Returns the current Supabase access token, or null when signed out. */
  getToken?: TokenProvider;
  /** Override fetch (tests, custom agents). Defaults to global fetch. */
  fetch?: typeof fetch;
  /** Per-request timeout in ms. Default 15000. */
  timeoutMs?: number;
  /** Max automatic retries for transient failures. Default 2. */
  maxRetries?: number;
  /** Client tag sent as X-Client (e.g. "web", "ios", "android", "desktop"). */
  client?: string;
}

export class FrenzsaveError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;
  constructor(code: string, message: string, status: number, details?: unknown, requestId?: string) {
    super(message);
    this.name = "FrenzsaveError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  /** Skip in-flight dedup (default: dedupe GETs only). */
  noDedupe?: boolean;
}

const RETRYABLE = new Set(["network", "timeout", "upstream_error", "unavailable", "rate_limited"]);

export class FrenzsaveClient {
  private readonly baseUrl: string;
  private readonly getToken?: TokenProvider;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly client?: string;
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(opts: FrenzsaveClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.client = opts.client;
  }

  /* --------------------------- typed endpoints --------------------------- */

  /** Current identity + entitlements. Never throws on anonymous; returns authenticated:false. */
  me(signal?: AbortSignal): Promise<MeResponse> {
    return this.request<MeResponse>("/api/v1/app/me", { signal });
  }

  /** One page of the home feed. Pass the previous page's `nextCursor` to continue. */
  async feed(params: { sort?: FeedSort; cursor?: string | null; limit?: number; signal?: AbortSignal } = {}): Promise<Page<FeedResponse["items"][number]>> {
    const { data, meta } = await this.requestEnvelope<FeedResponse>("/api/v1/app/feed", {
      query: { sort: params.sort, cursor: params.cursor ?? undefined, limit: params.limit },
      signal: params.signal,
    });
    return { items: data.items, nextCursor: meta?.nextCursor ?? null };
  }

  /** Escape hatch for enveloped endpoints not yet wrapped above. Returns unwrapped `data`. */
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "GET" });
  }
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>(path, { ...options, method: "POST", body });
  }

  /* ----------------------------- core actions ---------------------------- */
  // Typed helpers for the plain (non-enveloped) REST routes that every client —
  // web, iOS, Android, desktop — shares. They return the route's JSON on success
  // and throw a FrenzsaveError (with the server's message) on failure.

  /** Like / unlike a post. */
  like(postId: string, on = true): Promise<{ ok: true }> {
    return this.action(`/api/posts/${postId}/react`, { method: on ? "POST" : "DELETE", body: { type: "like" } });
  }
  /** Save / unsave a post. */
  save(postId: string, on = true): Promise<{ ok: true }> {
    return this.action(`/api/posts/${postId}/react`, { method: on ? "POST" : "DELETE", body: { type: "save" } });
  }
  /** Follow / unfollow a user. */
  follow(userId: string, on = true): Promise<{ ok: true; following: boolean }> {
    return this.action(`/api/follow/${userId}`, { method: on ? "POST" : "DELETE" });
  }
  /** Repost a public post to your own profile. */
  repost(postId: string): Promise<{ ok: true; id: string | null }> {
    return this.action(`/api/posts/${postId}/repost`, { method: "POST" });
  }
  /** Authorize a direct download (enforces the free daily cap server-side). */
  authorizeDownload(postId: string): Promise<{ url: string; filename: string; remaining: number | null }> {
    return this.action(`/api/posts/${postId}/download`, { method: "POST" });
  }

  /**
   * Call a plain REST action route (the existing `{ ok: true, ... }` / `{ error }`
   * endpoints, not the enveloped `/api/v1/app/*` ones). Injects auth + client tag,
   * applies the timeout, and normalizes failures into a FrenzsaveError.
   */
  async action<T = { ok: true }>(
    path: string,
    opts: { method?: RequestOptions["method"]; body?: unknown; query?: RequestOptions["query"]; signal?: AbortSignal } = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.client) headers["X-Client"] = this.client;
    const token = this.getToken ? await this.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(new DOMExceptionLike("timeout")), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: opts.method ?? "POST",
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      const timedOut = (e as { message?: string })?.message === "timeout" || ctrl.signal.reason === "timeout";
      throw new FrenzsaveError(timedOut ? "timeout" : "network", timedOut ? "Request timed out." : "Network request failed.", 0);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    let json: Record<string, unknown> | null = null;
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON */
    }
    if (res.ok) return (json ?? { ok: true }) as T;
    const message = typeof json?.error === "string" ? (json.error as string) : `Request failed (${res.status}).`;
    throw new FrenzsaveError(res.status >= 500 ? "upstream_error" : "bad_request", message, res.status);
  }

  /* ------------------------------ internals ------------------------------ */

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.requestEnvelope<T>(path, options)).data;
  }

  private requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; meta?: ApiEnvelopeMeta }> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(path, options.query);
    const dedupe = method === "GET" && !options.noDedupe;

    if (dedupe) {
      const existing = this.inflight.get(url) as Promise<{ data: T; meta?: ApiEnvelopeMeta }> | undefined;
      if (existing) return existing;
    }

    const promise = this.execute<T>(method, url, options).finally(() => {
      if (dedupe) this.inflight.delete(url);
    });
    if (dedupe) this.inflight.set(url, promise);
    return promise;
  }

  private async execute<T>(method: string, url: string, options: RequestOptions): Promise<{ data: T; meta?: ApiEnvelopeMeta }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.once<T>(method, url, options);
      } catch (err) {
        const retriable = err instanceof FrenzsaveError && RETRYABLE.has(err.code);
        if (!retriable || attempt >= this.maxRetries || options.signal?.aborted) throw err;
        const backoff = Math.min(2000, 250 * 2 ** attempt) + Math.random() * 150;
        await sleep(backoff, options.signal);
        attempt++;
      }
    }
  }

  private async once<T>(method: string, url: string, options: RequestOptions): Promise<{ data: T; meta?: ApiEnvelopeMeta }> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.client) headers["X-Client"] = this.client;
    const token = this.getToken ? await this.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    // Compose the caller's signal with our timeout.
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(new DOMExceptionLike("timeout")), this.timeoutMs);

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      const timedOut = (e as { message?: string })?.message === "timeout" || ctrl.signal.reason === "timeout";
      throw new FrenzsaveError(timedOut ? "timeout" : "network", timedOut ? "Request timed out." : "Network request failed.", 0);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }

    const requestId = res.headers.get("X-Request-Id") ?? undefined;
    let json: ApiEnvelope<T> | null = null;
    try {
      json = (await res.json()) as ApiEnvelope<T>;
    } catch {
      /* non-JSON body */
    }

    if (json && json.ok) return { data: json.data, meta: json.meta };
    if (json && !json.ok) {
      throw new FrenzsaveError(json.error.code, json.error.message, res.status, json.error.details, requestId);
    }
    // Non-enveloped failure (proxy error, etc.).
    throw new FrenzsaveError(res.status >= 500 ? "upstream_error" : "bad_request", `Unexpected response (${res.status}).`, res.status, undefined, requestId);
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const u = new URL(path.startsWith("http") ? path : `${this.baseUrl}${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }
}

type ApiEnvelopeMeta = NonNullable<Extract<ApiEnvelope<unknown>, { ok: true }>["meta"]>;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new FrenzsaveError("network", "Aborted.", 0));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new FrenzsaveError("network", "Aborted.", 0));
    }, { once: true });
  });
}

/** Minimal stand-in so `abort(reason)` carries a recognizable message everywhere. */
class DOMExceptionLike extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbortError";
  }
}
