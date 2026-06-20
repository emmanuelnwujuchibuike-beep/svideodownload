"use client";

import { ClipboardPaste, Loader2, Search, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { detectPlatform } from "@/lib/platforms";
import { sourceUrlSchema } from "@/lib/validation";

import { PreviewCard } from "./preview-card";
import { useDownloader } from "./use-downloader";

export function Downloader() {
  const [url, setUrl] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const { status, metadata, error, fetchMetadata, download, reset } = useDownloader();

  const isBusy = status === "fetching";
  const detected = url ? detectPlatform(url) : null;

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        setValidationError(null);
      }
    } catch {
      setValidationError("Clipboard access was blocked. Paste manually.");
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = sourceUrlSchema.safeParse(url);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid URL.");
      return;
    }
    setValidationError(null);
    void fetchMetadata(parsed.data);
  };

  const handleClear = () => {
    setUrl("");
    setValidationError(null);
    reset();
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="glass rounded-2xl p-2 shadow-2xl">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a TikTok, Instagram, YouTube… link"
              aria-label="Video URL"
              className="h-14 w-full rounded-xl bg-background/60 px-4 pr-24 text-base outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
            />
            <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handlePaste}
                className="inline-flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-sm font-medium hover:bg-secondary/80"
              >
                <ClipboardPaste className="h-4 w-4" /> Paste
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex h-14 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-base font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-60"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Fetching…
              </>
            ) : (
              <>
                <Search className="h-5 w-5" /> Download
              </>
            )}
          </button>
        </div>

        {detected && detected.id !== "generic" ? (
          <p className="px-3 pb-1 pt-2 text-xs text-muted-foreground">
            Detected platform: <span className="font-medium text-foreground">{detected.name}</span>
          </p>
        ) : null}
      </form>

      {(validationError || error) && status !== "fetching" ? (
        <p role="alert" className="mt-3 text-center text-sm text-red-400">
          {validationError ?? error}
        </p>
      ) : null}

      {metadata ? (
        <PreviewCard
          metadata={metadata}
          downloading={status === "downloading"}
          onDownload={download}
        />
      ) : null}
    </div>
  );
}
