# CI/CD Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-workflow GitHub Actions pipeline (CI on PR, semantic-release on merge, image build + verify + mock deploy on tag) that publishes the four AnyNote runtime services to GitHub Container Registry.

**Architecture:** Three workflows (`ci.yml`, `release.yml`, `deploy.yml`) share a composite setup action. `release.yml` uses `semantic-release` to cut tags from Conventional Commits on `main`; tags trigger `deploy.yml`, which builds and pushes 4 Docker images via a matrix and verifies them by booting a `compose.yml` + `compose.ci.yml` overlay with healthchecks.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, Turborepo (`turbo prune --docker`), Node 26 alpine, Python 3.13 + uv, semantic-release with the angular preset.

**Spec:** [docs/superpowers/specs/2026-05-02-cicd-pipeline-design.md](../specs/2026-05-02-cicd-pipeline-design.md)

---

## Phase 1 — Foundation: Web `/api/health` endpoint

This is the only application code change. TDD.

### Task 1.1: Add `/api/health` route in `apps/web` (TDD)

**Files:**
- Create: `apps/web/test/api-health.test.ts`
- Create: `apps/web/src/app/api/health/route.ts`

- [ ] **Step 1.1.1: Write the failing test**

Create `apps/web/test/api-health.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { GET } from '../src/app/api/health/route'

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 1.1.2: Run test to verify it fails**

Run from repo root:
```bash
pnpm --filter web test -- --run test/api-health.test.ts
```

Expected: FAIL with `Cannot find module '../src/app/api/health/route'` or similar import error.

- [ ] **Step 1.1.3: Implement the route**

Create `apps/web/src/app/api/health/route.ts`:

```ts
export const runtime = 'nodejs'

export async function GET() {
  return Response.json({ status: 'ok' })
}
```

`runtime = 'nodejs'` matches the convention used by every other route handler under `apps/web/src/app/api/` (e.g. `trpc/[trpc]/route.ts`, `yjs/token/route.ts`).

- [ ] **Step 1.1.4: Run test to verify it passes**

```bash
pnpm --filter web test -- --run test/api-health.test.ts
```

Expected: PASS — 1 test passing, exit code 0.

- [ ] **Step 1.1.5: Commit**

```bash
git add apps/web/src/app/api/health/route.ts apps/web/test/api-health.test.ts
git commit -m "feat(web): add /api/health route for container healthchecks"
```

---

## Phase 2 — Dockerfiles: uniform `turbo prune --docker` pattern

Bump existing Dockerfiles to Node 26 and refactor `engines` and `agents` to the same `turbo prune --docker` pattern as `web`. Create a new `yjs` Dockerfile.

### Task 2.1: Bump `apps/web/Dockerfile` to Node 26

**Files:**
- Modify: `apps/web/Dockerfile:1`

- [ ] **Step 2.1.1: Bump base image**

Open `apps/web/Dockerfile`. Change the first line:

```diff
-FROM node:22-alpine AS base
+FROM node:26-alpine AS base
```

Also remove the comment block on lines 3–4 referencing copy-paste docs (the docs were removed in commit `d32ac69`):

```diff
-# This Dockerfile is copy-pasted into our main docs at /docs/handbook/deploying-with-docker.
-# Make sure you update both files!
-
```

- [ ] **Step 2.1.2: Add explicit Prisma client generation**

The current Dockerfile relies on `pnpm turbo build` invoking generate transitively, which is brittle. Add an explicit step before `pnpm turbo build`. Inside the `builder` stage, replace:

```diff
 COPY --from=prepare /app/out/full/ .

-# Uncomment and use build args to enable remote caching
-# ARG TURBO_TEAM
-# ENV TURBO_TEAM=$TURBO_TEAM
-
-# ARG TURBO_TOKEN
-# ENV TURBO_TOKEN=$TURBO_TOKEN
-
-RUN pnpm turbo build
+RUN pnpm --filter @repo/db prisma:generate
+RUN pnpm turbo build
```

(Removed the commented Turbo remote caching block per YAGNI — the spec says it is out of scope.)

- [ ] **Step 2.1.3: Build the image locally**

```bash
docker build -t anynote-web:dev -f apps/web/Dockerfile .
```

Expected: build succeeds with no errors. Final layer reports image size; ~400 MB is typical for Next standalone.

- [ ] **Step 2.1.4: Smoke-run the image**

```bash
docker run --rm --name anynote-web-smoke -d \
  -e DATABASE_URL=postgresql://user:password@host.docker.internal:5432/anynote \
  -e BETTER_AUTH_URL=http://localhost:3000 \
  -e BETTER_AUTH_SECRET=ci-secret-not-real-32-chars-long \
  -e NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
  -p 3000:3000 \
  anynote-web:dev
