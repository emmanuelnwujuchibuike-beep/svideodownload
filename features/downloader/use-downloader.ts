"use client";

import { useCallback, useRef, useState } from "react";

import type { ApiError, MediaKind, VideoMetadata } from "@/types";

type Status = "idle" | "fetching" | "ready" | "downloading" | "error";

interface State {
  status: Status;
  metadata: VideoMetadata | null;
  error: string | null;
}

const initialState: State = { status: "idle", metadata: null, error: null };

export function useDownloader() {
  const [state, setState] = useState<State>(initialState);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initialState);
  }, []);

  const fetchMetadata = useCallback(async (url: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState({ status: "fetching", metadata: null, error: null });
    try {
      const res = await fetch("/api/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        const err = json as ApiError;
        setState({ status: "error", metadata: null, error: err.error ?? "Failed to fetch." });
        return;
      }
      setState({ status: "ready", metadata: json.data as VideoMetadata, error: null });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        metadata: null,
        error: "Network error. Please check your connection.",
      });
    }
  }, []);

  const download = useCallback(
    async (formatId: string, kind: MediaKind) => {
      const meta = state.metadata;
      if (!meta) return;
      setState((s) => ({ ...s, status: "downloading", error: null }));
      try {
        const res = await fetch("/api/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: meta.sourceUrl, formatId, kind, title: meta.title }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as ApiError | null;
          setState((s) => ({
            ...s,
            status: "ready",
            error: json?.error ?? "Download failed.",
          }));
          return;
        }
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        const match = disposition.match(/filename="?([^"]+)"?/);
        const filename = match?.[1] || `download.${kind === "audio" ? "m4a" : "mp4"}`;

        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        setState((s) => ({ ...s, status: "ready" }));
      } catch {
        setState((s) => ({ ...s, status: "ready", error: "Download failed." }));
      }
    },
    [state.metadata],
  );

  return { ...state, fetchMetadata, download, reset };
}
