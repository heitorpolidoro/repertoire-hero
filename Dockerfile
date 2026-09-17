# Install dependencies only when needed
FROM node:24-alpine AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why the glibc shim might be needed.
# node:24-alpine is Alpine 3.24, which no longer ships a `libc6-compat` package:
# `gcompat` provides it. The old `libc6-compat=1.2.4-r2` pin therefore made the image
# unbuildable ("gcompat-1.1.0-r4 breaks: world[libc6-compat=1.2.4-r2]"). The version
# stays pinned (DOK-DL3018); only the package name and version changed.
RUN apk add --no-cache gcompat=1.1.0-r4
WORKDIR /app

# Install dependencies based on the preferred package manager.
# `.npmrc` is part of the input, not an optional extra: it carries
# `legacy-peer-deps=true`, which is the resolution mode package-lock.json was
# generated under. Without it `npm ci` rejects the very lockfile it is given
# ("lock file's ajv@6.15.0 does not satisfy ajv@8.20.0").
COPY package.json package-lock.json* .npmrc ./
# Needed by the root package's postinstall hook (scripts/copy-pdf-worker.mjs);
# without it `npm ci` aborts this stage.
COPY scripts ./scripts
RUN npm ci

# Rebuild the source code only when needed
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js collects completely anonymous telemetry data about general usage.
# Learn more here: https://nextjs.org/telemetry
# Uncomment the following line in case you want to disable telemetry during the build.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN npm run build

# Production image, copy all the files and run next
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED 1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
CMD ["node", "server.js"]