sleep 8
curl -fsS http://localhost:3000/api/health
docker stop anynote-web-smoke
```

Expected: `curl` returns `{"status":"ok"}`. `docker stop` succeeds.

- [ ] **Step 2.1.5: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "build(web): bump Node to 26-alpine and pin explicit prisma generate"
```

### Task 2.2: Create `apps/yjs/Dockerfile`

**Files:**
- Create: `apps/yjs/Dockerfile`

- [ ] **Step 2.2.1: Write the Dockerfile**

Create `apps/yjs/Dockerfile`:

```dockerfile
FROM node:26-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable

FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
RUN turbo prune yjs --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN pnpm --filter @repo/db prisma:generate
RUN pnpm --filter yjs build

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
```

**Why no `--env-file`?** `apps/yjs/package.json` `start` script reads `--env-file=../../.env` which only exists in dev. In containers, env comes from compose, so we run `node dist/index.js` directly.

- [ ] **Step 2.2.2: Build the image locally**

```bash
docker build -t anynote-yjs:dev -f apps/yjs/Dockerfile .
```

Expected: build succeeds. Image size is small (~150 MB).

- [ ] **Step 2.2.3: Smoke-run the image**

```bash
docker run --rm --name anynote-yjs-smoke -d \
  -e BETTER_AUTH_URL=http://host.docker.internal:3000 \
  -e BETTER_AUTH_JWT_AUDIENCE=anynote-yjs \
  -e YJS_PORT=1234 \
  -p 1234:1234 \
  anynote-yjs:dev
sleep 5
nc -z localhost 1234 && echo "yjs port open" || echo "yjs port NOT open"
docker stop anynote-yjs-smoke
```

Expected: `yjs port open`. (Note: yjs may log a JWKS-fetch error since `host.docker.internal:3000` won't be running, but the listener still binds. That's fine for the smoke test — full E2E is verified in Phase 3.)

- [ ] **Step 2.2.4: Commit**

```bash
git add apps/yjs/Dockerfile
git commit -m "build(yjs): add multi-stage Dockerfile using turbo prune"
```

### Task 2.3: Refactor `apps/engines/Dockerfile` to `turbo prune` + Node 26

**Files:**
- Modify: `apps/engines/Dockerfile` (full rewrite)

- [ ] **Step 2.3.1: Rewrite the Dockerfile**

Replace the entire contents of `apps/engines/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:26-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN corepack enable

FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
RUN turbo prune engines --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=prepare /app/out/full/ .
RUN pnpm --filter @repo/db prisma:generate
RUN pnpm --filter engines build

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
USER nodejs
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/dist ./apps/engines/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/node_modules ./apps/engines/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/apps/engines/package.json ./apps/engines/package.json
WORKDIR /app/apps/engines
EXPOSE 8082
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2.3.2: Build the image locally**

```bash
docker build -t anynote-engines:dev -f apps/engines/Dockerfile .
```

Expected: build succeeds.

- [ ] **Step 2.3.3: Smoke-run and probe `/health`**

```bash
docker run --rm --name anynote-engines-smoke -d \
  -e DATABASE_URL=postgresql://user:password@host.docker.internal:5432/anynote \
  -e ENGINES_PORT=8082 \
  -e ENGINES_MCP_TOKEN=ci-token \
  -p 8082:8082 \
  anynote-engines:dev
sleep 8
curl -fsS http://localhost:8082/health
docker stop anynote-engines-smoke
```

Expected: `curl` returns `{"status":"ok"}` (per existing `HealthController`).

- [ ] **Step 2.3.4: Commit**

```bash
git add apps/engines/Dockerfile
git commit -m "build(engines): refactor to turbo prune pattern and Node 26"
```

### Task 2.4: Refactor `apps/agents/Dockerfile` to `turbo prune` for monorepo isolation

**Files:**
- Modify: `apps/agents/Dockerfile` (full rewrite)

The Python core (uv + spaCy) is unchanged; only the build context isolation pattern changes for uniformity.

- [ ] **Step 2.4.1: Rewrite the Dockerfile**

Replace the entire contents of `apps/agents/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7

# ---- Stage 1: prepare (Node container, uses turbo prune to extract agents subworkspace) ----
FROM node:26-alpine AS prepare
RUN apk add --no-cache libc6-compat
WORKDIR /app
RUN pnpm add turbo --global
COPY . .
RUN turbo prune agents --docker

