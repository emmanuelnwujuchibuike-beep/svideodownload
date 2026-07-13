"use client";

/**
 * Real, client-side E2E encryption for Secret Chats (Part 11b) — see
 * migration 0062's header for the full crypto-model writeup. Summary: each
 * device generates a long-term ECDH (P-256) key pair once; the private key
 * never leaves this browser (IndexedDB only, never sent to the server, never
 * in localStorage/cookies). Starting a Secret Chat with someone derives a
 * per-conversation AES-GCM key via ECDH(myPrivate, theirPublic) — the SAME
 * value on both sides without either ever transmitting it. The server only
 * ever stores base64 ciphertext + a nonce; it cannot decrypt anything here.
 *
 * Honest limits (not bugs): no per-message forward secrecy (a real Double
 * Ratchet is future work — this key is static per conversation), and no
 * multi-device support (a NEW device has no way to obtain the old private
 * key — that device's copy of this conversation's history is permanently
 * undecryptable, matching the spec's own "no cloud backup" requirement and
 * how WhatsApp itself behaves on a genuinely lost E2EE key).
 */

const DB_NAME = "frenz-secret-chat";
const STORE = "keys";
const KEY_ID = "identity";

interface StoredKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Whether this device has already generated its Secret Chat identity key. */
export async function hasLocalIdentityKey(): Promise<boolean> {
  try {
    return !!(await idbGet<StoredKeyPair>(STORE, KEY_ID));
  } catch {
    return false;
  }
}

/**
 * Generates this device's long-term ECDH key pair (if one doesn't already
 * exist), stores it in IndexedDB, uploads ONLY the public half to the
 * server. Safe to call every time a Secret Chat surface mounts — it's a
 * no-op after the first successful run.
 */
export async function ensureIdentityKey(): Promise<void> {
  const existing = await idbGet<StoredKeyPair>(STORE, KEY_ID);
  if (existing) return;

  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
  await idbSet(STORE, KEY_ID, { publicKey: pair.publicKey, privateKey: pair.privateKey } satisfies StoredKeyPair);

  const rawPublic = await crypto.subtle.exportKey("spki", pair.publicKey);
  const res = await fetch("/api/messages/keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: bufToBase64(rawPublic) }),
  });
  if (!res.ok) {
    // Roll back the local key so a retry (next mount) tries again cleanly,
    // rather than leaving a device with a private key the server never got
    // the matching public key for (every derive would then produce a key
    // the OTHER side can never match). Awaited — an immediate remount/retry
    // racing an un-awaited delete could still see the stale key and skip
    // regeneration, which is exactly the inconsistent state this exists to
    // prevent.
    await idbDelete(STORE, KEY_ID);
    throw new Error("Couldn't set up encryption for this device.");
  }
}

async function getLocalPrivateKey(): Promise<CryptoKey> {
  const existing = await idbGet<StoredKeyPair>(STORE, KEY_ID);
  if (!existing) throw new Error("No local encryption key on this device.");
  return existing.privateKey;
}

/** Fetches another user's public key from the server. Null if they've never opened a Secret Chat surface (no key generated yet). */
export async function fetchPublicKey(userId: string): Promise<CryptoKey | null> {
  const res = await fetch(`/api/messages/keys/${userId}`);
  if (!res.ok) return null;
  const json = await res.json();
  if (!json.ok || !json.publicKey) return null;
  const raw = base64ToBuf(json.publicKey as string);
  return crypto.subtle.importKey("spki", raw, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

/** Derives the shared AES-GCM key for a conversation with `otherPublicKey`. Deterministic — never stored, re-derived on demand. */
async function deriveSharedKey(otherPublicKey: CryptoKey): Promise<CryptoKey> {
  const privateKey = await getLocalPrivateKey();
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: otherPublicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export interface EncryptedPayload {
  body: string; // base64 ciphertext
  iv: string; // base64 nonce
}

/** Encrypts `plaintext` for a Secret Chat with `otherPublicKey`. */
export async function encryptForConversation(otherPublicKey: CryptoKey, plaintext: string): Promise<EncryptedPayload> {
  const key = await deriveSharedKey(otherPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { body: bufToBase64(cipher), iv: bufToBase64(iv.buffer) };
}

/** Decrypts a message. Returns null on failure (wrong/missing local key, corrupted data) rather than throwing — callers show a "can't decrypt on this device" placeholder. */
export async function decryptFromConversation(otherPublicKey: CryptoKey, payload: EncryptedPayload): Promise<string | null> {
  try {
    const key = await deriveSharedKey(otherPublicKey);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(base64ToBuf(payload.iv)) },
      key,
      base64ToBuf(payload.body),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
