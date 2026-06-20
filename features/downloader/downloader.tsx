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
      <form
        onSubmit={handleSubmit}
        className="glass rounded-[1.4rem] p-2 shadow-elevated ring-1 ring-black/[0.03] focus-within:ring-primary/30"
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a video link…"
              aria-label="Video URL"
              className="h-16 w-full rounded-2xl bg-background/50 px-5 pr-28 text-base outline-none ring-1 ring-inset ring-border transition focus:bg-background/80 focus:ring-2 focus:ring-primary sm:text-lg"
            />
            <div className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
              {url ? (
                <button
                  type="button"
                  onClick={handleClear}
                  aria-label="Clear"
                  className="rounded-xl p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={handlePaste}
                className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70 active:scale-[0.97]"
              >
                <ClipboardPaste className="h-4 w-4" /> Paste
              </button>
            </div>
          </div>
          <button
            type="submit"
            disabled={isBusy}
            className="group inline-flex h-16 items-center justify-center gap-2 rounded-2xl bg-primary px-8 text-base font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:shadow-primary/40 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> Fetching…
              </>
            ) : (
              <>
                <Search className="h-5 w-5 transition-transform group-hover:scale-110" />{" "}
                Download
              </>
            )}
          </button>
        </div>

        {detected && detected.id !== "generic" ? (
          <p className="px-4 pb-1.5 pt-2.5 text-xs text-muted-foreground">
            Detected ·{" "}
            <span className="font-medium text-foreground">{detected.name}</span>
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