# ---- Stage 2: builder (Python, install deps + spaCy models) ----
FROM python:3.13-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app
# Pull pyproject.toml + uv.lock from the pruned subworkspace
COPY --from=prepare /app/out/full/apps/agents/pyproject.toml ./pyproject.toml
COPY --from=prepare /app/out/full/apps/agents/uv.lock ./uv.lock

RUN uv sync --frozen --no-dev
RUN uv run python -m spacy download ru_core_news_sm \
 && uv run python -m spacy download en_core_web_sm

COPY --from=prepare /app/out/full/apps/agents/agents ./agents
COPY --from=prepare /app/out/full/apps/agents/py.typed ./py.typed

# ---- Stage 3: runner (slim final image) ----
FROM python:3.13-slim AS runner

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_SYSTEM_PYTHON=1 \
    UV_NO_CACHE=1

RUN pip install --no-cache-dir uv==0.5.*

WORKDIR /app
COPY --from=builder /app /app

EXPOSE 8080
CMD ["uv", "run", "uvicorn", "agents.cmd.rest:app", "--host", "0.0.0.0", "--port", "8080"]
```

**Why a separate `prepare` stage in Node?** `turbo prune` is a Node tool. We use Node only to compute the pruned subworkspace, then switch to Python for the actual build. This keeps the runner image Python-only.

- [ ] **Step 2.4.2: Build the image locally**

```bash
docker build -t anynote-agents:dev -f apps/agents/Dockerfile .
```

Expected: build succeeds. Takes ~5–10 minutes on cold cache (spaCy downloads ~500 MB and uv sync resolves the dep tree).

- [ ] **Step 2.4.3: Smoke-run and probe `/health`**

```bash
docker run --rm --name anynote-agents-smoke -d \
  -e AGENTS_DATABASE_URL=postgresql://user:password@host.docker.internal:5432/agents \
  -e AGENTS_SERVICE_TOKEN=ci-token \
  -e QDRANT__HOST=http://host.docker.internal:6333 \
  -e OLLAMA__HOST=http://host.docker.internal:11434 \
  -p 8080:8080 \
  anynote-agents:dev
sleep 30
curl -fsS http://localhost:8080/health
docker stop anynote-agents-smoke
```

Expected: `curl` returns `{"status":"ok"}` (per `fast_clean.contrib.healthcheck.router` mounted at `/health`).

- [ ] **Step 2.4.4: Commit**

```bash
git add apps/agents/Dockerfile
git commit -m "build(agents): refactor to turbo prune pattern for monorepo isolation"
```

---

## Phase 3 — Compose CI overlay

A new compose file that pulls the four service images alongside the existing `compose.yml` infra, with healthchecks on each so `docker compose --wait` can be the verification gate.

### Task 3.1: Create `compose.ci.yml`

**Files:**
- Create: `compose.ci.yml`

- [ ] **Step 3.1.1: Write the overlay**

Create `compose.ci.yml` at the repo root:

```yaml
# Production-shape compose overlay used by CI verify-boot.
# Combine with the base file:
#   docker compose -f compose.yml -f compose.ci.yml up -d --wait --wait-timeout 120
#
# ANYNOTE_VERSION must be set in the environment to the semver tag (e.g. "1.4.2").
# For local builds use ANYNOTE_VERSION=dev and override `image:` with `build:` if needed.

