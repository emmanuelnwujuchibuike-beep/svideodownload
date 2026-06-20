import { Redis } from "@upstash/redis";

/**
 * Generic JSON cache used for extracted metadata and resolved download URLs.
 *
 * Backed by Upstash Redis when configured (shared across all instances — the
 * correct choice in production), with an in-memory LRU-ish fallback for local
 * dev. Keys are namespaced; values are plain JSON-serialisable objects.
 */

const hasRedis =
  !!process.env.UPSTASH_REDIS_REST_URL &&
  !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasRedis ? Redis.fromEnv() : null;

interface MemEntry {
  value: unknown;
  expiresAt: number;
}

const MEM_MAX_ENTRIES = 500;
const mem = new Map<string, MemEntry>();

function memGet<T>(key: string): T | null {
  const hit = mem.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    mem.delete(key);
    return null;
  }
  // Refresh recency for a rough LRU.
  mem.delete(key);
  mem.set(key, hit);
  return hit.value as T;
}

function memSet<T>(key: string, value: T, ttlSeconds: number): void {
  if (mem.size >= MEM_MAX_ENTRIES) {
    const oldest = mem.keys().next().value;
    if (oldest !== undefined) mem.delete(oldest);
  }
  mem.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis) {
    try {
      return (await redis.get<T>(key)) ?? null;
    } catch {
      return null; // never let a cache hiccup break the request
    }
  }
  return memGet<T>(key);
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch {
      /* ignore cache write failures */
    }
    return;
  }
  memSet(key, value, ttlSeconds);
}

export const cacheBackend = redis ? "redis" : "memory";
