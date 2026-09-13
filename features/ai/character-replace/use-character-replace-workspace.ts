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
  characterReplaceLimits,
  validatePhotoFile,
  validatePhotoPixels,
  validateVideoFile,
  validateVideoMetadata,
} from "@/lib/ai/character-replace/validate";
import {
  INITIAL_STATE,
  workspaceReducer,
  type WorkspaceAction,
  type WorkspaceState,
} from "@/lib/ai/character-replace/workspace";
import { readImageSize, readVideoMetadata } from "@/features/ai/character-replace/read-media";

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
 * Part 1, §6 and Part 2, §25: nothing is uploaded, previewed by a server, or
 * hashed. A picked file is decoded ONCE by the browser's own `<img>` /
 * `<video>` (features/ai/character-replace/read-media.ts) for its facts, and
 * held as an object URL for the preview. Replacing or removing a file revokes
 * its URL immediately; closing the page revokes whatever is left.
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
  /*
    🔴 REVOKED AFTER REACT HAS LET GO OF IT. A player that still references
    the URL when it is revoked logs a network error (`ERR_FILE_NOT_FOUND`)
    and, on some engines, blanks — the Playwright walk caught exactly that on
    a replace. The state change that unmounts the element is dispatched
    first; the revocation waits a second, by which time the commit has
    happened AND any metadata fetch the outgoing player had in flight has
    settled (a replace within a beat of a mount still raced a zero-delay
    revoke in the walk). A blob URL held one second longer costs nothing;
    the unmount cleanup below still revokes everything at once.
  */
  const release = useCallback((url: string | null | undefined) => {
    if (!url || !urls.current.has(url)) return;
    urls.current.delete(url);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  /*
    Every rule comes from ONE limits object derived from the server's config
    (lib/ai/character-replace/validate.ts). The platform defaults apply until
    the config answers; the server re-checks everything either way.
  */
  const limits = characterReplaceLimits(loads.config);

  const pickPhoto = useCallback(
    async (file: File) => {
      // The old photo goes first — state, then its URL — so a replace never
      // holds two decoded images and never revokes one still on screen.
      const previous = state.project.character?.objectUrl;
      const verdict = validatePhotoFile(file, limits);
      if (!verdict.ok) {
        dispatch({ type: "photo/invalid", code: verdict.code });
        release(previous);
        return;
      }
      dispatch({ type: "photo/validating" });
      release(previous);
      const objectUrl = mint(file);
      const size = await readImageSize(objectUrl);
      if (!alive.current) return;
      const pixels = validatePhotoPixels(size, limits);
      if (!pixels.ok || !size) {
        release(objectUrl);
        dispatch({ type: pixels.ok ? "photo/error" : pixels.code === "invalid-image" ? "photo/error" : "photo/invalid", code: pixels.ok ? "invalid-image" : pixels.code });
        return;
      }
      dispatch({
        type: "photo/ready",
        asset: { file, objectUrl, width: size.width, height: size.height, size: file.size, mimeType: file.type, name: file.name },
      });
    },
    [limits, mint, release, state.project.character?.objectUrl],
  );

  const clearPhoto = useCallback(() => {
    const previous = state.project.character?.objectUrl;
    dispatch({ type: "photo/clear" });
    release(previous);
  }, [release, state.project.character?.objectUrl]);

  const pickVideo = useCallback(
    async (file: File) => {
      // Replacing: the old preview, metadata and trim all go before the new
      // file is read (§21). The reducer clears the state; the URL it pointed
      // at is revoked once the player is gone.
      const previous = state.project.video?.objectUrl;
      const verdict = validateVideoFile(file, limits);
      if (!verdict.ok) {
        dispatch({ type: "video/invalid", code: verdict.code });
        release(previous);
        return;
      }
      dispatch({ type: "video/validating" });
      release(previous);
      const objectUrl = mint(file);
      const metadata = await readVideoMetadata(objectUrl, file);
      if (!alive.current) return;
      if (metadata === "invalid") {
        release(objectUrl);
        // Not the file's rule-breaking, the decoder's refusal: an `error`,
        // with the "we couldn't read this video" sentence.
        dispatch({ type: "video/error", code: "invalid-video" });
        return;
      }
      const facts = validateVideoMetadata(metadata, limits);
      if (!facts.ok) {
        release(objectUrl);
        dispatch({ type: "video/invalid", code: facts.code });
        return;
      }
      dispatch({
        type: "video/ready",
        video: { file, objectUrl, name: file.name, size: file.size, mimeType: file.type, metadata },
        maxDurationMs: limits.video.maxDurationMs,
      });
    },
    [limits, mint, release, state.project.video?.objectUrl],
  );

  const clearVideo = useCallback(() => {
    const previous = state.project.video?.objectUrl;
    dispatch({ type: "video/clear" });
    release(previous);
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
