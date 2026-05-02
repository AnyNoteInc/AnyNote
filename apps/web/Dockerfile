FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

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

# Dummy build-time values so Next.js static page collection succeeds.
# These are NEVER baked into the runtime image — they are only used
# during `next build` to satisfy module-level env reads.
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_SECRET=build-time-secret-placeholder-32ch
ENV NEXT_PUBLIC_BASE_URL=http://localhost:3000
ENV S3_ENDPOINT=http://localhost:9000
ENV S3_REGION=us-east-1
ENV S3_ACCESS_KEY=dummy
ENV S3_SECRET_KEY=dummy
ENV S3_BUCKET=dummy
ENV NEXT_PUBLIC_YJS_URL=ws://localhost:1234

RUN pnpm --filter @repo/db prisma:generate
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

EXPOSE 3000
CMD node apps/web/server.js
