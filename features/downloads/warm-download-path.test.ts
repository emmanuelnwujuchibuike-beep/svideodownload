import { describe, expect, it, vi } from "vitest";

const getSession = vi.fn(async () => ({ data: { session: null } }));
let clientFails = false;
vi.mock("@/lib/supabase/client-lazy", () => ({
  getClient: async () => {
    if (clientFails) throw new Error("offline");
    return { auth: { getSession } };
  },
}));

/**
 * The Save tap's code loads while the result card is read, not on the tap (owner, 2026-10-30: "the save button … doesn't
 * respond immediately" — free accounts on iPhone Safari; measured in WebKit, the tap waited 0.8–2.6 s for this code).
 */
describe("warmDownloadPath", () => {
  it("loads the fetch code and reads the session once per page, however many cards ask", async () => {
    vi.resetModules();
    getSession.mockClear();
    const { warmDownloadPath } = await import("@/features/downloads/manager");
    await Promise.all([warmDownloadPath(), warmDownloadPath()]);
    await warmDownloadPath();
    expect(getSession).toHaveBeenCalledTimes(1);
    // teeth: the fetch module is really loaded (the tap's `await import` then resolves from memory)
    const fetchModule = await import("@/features/downloads/fetch-download");
    expect(typeof fetchModule.fetchDownload).toBe("function");
  });

  it("never throws — a warm-up that fails leaves the tap to load it, as before", async () => {
    vi.resetModules();
    clientFails = true;
    const { warmDownloadPath } = await import("@/features/downloads/manager");
    await expect(warmDownloadPath()).resolves.toBeUndefined();
    clientFails = false;
  });
});