services:
  web:
    image: ghcr.io/anynoteinc/anynote-web:${ANYNOTE_VERSION:?ANYNOTE_VERSION required}
    depends_on:
      postgres:
        condition: service_healthy
      minio:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/anynote
      NEXT_PUBLIC_BASE_URL: http://localhost:3000
      BETTER_AUTH_URL: http://localhost:3000
      BETTER_AUTH_SECRET: ci-secret-not-real-32-chars-padding
      BETTER_AUTH_JWT_AUDIENCE: anynote-yjs
      NEXT_PUBLIC_YJS_URL: ws://localhost:1234
      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ci-recaptcha-key
      RECAPTCHA_SECRET_KEY: ci-recaptcha-secret
      S3_ENDPOINT: http://minio:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY: admin
      S3_SECRET_KEY: password
      S3_BUCKET: storage
      S3_FORCE_PATH_STYLE: 'true'
      ENGINES_SERVICE_URL: http://engines:8082
      ENGINES_MCP_TOKEN: ci-engines-token
      ENGINES_MCP_URL: http://engines:8082/mcp
      AGENTS_SERVICE_URL: http://agents:8080
      AGENTS_SERVICE_TOKEN: ci-agents-token
      SMTP_HOST: mailhog
      SMTP_PORT: '1025'
      MAIL_FROM: ci@example.com
    ports: ['3000:3000']
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:3000/api/health']
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 30s

  yjs:
    image: ghcr.io/anynoteinc/anynote-yjs:${ANYNOTE_VERSION:?ANYNOTE_VERSION required}
    depends_on:
      web:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/anynote
      BETTER_AUTH_URL: http://web:3000
      BETTER_AUTH_JWT_AUDIENCE: anynote-yjs
      YJS_PORT: '1234'
    ports: ['1234:1234']
    healthcheck:
      test: ['CMD-SHELL', 'nc -z localhost 1234 || exit 1']
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s

  engines:
    image: ghcr.io/anynoteinc/anynote-engines:${ANYNOTE_VERSION:?ANYNOTE_VERSION required}
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/anynote
      ENGINES_PORT: '8082'
      ENGINES_MCP_TOKEN: ci-engines-token
      AGENTS_SERVICE_URL: http://agents:8080
      AGENTS_SERVICE_TOKEN: ci-agents-token
      QDRANT__HOST: http://qdrant:6333
      QDRANT__AUTH__TYPE: bearer_token
      QDRANT__AUTH__BEARER_TOKEN: dev-qdrant-key
      OLLAMA__HOST: http://ollama:11434
      INDEXER_CRON_EXPRESSION: '0 */5 * * * *'
      INDEXER_MAX_ATTEMPTS: '5'
      INDEXER_BATCH: '10'
      SMTP_HOST: mailhog
      SMTP_PORT: '1025'
      MAIL_FROM: ci@example.com
      MAIL_DISPATCH_CRON_EXPRESSION: '*/30 * * * * *'
      MAIL_DISPATCH_BATCH: '10'
      MAIL_DISPATCH_MAX_ATTEMPTS: '5'
      BILLING_RENEWAL_CRON_EXPRESSION: '0 0 * * *'
      BILLING_RENEWAL_BATCH_SIZE: '50'
    ports: ['8082:8082']
    healthcheck:
      test: ['CMD', 'wget', '-qO-', 'http://localhost:8082/health']
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 20s

  agents:
    image: ghcr.io/anynoteinc/anynote-agents:${ANYNOTE_VERSION:?ANYNOTE_VERSION required}
    depends_on:
      postgres:
        condition: service_healthy
      qdrant:
        condition: service_started
    environment:
      AGENTS_DATABASE_URL: postgresql://user:password@postgres:5432/agents
      AGENTS_SERVICE_TOKEN: ci-agents-token
      AGENTS_LOG_LEVEL: INFO
      QDRANT__HOST: http://qdrant:6333
      QDRANT__AUTH__TYPE: bearer_token
      QDRANT__AUTH__BEARER_TOKEN: dev-qdrant-key
      OLLAMA__HOST: http://ollama:11434
      ANYNOTE_MCP_URL: http://engines:8082/mcp
    ports: ['8080:8080']
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:8080/health']
      interval: 5s
      timeout: 5s
      retries: 24
      start_period: 60s
```

**Notes:**
- `${ANYNOTE_VERSION:?...}` makes compose fail loudly if the var is missing.
- The `web` healthcheck uses `wget` because alpine images bundle `wget` (busybox); `curl` requires a separate package.
- `agents` start_period is 60s (heaviest startup — uvicorn + spaCy load).

- [ ] **Step 3.1.2: Validate compose syntax**

```bash
ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml config > /dev/null
```

Expected: exit code 0, no output. (`config` validates and renders the merged compose. Discarding stdout because it's verbose.)

- [ ] **Step 3.1.3: Local end-to-end verify with locally-built images**

Re-tag locally-built images to match the GHCR pattern, then run the merged compose with `--wait`:

```bash
docker tag anynote-web:dev      ghcr.io/anynoteinc/anynote-web:dev
docker tag anynote-yjs:dev      ghcr.io/anynoteinc/anynote-yjs:dev
docker tag anynote-engines:dev  ghcr.io/anynoteinc/anynote-engines:dev
docker tag anynote-agents:dev   ghcr.io/anynoteinc/anynote-agents:dev

# Apply Prisma schema to the just-started postgres before bringing up the apps.
# Use the existing db package to migrate against the compose postgres exposed at 5432.
docker compose -f compose.yml -f compose.ci.yml down -v 2>/dev/null || true
docker compose up -d postgres minio qdrant ollama mailhog
sleep 10
DATABASE_URL=postgresql://user:password@localhost:5432/anynote \
  pnpm --filter @repo/db exec prisma migrate deploy

ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml up -d --wait --wait-timeout 180
```

Expected: command exits 0 — every service reports `Healthy`.

- [ ] **Step 3.1.4: Tear down**

```bash
ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml down -v
```

- [ ] **Step 3.1.5: Commit**

```bash
git add compose.ci.yml
git commit -m "build(ci): add compose.ci.yml overlay for production-shape verify boot"
```

---

## Phase 4 — Semantic-release configuration

### Task 4.1: Add semantic-release dev dependencies

**Files:**
- Modify: `package.json` (devDependencies block)

- [ ] **Step 4.1.1: Install semantic-release packages**

```bash
pnpm add -Dw \
  semantic-release@^24 \
  @semantic-release/changelog@^6 \
  @semantic-release/git@^10
