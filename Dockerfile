# syntax=docker/dockerfile:1
# ----------------------------------------------------------------------
# SVideoDownload production image.
# Bundles the Next.js standalone server + yt-dlp + ffmpeg (for merging
# video/audio streams and audio transcoding).
# ----------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# ---- builder ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runner ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# Runtime media tooling.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 curl aria2 \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 🔴 The entrypoint refreshes yt-dlp on every container START — see the long note
# in the script. Installing it at BUILD time only (the RUN above) freezes it at
# image-build date, and a few weeks of YouTube player changes is all it takes for
# every YouTube download to fail while metadata still works.
COPY --chown=nextjs:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
  # The refreshed binary is written back over this path at boot, so the runtime
  # user must own it. Without this the update silently no-ops as `nextjs`.
  && chown nextjs:nodejs /usr/local/bin/yt-dlp

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 YTDLP_PATH=/usr/local/bin/yt-dlp ARIA2C_PATH=/usr/bin/aria2c

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
