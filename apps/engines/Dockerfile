# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN apk add --no-cache libc6-compat
RUN corepack enable pnpm
WORKDIR /app

FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
RUN turbo prune engines --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .

# Build-time stub: packages/db/prisma.config.ts eagerly reads DATABASE_URL
# at generate time and throws if it's missing. Placeholder only — never
# leaks to the runner stage (this ENV is scoped to the builder stage).
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy

RUN pnpm --filter @repo/db prisma:generate

# Build workspace packages whose package.json exports point to src/*.ts
# (@repo/db, @repo/mail, @repo/storage, @repo/yookassa). This must happen
# before the NestJS build so Node can resolve the workspace symlinks at
# runtime.
RUN pnpm --filter @repo/db --filter @repo/mail --filter @repo/storage --filter @repo/yookassa build

# Patch package.json exports for packages that reference src/*.ts so that
# the runner (plain node, no TypeScript loader) resolves to compiled dist/*.js.
# The `types` condition maps src/*.ts -> dist/*.d.ts; other conditions use
# dist/*.js.
RUN <<'EOF' node
const fs = require('fs');
for (const pkg of ['packages/db', 'packages/mail', 'packages/storage', 'packages/yookassa']) {
  const p = pkg + '/package.json';
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const fixJs = s => typeof s === 'string' ? s.replace(/^\.\/src\/(.+)\.ts$/, './dist/$1.js') : s;
  const fixDts = s => typeof s === 'string' ? s.replace(/^\.\/src\/(.+)\.ts$/, './dist/$1.d.ts') : s;
  const walk = (o, key) => {
    if (!o || typeof o !== 'object') return key === 'types' ? fixDts(o) : fixJs(o);
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v, k)]));
  };
  if (d.main) d.main = fixJs(d.main);
  if (d.exports) d.exports = walk(d.exports, null);
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  console.log('patched', p);
}
EOF

RUN pnpm --filter engines build

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs

COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages

USER nodejs
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/dist ./apps/engines/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/node_modules ./apps/engines/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/package.json ./apps/engines/package.json
WORKDIR /app/apps/engines

EXPOSE 8082
CMD ["node", "dist/main.js"]