```

(`-w` = root workspace.)

- [ ] **Step 4.1.2: Verify install**

```bash
pnpm exec semantic-release --version
```

Expected: prints a version like `24.x.x`.

- [ ] **Step 4.1.3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(release): add semantic-release dev dependencies"
```

### Task 4.2: Add `.releaserc.json`

**Files:**
- Create: `.releaserc.json`

- [ ] **Step 4.2.1: Write the config**

Create `.releaserc.json` at the repo root:

```json
{
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { "changelogFile": "CHANGELOG.md" }
    ],
    [
      "@semantic-release/git",
      {
        "assets": ["CHANGELOG.md", "package.json"],
        "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
      }
    ],
    "@semantic-release/github"
  ]
}
```

- [ ] **Step 4.2.2: Dry-run to validate config**

```bash
pnpm exec semantic-release --dry-run --no-ci
```

Expected: emits log lines like `Loaded plugin "..."` for each plugin and either reports the next release or "There are no relevant changes". Either is success — we're validating the config loads without errors.

(If `--no-ci` flag is rejected on this version, use `CI=false GITHUB_TOKEN=test pnpm exec semantic-release --dry-run` instead. The dry-run is purely a config-load test.)

- [ ] **Step 4.2.3: Commit**

```bash
git add .releaserc.json
git commit -m "build(release): configure semantic-release with angular preset and changelog"
```

---

## Phase 5 — GitHub Actions: composite + three workflows

### Task 5.1: Create the composite setup action

**Files:**
- Create: `.github/actions/setup/action.yml`

- [ ] **Step 5.1.1: Write the composite action**

Create `.github/actions/setup/action.yml`:

```yaml
name: Setup
description: Install pnpm, Node, Python, uv, dependencies, and generate Prisma client

runs:
  using: composite
  steps:
    - name: Setup pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 9

    - name: Setup Node
      uses: actions/setup-node@v4
      with:
        node-version: '26'
        cache: 'pnpm'

    - name: Setup Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.13'

    - name: Setup uv
      uses: astral-sh/setup-uv@v4
      with:
        version: '0.5.x'

    - name: Install Node dependencies
      run: pnpm install --frozen-lockfile
      shell: bash

    - name: Generate Prisma client
      run: pnpm --filter @repo/db prisma:generate
      shell: bash

    - name: Install Python dependencies
      run: uv sync --frozen
      shell: bash
      working-directory: apps/agents
```

