"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import {
  getCharacterReplaceBalance,
  getCharacterReplaceConfig,
  readCachedCharacterReplaceBalance,
  takeTopupReturnReference,
  verifyCharacterReplaceTopup,
} from "@/lib/ai/character-replace/client";
import type { CharacterReplacePublicConfig } from "@/lib/ai/character-replace/config";
import type { CharacterReplaceBalance } from "@/lib/ai/character-replace/types";
import {
  INITIAL_STATE,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/ai/character-replace/workspace";
import { inspectImageFile, inspectVideoFile } from "@/lib/ai/media";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WORKSPACE HOOK — side effects around a pure reducer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owns: the two reads from the server (config, balance), the decoding of a
 * picked file for its facts, the object URLs and their revocation, and the
 * Paystack return. Decides nothing about the draft itself — that is the
 * reducer's, and it is tested without a browser.
 *
 * ── 🔴 NOTHING LEAVES THE DEVICE ─────────────────────────────────────────────
 *
 * Part 1, §6: "Do not actually send the files to the AI model yet." Neither
 * file is uploaded, previewed by a server, or hashed. A picked file is decoded
 * by the browser's own `<img>` / `<video>` for its width, height and duration
 * — facts the interface shows and the trim needs — and held as an object URL
 * for the preview. Closing the page releases it.
 */

export interface WorkspaceLoads {
  config: CharacterReplacePublicConfig | null;
  /** The tool is on for this member. Null until the config answers. */
  available: boolean | null;
  configError: string | null;
  balance: CharacterReplaceBalance | null;
  balanceError: string | null;
  /** What a finished recharge said, for the balance card to show once. */
  topupNotice: string | null;
}

export function useCharacterReplaceWorkspace() {
  const [state, dispatch] = useReducer(workspaceReducer, INITIAL_STATE);
  const [loads, setLoads] = useState<WorkspaceLoads>({
    config: null,
    available: null,
    configError: null,
    // The last figure this browser saw paints first; the network replaces it.
    balance: typeof window === "undefined" ? null : readCachedCharacterReplaceBalance(),
    balanceError: null,
    topupNotice: null,
  });

  const alive = useRef(true);
  /*
    Every object URL this hook has minted and not yet revoked. A ref, because
    the unmount cleanup below runs with the render it closed over, and a URL
    created after that render would otherwise leak.
  */
  const urls = useRef<Set<string>>(new Set());
  const mint = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return url;
  }, []);
  const release = useCallback((url: string | null | undefined) => {
    if (!url) return;
    if (urls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    alive.current = true;
    // The Set itself is stable for the life of the hook; capturing it here is
    // what the lint rule asks for, and it is the same object either way.
    const minted = urls.current;
    return () => {
      alive.current = false;
      for (const url of minted) URL.revokeObjectURL(url);
      minted.clear();
    };
  }, []);

  /* ───────────────────────── the two reads ─────────────────────────────── */

  const loadBalance = useCallback(async () => {
    const res = await getCharacterReplaceBalance();
    if (!alive.current) return;
    if (res.ok) setLoads((l) => ({ ...l, balance: res.balance, balanceError: null }));
    else setLoads((l) => ({ ...l, balanceError: res.error }));
  }, []);

  useEffect(() => {
    void (async () => {
      const res = await getCharacterReplaceConfig();
      if (!alive.current) return;
      if (res.ok) setLoads((l) => ({ ...l, config: res.config, available: res.available, configError: null }));
      else setLoads((l) => ({ ...l, configError: res.error, available: false }));
    })();

    /*
      The return from Paystack, if this is one. The reference is taken out of
      the address bar before anything else runs, verified once, and the wallet
      re-read — the same contract the dashboard keeps, so a recharge started
      from this workspace finishes on this workspace.
    */
    const reference = takeTopupReturnReference();
    void (async () => {
      if (reference) {
        const verified = await verifyCharacterReplaceTopup(reference);
        if (!alive.current) return;
        setLoads((l) => ({
          ...l,
          topupNotice: verified.ok
            ? verified.credited
              ? "Payment received — your balance has been updated."
              : verified.pending
                ? "Your payment is still being confirmed. This will update shortly."
                : null
            : null,
        }));
      }
      await loadBalance();
    })();
  }, [loadBalance]);

  /* ───────────────────────── the pickers ───────────────────────────────── */

  const pickPhoto = useCallback(
    async (file: File) => {
      const verdict = inspectImageFile(file);
      if (!verdict.ok) {
        dispatch({ type: "photo/error", code: verdict.code });
        return;
      }
      dispatch({ type: "decoding", which: "photo" });
      release(state.project.character?.objectUrl);
      const objectUrl = mint(file);
      const size = await decodeImage(objectUrl);
      if (!alive.current) return;
      if (!size) {
        release(objectUrl);
        dispatch({ type: "photo/error", code: "invalid-image" });
        return;
      }
      dispatch({
        type: "photo/set",
        asset: { file, objectUrl, width: size.width, height: size.height, size: file.size, mimeType: file.type, name: file.name },
      });
    },
    [mint, release, state.project.character?.objectUrl],
  );

  const clearPhoto = useCallback(() => {
    release(state.project.character?.objectUrl);
    dispatch({ type: "photo/clear" });
  }, [release, state.project.character?.objectUrl]);

  const pickVideo = useCallback(
    async (file: File) => {
      const verdict = inspectVideoFile(file);
      if (!verdict.ok) {
        dispatch({ type: "video/error", code: verdict.code });
        return;
      }
      dispatch({ type: "decoding", which: "video" });
      release(state.project.video?.objectUrl);
      const objectUrl = mint(file);
      const facts = await decodeVideo(objectUrl);
      if (!alive.current) return;
      if (facts === "invalid") {
        release(objectUrl);
        dispatch({ type: "video/error", code: "invalid-video" });
        return;
      }
      dispatch({
        type: "video/set",
        video: {
          file,
          objectUrl,
          durationSeconds: facts.duration,
          width: facts.width,
          height: facts.height,
          size: file.size,
          mimeType: file.type,
          name: file.name,
        },
        maxDurationSeconds: loads.config?.maximumDurationSeconds ?? Number.POSITIVE_INFINITY,
      });
    },
    [loads.config?.maximumDurationSeconds, mint, release, state.project.video?.objectUrl],
  );

  const clearVideo = useCallback(() => {
    release(state.project.video?.objectUrl);
    dispatch({ type: "video/clear" });
  }, [release, state.project.video?.objectUrl]);

  const send = useCallback((action: WorkspaceAction) => dispatch(action), []);

  const dismissTopupNotice = useCallback(() => setLoads((l) => ({ ...l, topupNotice: null })), []);

  return {
    state: state as WorkspaceState,
    loads,
    send,
    pickPhoto,
    clearPhoto,
    pickVideo,
    clearVideo,
    reloadBalance: loadBalance,
    dismissTopupNotice,
  };
}

/* ───────────────────────────── decoders ──────────────────────────────────── */

/** The browser's own decoder, for the two numbers the preview and the trim need. */
function decodeImage(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = (value: { width: number; height: number } | null) => {
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    img.onload = () => done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    img.src = url;
  });
}

/**
 * Duration and frame size, or "invalid" when the browser cannot open the file
 * at all. A container that hides its metadata answers with nulls after a
 * bounded wait rather than hanging the picker — "unmeasured" and "invalid"
 * are different claims, and the interface says which.
 */
function decodeVideo(url: string): Promise<{ duration: number | null; width: number | null; height: number | null } | "invalid"> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const timer = window.setTimeout(() => finish({ duration: null, width: null, height: null }), 8_000);
    const finish = (value: { duration: number | null; width: number | null; height: number | null } | "invalid") => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      // Let go of the decoder: the preview element makes its own.
      video.removeAttribute("src");
      video.load();
      resolve(value);
    };
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;
      finish({
        duration,
        width: video.videoWidth > 0 ? video.videoWidth : null,
        height: video.videoHeight > 0 ? video.videoHeight : null,
      });
    };
    video.onerror = () => finish("invalid");
    video.src = url;
  });
}
