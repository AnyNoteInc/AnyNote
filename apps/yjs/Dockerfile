FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
WORKDIR /app

# ---
FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
RUN turbo prune yjs --docker

# ---
FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
RUN pnpm --filter @repo/db prisma:generate
RUN pnpm --filter yjs build

# ---
FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
USER nodejs

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/apps/yjs/dist ./apps/yjs/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/yjs/node_modules ./apps/yjs/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/yjs/package.json ./apps/yjs/package.json
WORKDIR /app/apps/yjs

EXPOSE 1234
CMD ["node", "dist/index.js"]