- [ ] **Step 5.1.2: Lint with `actionlint`**

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no errors. (If `actionlint` reports unrelated warnings about other files we'll fix in later tasks, focus only on `.github/actions/setup/action.yml` for this step.)

- [ ] **Step 5.1.3: Commit**

```bash
git add .github/actions/setup/action.yml
git commit -m "ci: add composite setup action for pnpm/Node/Python/uv toolchain"
```

### Task 5.2: Create `ci.yml` (PR pipeline)

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 5.2.1: Write the workflow**

Create `.github/workflows/ci.yml`. **Important:** MinIO is started via a sidecar `docker run` (not as a GHA `services:` entry) because the MinIO image requires `server /data` as runtime args, which GHA service containers cannot supply. Postgres, qdrant, and mailhog work fine as service containers.

```yaml
name: CI

on:
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.head_ref }}
  cancel-in-progress: true

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 25

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
          POSTGRES_DB: anynote
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U user -d anynote"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

      qdrant:
        image: qdrant/qdrant:v1.12.4
        ports: ['6333:6333']

      mailhog:
        image: mailhog/mailhog:latest
        ports: ['1025:1025', '8025:8025']

    env:
      DATABASE_URL: postgresql://user:password@localhost:5432/anynote
      AGENTS_DATABASE_URL: postgresql://user:password@localhost:5432/agents
      NEXT_PUBLIC_BASE_URL: http://localhost:3000
      BETTER_AUTH_URL: http://localhost:3000
      BETTER_AUTH_SECRET: ci-secret-not-real-32-chars-padding
      BETTER_AUTH_JWT_AUDIENCE: anynote-yjs
      NEXT_PUBLIC_YJS_URL: ws://localhost:1234
      YJS_PORT: '1234'
      S3_ENDPOINT: http://localhost:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY: admin
      S3_SECRET_KEY: password
      S3_BUCKET: storage
      S3_FORCE_PATH_STYLE: 'true'
      QDRANT__HOST: http://localhost:6333
      QDRANT__AUTH__TYPE: bearer_token
      QDRANT__AUTH__BEARER_TOKEN: dev-qdrant-key
      OLLAMA__HOST: http://localhost:11434
      AGENTS_SERVICE_URL: http://localhost:8080
      AGENTS_SERVICE_TOKEN: ci-agents-token
      AGENTS_LOG_LEVEL: INFO
      ENGINES_PORT: '8082'
      ENGINES_SERVICE_URL: http://localhost:8082
      ENGINES_MCP_TOKEN: ci-engines-token
      ENGINES_MCP_URL: http://localhost:8082/mcp
      ANYNOTE_MCP_URL: http://localhost:8082/mcp
      INDEXER_CRON_EXPRESSION: '0 */5 * * * *'
      INDEXER_MAX_ATTEMPTS: '5'
      INDEXER_BATCH: '10'
      UPLOAD_INLINE_MAX_BYTES: '1048576'
      SMTP_HOST: localhost
      SMTP_PORT: '1025'
      SMTP_SECURE: 'false'
      MAIL_FROM: ci@example.com
      MAIL_DISPATCH_CRON_EXPRESSION: '*/30 * * * * *'
      MAIL_DISPATCH_BATCH: '10'
      MAIL_DISPATCH_MAX_ATTEMPTS: '5'
      BILLING_RENEWAL_CRON_EXPRESSION: '0 0 * * *'
      BILLING_RENEWAL_BATCH_SIZE: '50'
      YOOKASSA_MOCK_ENABLED: 'true'
      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ci-recaptcha-key
      RECAPTCHA_SECRET_KEY: ci-recaptcha-secret

    steps:
      - uses: actions/checkout@v4

      - name: Setup toolchain
        uses: ./.github/actions/setup

      - name: Start MinIO
        run: |
          docker run -d --name minio-ci \
            -p 9000:9000 \
            -e MINIO_ROOT_USER=admin \
            -e MINIO_ROOT_PASSWORD=password \
            minio/minio server /data
          for i in 1 2 3 4 5 6 7 8 9 10; do
            if curl -fsS http://localhost:9000/minio/health/live; then
              echo "minio ready"; exit 0
            fi
            sleep 2
          done
          echo "minio failed to become healthy" >&2; exit 1

      - name: Create MinIO bucket
        run: |
          docker run --rm --network host \
            -e MC_HOST_local=http://admin:password@localhost:9000 \
            minio/mc mb --ignore-existing local/storage

      - name: Initialize agents database
        run: |
          PGPASSWORD=password psql -h localhost -U user -d anynote -v ON_ERROR_STOP=1 -c "
            SELECT 'CREATE DATABASE agents'
              WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agents')\gexec
            GRANT ALL PRIVILEGES ON DATABASE agents TO \"user\";
          "

      - name: Apply Prisma schema
        run: pnpm --filter @repo/db exec prisma migrate deploy

      - name: Seed Prisma data
        run: pnpm --filter @repo/db exec prisma db seed

      - name: Type check
        run: pnpm check-types

      - name: Lint
        run: pnpm lint

      - name: Test
        run: pnpm test

      - name: Stop MinIO
        if: always()
        run: docker stop minio-ci || true
```

- [ ] **Step 5.2.2: Lint with `actionlint`**

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/ci.yml
```

Expected: no errors.

- [ ] **Step 5.2.3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI workflow for PRs (lint + tests with service containers)"
```

### Task 5.3: Create `release.yml` (merge to main → semantic-release)

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 5.3.1: Write the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    timeout-minutes: 25

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: user
          POSTGRES_PASSWORD: password
          POSTGRES_DB: anynote
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U user -d anynote"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

      qdrant:
        image: qdrant/qdrant:v1.12.4
        ports: ['6333:6333']

      mailhog:
        image: mailhog/mailhog:latest
        ports: ['1025:1025', '8025:8025']

    env:
      DATABASE_URL: postgresql://user:password@localhost:5432/anynote
      AGENTS_DATABASE_URL: postgresql://user:password@localhost:5432/agents
      NEXT_PUBLIC_BASE_URL: http://localhost:3000
      BETTER_AUTH_URL: http://localhost:3000
      BETTER_AUTH_SECRET: ci-secret-not-real-32-chars-padding
      BETTER_AUTH_JWT_AUDIENCE: anynote-yjs
      NEXT_PUBLIC_YJS_URL: ws://localhost:1234
      YJS_PORT: '1234'
      S3_ENDPOINT: http://localhost:9000
      S3_REGION: us-east-1
      S3_ACCESS_KEY: admin
      S3_SECRET_KEY: password
      S3_BUCKET: storage
      S3_FORCE_PATH_STYLE: 'true'
      QDRANT__HOST: http://localhost:6333
      QDRANT__AUTH__TYPE: bearer_token
      QDRANT__AUTH__BEARER_TOKEN: dev-qdrant-key
      OLLAMA__HOST: http://localhost:11434
      AGENTS_SERVICE_URL: http://localhost:8080
      AGENTS_SERVICE_TOKEN: ci-agents-token
      AGENTS_LOG_LEVEL: INFO
      ENGINES_PORT: '8082'
      ENGINES_SERVICE_URL: http://localhost:8082
      ENGINES_MCP_TOKEN: ci-engines-token
      ENGINES_MCP_URL: http://localhost:8082/mcp
      ANYNOTE_MCP_URL: http://localhost:8082/mcp
      INDEXER_CRON_EXPRESSION: '0 */5 * * * *'
      INDEXER_MAX_ATTEMPTS: '5'
      INDEXER_BATCH: '10'
      UPLOAD_INLINE_MAX_BYTES: '1048576'
      SMTP_HOST: localhost
      SMTP_PORT: '1025'
      SMTP_SECURE: 'false'
      MAIL_FROM: ci@example.com
      MAIL_DISPATCH_CRON_EXPRESSION: '*/30 * * * * *'
      MAIL_DISPATCH_BATCH: '10'
      MAIL_DISPATCH_MAX_ATTEMPTS: '5'
      BILLING_RENEWAL_CRON_EXPRESSION: '0 0 * * *'
      BILLING_RENEWAL_BATCH_SIZE: '50'
      YOOKASSA_MOCK_ENABLED: 'true'
      NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ci-recaptcha-key
      RECAPTCHA_SECRET_KEY: ci-recaptcha-secret

    steps:
      - uses: actions/checkout@v4
      - name: Setup toolchain
        uses: ./.github/actions/setup
      - name: Start MinIO
        run: |
          docker run -d --name minio-ci \
            -p 9000:9000 \
            -e MINIO_ROOT_USER=admin \
            -e MINIO_ROOT_PASSWORD=password \
            minio/minio server /data
          for i in 1 2 3 4 5 6 7 8 9 10; do
            if curl -fsS http://localhost:9000/minio/health/live; then
              echo "minio ready"; exit 0
            fi
            sleep 2
          done
          echo "minio failed to become healthy" >&2; exit 1
      - name: Create MinIO bucket
        run: |
          docker run --rm --network host \
            -e MC_HOST_local=http://admin:password@localhost:9000 \
            minio/mc mb --ignore-existing local/storage
      - name: Initialize agents database
        run: |
          PGPASSWORD=password psql -h localhost -U user -d anynote -v ON_ERROR_STOP=1 -c "
            SELECT 'CREATE DATABASE agents'
              WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agents')\gexec
            GRANT ALL PRIVILEGES ON DATABASE agents TO \"user\";
          "
      - name: Apply Prisma schema
        run: pnpm --filter @repo/db exec prisma migrate deploy
      - name: Seed Prisma data
        run: pnpm --filter @repo/db exec prisma db seed
      - name: Type check
        run: pnpm check-types
      - name: Lint
        run: pnpm lint
      - name: Test
        run: pnpm test

  release:
    needs: lint-and-test
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      contents: write
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: true
      - name: Setup toolchain
        uses: ./.github/actions/setup
      - name: Run semantic-release
        run: pnpm exec semantic-release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 5.3.2: Lint with `actionlint`**

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/release.yml
```

Expected: no errors.

- [ ] **Step 5.3.3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow with semantic-release on main"
```

### Task 5.4: Create `deploy.yml` (tag → build → verify → mock deploy)

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 5.4.1: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  push:
    tags: ['v*']

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io
  IMAGE_NAMESPACE: ${{ github.repository_owner }}/anynote

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix:
        service: [web, yjs, agents, engines]
    steps:
      - uses: actions/checkout@v4

      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Compute image metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAMESPACE }}-${{ matrix.service }}
          tags: |
            type=semver,pattern={{version}}
            type=raw,value=latest

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: ./apps/${{ matrix.service }}/Dockerfile
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha,scope=${{ matrix.service }}
          cache-to: type=gha,mode=max,scope=${{ matrix.service }}

  verify:
    needs: build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
      packages: read
    steps:
      - uses: actions/checkout@v4

      - name: Setup toolchain
        uses: ./.github/actions/setup

      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"

      - name: Start postgres and apply Prisma schema
        run: |
          docker compose up -d postgres
          for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
            status=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q postgres)" 2>/dev/null || true)
            if [ "$status" = "healthy" ]; then echo "postgres ready"; break; fi
            sleep 5
          done
          DATABASE_URL=postgresql://user:password@localhost:5432/anynote \
            pnpm --filter @repo/db exec prisma migrate deploy

      - name: Boot full stack
        env:
          ANYNOTE_VERSION: ${{ steps.version.outputs.version }}
        run: docker compose -f compose.yml -f compose.ci.yml up -d --wait --wait-timeout 180

      - name: Show container status
        if: always()
        run: docker compose -f compose.yml -f compose.ci.yml ps

      - name: Show logs on failure
        if: failure()
        run: docker compose -f compose.yml -f compose.ci.yml logs

      - name: Tear down
        if: always()
        run: docker compose -f compose.yml -f compose.ci.yml down -v

  deploy:
    needs: verify
    runs-on: ubuntu-latest
    environment: production
    steps:
      - run: echo 'deploy'
