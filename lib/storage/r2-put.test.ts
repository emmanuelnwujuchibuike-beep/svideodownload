import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * putR2 sends the bytes AS bytes (2026-10-30): R2 refused the worker's blurred clips with 411 (Length Required) when the
 * body travelled inside a Request — on Node 22 it went out with no Content-Length.
 */
async function freshR2() {
  vi.resetModules();
  vi.stubEnv("R2_ACCOUNT_ID", "acct");
  vi.stubEnv("R2_ACCESS_KEY_ID", "key");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET", "frenz-media");
  vi.stubEnv("R2_PUBLIC_BASE_URL", "https://media.example.com");
  return import("./r2");
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("putR2", () => {
  it("🔴 hands fetch the bytes themselves with the signed headers — never a Request (whose body Node 22 sent with no length)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { putR2 } = await freshR2();
    const clip = new Uint8Array(68_000).fill(7);
    const url = await putR2("sub-blur/v2/p/0-x.mp4", clip, "video/mp4");
    expect(url).toBe("https://media.example.com/sub-blur/v2/p/0-x.mp4");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [target, init] = fetchMock.mock.calls[0]!;
    // teeth: the old code called fetch(new Request(...)) — no init, no byte body
    expect(typeof target).toBe("string");
    expect(target).toBe("https://acct.r2.cloudflarestorage.com/frenz-media/sub-blur/v2/p/0-x.mp4");
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((init.body as Uint8Array).byteLength).toBe(68_000);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
    // aws4fetch signs S3 uploads as UNSIGNED-PAYLOAD (as before this change) — R2 accepts it
    expect(headers.get("x-amz-content-sha256")).toMatch(/^([0-9a-f]{64}|UNSIGNED-PAYLOAD)$/);
    expect(headers.get("content-type")).toBe("video/mp4");
  });

  it("a Blob or ArrayBuffer body is sent as the same bytes", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const { putR2 } = await freshR2();
    await putR2("a.bin", new Blob([new Uint8Array([1, 2, 3])]), "application/octet-stream");
    await putR2("b.bin", new Uint8Array([4, 5]).buffer, "application/octet-stream");
    expect(Array.from(fetchMock.mock.calls[0]![1].body as Uint8Array)).toEqual([1, 2, 3]);
    expect(Array.from(fetchMock.mock.calls[1]![1].body as Uint8Array)).toEqual([4, 5]);
  });

  it("a 5xx is tried again; a 4xx is reported at once with its status", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 200 }));
    const { putR2 } = await freshR2();
    await expect(putR2("c.bin", new Uint8Array([1]), "application/octet-stream")).resolves.toContain("c.bin");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 411 }));
    await expect(putR2("d.bin", new Uint8Array([1]), "application/octet-stream")).rejects.toThrow("R2 upload failed: 411");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
