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
# (@repo/db, @repo/mail, @repo/yookassa) plus @repo/storage which still
# ships a dist/ export. This must happen before the NestJS build so Node
# can resolve the workspace symlinks at runtime.
RUN pnpm --filter @repo/db --filter @repo/mail --filter @repo/storage --filter @repo/yookassa build

# Patch package.json exports for packages that still reference src/*.ts so that
# the runner (plain node, no TypeScript loader) resolves to compiled dist/*.js.
# @repo/db, @repo/mail, @repo/yookassa expose raw TS; @repo/storage already
# uses dist/. The `types` condition maps src/*.ts -> dist/*.d.ts; other
# conditions use dist/*.js.
RUN <<'EOF' node
const fs = require('fs');
for (const pkg of ['packages/db', 'packages/mail', 'packages/yookassa']) {
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

# @repo/mail imports 'server-only' which throws outside Next.js.
# Replace it with a no-op so the NestJS mailer cron can load the module.
# Use a glob to be robust against future server-only version bumps.
RUN set -e; \
    found=0; \
    for d in node_modules/.pnpm/server-only@*/node_modules/server-only; do \
      if [ -d "$d" ]; then \
        printf '// no-op: server-only guard disabled outside Next.js\n' > "$d/index.js"; \
        echo "stubbed $d/index.js"; \
        found=1; \
      fi; \
    done; \
    if [ "$found" -eq 0 ]; then \
      echo "ERROR: no server-only@* directory found - check pnpm layout" >&2; \
      exit 1; \
    fi

USER nodejs
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/dist ./apps/engines/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/node_modules ./apps/engines/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/package.json ./apps/engines/package.json
WORKDIR /app/apps/engines

EXPOSE 8082
CMD ["node", "dist/main.js"]