```

- [ ] **Step 5.4.2: Lint with `actionlint`**

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color .github/workflows/deploy.yml
```

Expected: no errors.

- [ ] **Step 5.4.3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add deploy workflow (build 4 images, verify, mock deploy on tag)"
```

---

## Phase 6 — Final verification

### Task 6.1: Run `actionlint` and `pnpm gates` once more across the full repo

- [ ] **Step 6.1.1: Lint all workflows**

```bash
docker run --rm -v "$(pwd):/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: no errors across `.github/workflows/*.yml` and `.github/actions/setup/action.yml`.

- [ ] **Step 6.1.2: Run the merge gate locally**

```bash
pnpm gates
```

Expected: `check-types`, `lint`, `build`, and `test` all pass. (This is the same set CI will run.)

- [ ] **Step 6.1.3: Build all Docker images locally one more time and run compose verify**

```bash
docker build -t ghcr.io/anynoteinc/anynote-web:dev      -f apps/web/Dockerfile      .
docker build -t ghcr.io/anynoteinc/anynote-yjs:dev      -f apps/yjs/Dockerfile      .
docker build -t ghcr.io/anynoteinc/anynote-engines:dev  -f apps/engines/Dockerfile  .
docker build -t ghcr.io/anynoteinc/anynote-agents:dev   -f apps/agents/Dockerfile   .

# Apply schema before booting overlay (overlay services depend on postgres being migrated)
docker compose up -d postgres
sleep 10
DATABASE_URL=postgresql://user:password@localhost:5432/anynote \
  pnpm --filter @repo/db exec prisma migrate deploy

ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml up -d --wait --wait-timeout 180
ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml ps
```

