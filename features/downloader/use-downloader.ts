"use client";

import { useCallback, useRef, useState } from "react";

import type { ApiError, VideoMetadata } from "@/types";

type Status = "idle" | "fetching" | "ready" | "error";

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

  return { ...state, fetchMetadata, reset };
}
