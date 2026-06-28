# syntax=docker/dockerfile:1
# ----------------------------------------------------------------------
# FrenzSave production image.
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

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0 YTDLP_PATH=/usr/local/bin/yt-dlp ARIA2C_PATH=/usr/bin/aria2c

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