Expected: all four service rows show `Status: Up (healthy)`.

- [ ] **Step 6.1.4: Tear down**

```bash
ANYNOTE_VERSION=dev docker compose -f compose.yml -f compose.ci.yml down -v
```

- [ ] **Step 6.1.5: Final commit (only if anything was modified during verification)**

If verification triggered any tweaks (e.g. adjusted healthcheck timing), commit them now:

```bash
git status
# If clean, no commit needed.
# Otherwise:
git add <files>
git commit -m "ci: address verification findings"
```

---

## Out-of-band activation steps (post-merge, manual)

After merging this PR, the repo owner must do **once**:

1. Push the repo to `git@github.com:AnyNoteInc/AnyNote.git` (this is the new default remote for the spec).
2. In GitHub repo settings → Actions → General → Workflow permissions, choose **"Read and write permissions"** so `release.yml` can push the version commit and tag.
3. In GitHub repo settings → Environments, create the `production` environment. Optionally add required reviewers (`deploy.yml`'s `deploy` job will block on this).
4. In GitHub repo settings → Branches, protect `main`:
   - Require PRs (block direct pushes)
   - Require the `lint-and-test` check from `ci.yml` to pass
   - Allow auto-merge if desired

These cannot be configured from YAML.

---

## Summary

| Phase | Tasks | Outcome |
|---|---|---|
| 1 | 1.1 | `/api/health` route added with vitest test |
| 2 | 2.1 – 2.4 | All four Dockerfiles uniform, Node 26, `turbo prune` pattern |
| 3 | 3.1 | `compose.ci.yml` overlay with healthchecks |
| 4 | 4.1 – 4.2 | semantic-release configured |
| 5 | 5.1 – 5.4 | Composite action + 3 workflows |
| 6 | 6.1 | Repo-wide verification |

11 commits total. Each commit is independent and reversible.
