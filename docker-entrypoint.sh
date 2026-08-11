#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  Worker entrypoint — refresh yt-dlp, then start the server.
# ═══════════════════════════════════════════════════════════════════════════
#
# 🔴 WHY THIS EXISTS (2026-08-11)
#
# The Dockerfile installs `yt-dlp/releases/latest` at IMAGE BUILD time, which
# freezes it at whatever was current the last time the image was built. YouTube
# changes its player, signature and PO-token handling constantly and yt-dlp ships
# fixes every few days, so a worker image that is a few weeks old stops being
# able to fetch YouTube media — while metadata extraction, which leans on far
# less of that machinery, keeps working.
#
# That is exactly the reported symptom: every YouTube download failed at every
# quality and for audio-only, on a 19-second clip and on a 60-minute one, while
# /api/metadata answered fine.
#
# So the binary is refreshed on every container START rather than only on build.
# Fly and Railway restart containers regularly, and a deploy always does, so this
# keeps the worker close to current without a rebuild.
#
# ── Everything here is best-effort by design ──────────────────────────────
# A failed update must NEVER stop the worker booting. If GitHub is unreachable,
# rate-limits us, or ships a bad binary, the image's own yt-dlp is still there
# and still works for every platform whose extractor has not changed. `|| true`
# on each step and a verification before the swap are what guarantee that: the
# new binary is only moved into place after it answers `--version`.

set -u

YTDLP_PATH="${YTDLP_PATH:-/usr/local/bin/yt-dlp}"
TMP="/tmp/yt-dlp.new"

echo "[entrypoint] yt-dlp at start: $("$YTDLP_PATH" --version 2>/dev/null || echo unknown)"

# Written to a temp path first. Downloading over the live binary would leave a
# truncated, unrunnable file if the transfer is interrupted — turning a routine
# refresh into an outage of every platform at once.
if curl -fsSL --max-time 45 \
    https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$TMP" 2>/dev/null; then
  chmod a+rx "$TMP" 2>/dev/null || true
  # Only swap it in if it actually RUNS. A 0-byte file, an HTML error page or a
  # binary for the wrong architecture all download "successfully".
  if "$TMP" --version >/dev/null 2>&1; then
    cp "$TMP" "$YTDLP_PATH" 2>/dev/null || true
    echo "[entrypoint] yt-dlp updated to: $("$YTDLP_PATH" --version 2>/dev/null || echo unknown)"
  else
    echo "[entrypoint] downloaded yt-dlp did not run — keeping the image's copy"
  fi
  rm -f "$TMP" 2>/dev/null || true
else
  echo "[entrypoint] yt-dlp update skipped (network) — keeping the image's copy"
fi

exec "$@"
