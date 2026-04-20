# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /repo
RUN corepack enable

# Copy the full monorepo — engines depends on @repo/db workspace package
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/engines/package.json ./apps/engines/package.json
COPY packages ./packages
COPY apps/engines ./apps/engines

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/db prisma generate
RUN pnpm --filter engines build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable

COPY --from=builder /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/apps/engines/package.json ./apps/engines/package.json
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/engines/dist ./apps/engines/dist
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/engines/node_modules ./apps/engines/node_modules

WORKDIR /app/apps/engines
EXPOSE 8082
CMD ["node", "dist/main.js"]
