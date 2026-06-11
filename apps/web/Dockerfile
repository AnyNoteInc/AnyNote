FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
# Include $PNPM_HOME/bin, not just $PNPM_HOME: pnpm installs global binaries
# (e.g. turbo) into /pnpm/bin. pnpm 11 hard-errors ("global bin directory not
# in PATH") on `pnpm add --global` when it's missing; pnpm 10 only warned.
ENV PATH="$PNPM_HOME:$PNPM_HOME/bin:$PATH"

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
# Set working directory
WORKDIR /app

# ---
FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
# Add lockfile and package.json's of isolated subworkspace
RUN turbo prune web --docker

# ---
FROM base AS builder
# First install the dependencies (as they change less often)
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
# Build the project
COPY --from=prepare /app/out/full/ .

# `turbo prune` only copies workspace packages, so the root-level docs/
# directory (referenced via the @docs alias in next.config.js) is missing
# from out/full. Pull in the bits the build imports so `next build` can
# resolve them: @docs/terms/*.md (legal pages), @docs/changelog.md
# (the public /changelog page), and @docs/developers/*.md (the /developers
# portal pages).
COPY --from=prepare /app/docs/terms ./docs/terms
COPY --from=prepare /app/docs/changelog.md ./docs/changelog.md
COPY --from=prepare /app/docs/developers ./docs/developers

# Build-time values consumed by Next.js route metadata and static page collection.
# Public SEO values are supplied as build args in production; defaults keep local
# Docker builds usable.
ARG NEXT_PUBLIC_BASE_URL=http://localhost:3000
ARG YANDEX_VERIFICATION=""
ARG GOOGLE_SITE_VERIFICATION=""
ARG SEO_NOINDEX_ALL=false
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-secret-placeholder-32ch
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL
ENV YANDEX_VERIFICATION=$YANDEX_VERIFICATION
ENV GOOGLE_SITE_VERIFICATION=$GOOGLE_SITE_VERIFICATION
ENV SEO_NOINDEX_ALL=$SEO_NOINDEX_ALL
ENV S3_ENDPOINT=http://localhost:9000
ENV S3_REGION=us-east-1
ENV S3_ACCESS_KEY=dummy
ENV S3_SECRET_KEY=dummy
ENV S3_BUCKET=dummy
ENV NEXT_PUBLIC_YJS_URL=ws://localhost:1234

# NEXT_PUBLIC_VAPID_PUBLIC_KEY is consumed by 'use client' code
# (apps/web/src/lib/push/vapid.ts) and Next.js inlines it into the
# client bundle at build time — there's no runtime swap path like
# resolveYjsUrl(). The value is supplied as a build-arg in the deploy
# workflow; an empty default keeps `pnpm build` working locally.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

RUN pnpm --filter @repo/db prisma:generate
# The Next.js 16 production build of apps/web exceeds Node's default heap on
# memory-constrained CI runners (GitHub ubuntu-latest is ~7 GB) and gets
# OOM-killed (exit 137). Raise the old-space limit for the build step. Scoped
# to the builder stage so it doesn't affect the runtime image.
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN pnpm turbo build

# ---
FROM base AS runner
# Don't run production as root for security reasons
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
USER nextjs

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# For the one-shot `migrate` compose service in deploy/compose.yml: the
# image needs the full pnpm node_modules tree (Prisma CLI + tsx + dotenv +
# @prisma/* + transitive deps) and the packages/db source (schema +
# migrations + seed). Overwrites the trimmed standalone node_modules with
# the builder's full tree. Image grows by ~700 MB, but makes the same
# image runnable as both the web server and the migration runner without
# a second build pipeline.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db

EXPOSE 3000
CMD node apps/web/server.js
