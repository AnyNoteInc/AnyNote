# CI/CD Pipeline Design

**Date:** 2026-05-02
**Status:** Draft for review
**Repository:** `git@github.com:AnyNoteInc/AnyNote.git`

## Goal

Establish a GitHub Actions-based CI/CD pipeline for the AnyNote monorepo that:

1. Validates pull requests against `main` (lint + tests).
2. Cuts versioned releases on merge to `main` via [`semantic-release`](https://semantic-release.gitbook.io/).
3. Builds and publishes Docker images for all four runtime services to GitHub Container Registry (GHCR) on tag push.
4. Verifies the published images boot and pass healthchecks before invoking a (currently mocked) deploy step.

## Scope

### In scope

- Three GitHub Actions workflows: `ci.yml`, `release.yml`, `deploy.yml`.
- One shared composite action: `.github/actions/setup`.
- `semantic-release` configuration at the repo root (`.releaserc.json`).
- Production-shape `compose.ci.yml` overlay for the verify-boot step.
- Missing `apps/yjs/Dockerfile` (created).
- Refactor of `apps/engines/Dockerfile` and `apps/agents/Dockerfile` to use the `turbo prune --docker` multi-stage pattern (uniformity).
- Minimal `/api/health` route in `apps/web`.
- Bump Node 22 → Node 24 across Dockerfiles and the composite action.

### Out of scope

- A real deploy implementation (the `deploy` job is `echo 'deploy'` per spec).
- Playwright E2E in CI (deferred — too heavy; integration via vitest/jest/pytest covers the regression surface).
- Turbo remote caching.
- GitHub branch protection rule configuration (set in repo settings, not in YAML).
- Production secrets management (CI uses placeholder values for the verify boot only).
- Backfill / migration jobs in deploy.

## Architecture

```
┌──────────────────────┐          ┌────────────────────────┐
│ PR opened/updated    │ ───▶     │ ci.yml                 │
│ (target = main)      │          │  job: lint-and-test    │
└──────────────────────┘          │   + service containers │
                                  └────────────────────────┘

┌──────────────────────┐          ┌────────────────────────┐
│ push to main         │ ───▶     │ release.yml            │
│ (commit merged)      │          │  job: lint-and-test    │
└──────────────────────┘          │  job: release          │
                                  │   └─ semantic-release  │
                                  │      pushes tag vX.Y.Z │
                                  └────────────────────────┘
                                              │
                                              ▼
┌──────────────────────┐          ┌────────────────────────┐
│ tag push (v*)        │ ───▶     │ deploy.yml             │
│                      │          │  job: build (matrix×4) │
└──────────────────────┘          │   └─ push to GHCR      │
                                  │  job: verify           │
                                  │   └─ compose --wait    │
                                  │  job: deploy           │
                                  │   └─ echo 'deploy'     │
                                  └────────────────────────┘
```

## Components

### 1. `.github/actions/setup/action.yml` — composite setup

Shared by `ci.yml` and `release.yml`. Encapsulates the multi-language toolchain bootstrap so changes (e.g. Node version bump) happen in one place.

```yaml
name: Setup
description: Install pnpm, Node, Python, uv, deps, and generate Prisma client
runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4
      with:
        version: 9
    - uses: actions/setup-node@v4
      with:
        node-version: '24'
        cache: 'pnpm'
    - uses: actions/setup-python@v5
      with:
        python-version: '3.13'
    - uses: astral-sh/setup-uv@v4
      with:
        version: '0.5.x'
    - run: pnpm install --frozen-lockfile
      shell: bash
    - run: pnpm --filter @repo/db prisma:generate
      shell: bash
    - run: uv sync --frozen
      shell: bash
      working-directory: apps/agents
```

**Dependencies:** `pnpm/action-setup`, `actions/setup-node`, `actions/setup-python`, `astral-sh/setup-uv`.

### 2. `.github/workflows/ci.yml` — PR pipeline

**Trigger:** `pull_request` targeting `main`.
**Concurrency:** `ci-${{ github.head_ref }}` with `cancel-in-progress: true` (cancel superseded runs on the same PR).

**Job: `lint-and-test`** (`ubuntu-latest`)

Service containers (matching `compose.yml` for fidelity with local dev):

| Service | Image | Purpose |
|---|---|---|
| postgres | `postgres:16-alpine` | Prisma migrate + tests |
| minio | `minio/minio` | `@repo/storage` integration tests |
| qdrant | `qdrant/qdrant:v1.12.4` | agents vectorization unit tests |
| mailhog | `mailhog/mailhog:latest` | mail outbox tests |

**Steps:**

1. `actions/checkout@v4`
2. `./.github/actions/setup` (composite)
3. Initialize the `agents` database — execute `docker/postgres-init/01-create-agents-db.sh` against the postgres service container (matches local dev). The script is `psql`-driven and idempotent.
4. `pnpm --filter @repo/db exec prisma migrate deploy`
5. `pnpm --filter @repo/db exec prisma db seed`
6. `pnpm check-types`
7. `pnpm lint`
8. `pnpm test`

**No Ollama service container.** Agent tests requiring Ollama are tagged `@pytest.mark.integration` and excluded by `pnpm --filter agents test`. Confirmed against `apps/agents/pyproject.toml`.

**Env block:** mirrors `turbo.json` `globalEnv` with CI-safe values (e.g. `BETTER_AUTH_SECRET=ci-secret-not-real`, `DATABASE_URL=postgres://user:password@localhost:5432/anynote`).

### 3. `.github/workflows/release.yml` — merge → semantic-release

**Trigger:** `push` to `main`.
**Concurrency:** `release` group, `cancel-in-progress: false` (never cancel an in-flight release).

**Job: `lint-and-test`** — identical structure to `ci.yml`'s job. Re-run on `main` to protect against merge skew (two PRs that pass independently but conflict together).

**Job: `release`** (depends on `lint-and-test`)

```yaml
permissions:
  contents: write
  issues: write
  pull-requests: write
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0
      persist-credentials: true
  - uses: ./.github/actions/setup
  - run: pnpm exec semantic-release
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### 4. `.releaserc.json` — semantic-release config

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

**Decisions:**

- **Angular preset (default)** for `commit-analyzer`: `fix:` → patch, `feat:` → minor, `BREAKING CHANGE:`/`!` → major. Other types do not release. Aligns with the repo's existing Conventional Commits convention.
- **No `@semantic-release/npm`** — root `package.json` is `private: true`; nothing to publish to npm.
- **`[skip ci]` in the release commit** — prevents `release.yml` from re-triggering on the version bump commit. The tag push remains a separate event and still triggers `deploy.yml`.
- **`GITHUB_TOKEN` is sufficient** for tag push and GitHub release creation. If the org later restricts Action-triggered Actions, switch to a fine-grained PAT (`secrets.RELEASE_PAT`).

`devDependencies` to add at the root `package.json`:

- `semantic-release`
- `@semantic-release/changelog`
- `@semantic-release/git`
- (others come transitively or are in the default plugin set)

### 5. `.github/workflows/deploy.yml` — tag → build → verify → deploy mock

**Trigger:** `push` of tags matching `v*`.
**Concurrency:** `deploy-${{ github.ref }}`, `cancel-in-progress: false`.

**Env (workflow-level):**

```yaml
env:
  REGISTRY: ghcr.io
  IMAGE_NAMESPACE: ${{ github.repository_owner }}/anynote
```

#### Job: `build` (matrix)

```yaml
strategy:
  fail-fast: false
  matrix:
    service: [web, yjs, agents, engines]
permissions:
  contents: read
  packages: write
```

**Steps per matrix entry:**

1. `actions/checkout@v4`
2. `docker/setup-buildx-action@v3`
3. `docker/login-action@v3` (registry: `ghcr.io`, password: `${{ secrets.GITHUB_TOKEN }}`)
4. `docker/metadata-action@v5` — emits tags for the image:
   - `type=semver,pattern={{version}}` → `1.4.2`
   - `type=raw,value=latest` → `latest`
5. `docker/build-push-action@v6` — builds with:
   - `context: .` (full repo, required for `turbo prune`)
   - `file: ./apps/${{ matrix.service }}/Dockerfile`
   - `cache-from: type=gha,scope=${{ matrix.service }}`
   - `cache-to: type=gha,mode=max,scope=${{ matrix.service }}`
   - `push: true`
   - tags from metadata-action

**Image naming:** `ghcr.io/anynoteinc/anynote-<service>` — single namespace, hyphenated service.

#### Job: `verify` (depends on `build`)

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: docker/login-action@v3
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
  - id: version
    run: echo "version=${GITHUB_REF_NAME#v}" >> $GITHUB_OUTPUT
  - env:
      ANYNOTE_VERSION: ${{ steps.version.outputs.version }}
    run: docker compose -f compose.yml -f compose.ci.yml up -d --wait --wait-timeout 120
  - if: always()
    run: docker compose -f compose.yml -f compose.ci.yml ps
  - if: failure()
    run: docker compose -f compose.yml -f compose.ci.yml logs
```

**Why `compose.ci.yml` overlay?** Reuses the existing `compose.yml` infra (postgres/minio/qdrant/ollama/mailhog) and adds the four built service images on top. Keeps two files focused: `compose.yml` is local dev, `compose.ci.yml` is the production-shape overlay used only by CI.

`docker compose --wait` exits non-zero if any service does not reach `healthy` within the timeout. That is the verification gate.

#### Job: `deploy` (depends on `verify`)

```yaml
environment: production
steps:
  - run: echo 'deploy'
```

`environment: production` hooks GitHub's environment protection rules (required reviewers, deployment branches, etc.). When the real deploy lands later, the wiring is already in place.

### 6. `compose.ci.yml` — production-shape overlay

A new file at the repo root. Defines four services (`web`, `yjs`, `agents`, `engines`) that pull from GHCR using `${ANYNOTE_VERSION}`.

**Healthchecks:**

| Service | Probe | Justification |
|---|---|---|
| web | `wget -qO- http://localhost:3000/api/health` | New `/api/health` route added to `apps/web` |
| yjs | `nc -z localhost 1234` | Hocuspocus has no HTTP endpoint; TCP probe is sufficient |
| agents | `curl -f http://localhost:8080/health` | Existing `fast_clean.contrib.healthcheck.router` (mounted at `/health`) |
| engines | `wget -qO- http://localhost:8082/health` | Existing `HealthController` (`apps/engines/src/health/`) |

**`depends_on` with `condition: service_healthy`** ensures app containers wait for postgres before starting. `agents` also waits for `qdrant: service_started` (qdrant has no built-in healthcheck endpoint by default).

**Env vars:** mirror `turbo.json` `globalEnv` with CI-safe placeholder values. The verify job is "does it boot and respond healthy", not "does it serve real traffic".

**`start_period: 60s` for agents** — accounts for spaCy model load and uv runtime initialization (heaviest startup of the four).

### 7. New file: `apps/yjs/Dockerfile`

Multi-stage `turbo prune --docker` build, modeled on `apps/web/Dockerfile`. Outline:

```dockerfile
FROM node:24-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS prepare
RUN pnpm add turbo --global
COPY . .
RUN turbo prune yjs --docker

FROM base AS builder
COPY --from=prepare /app/out/json/ .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/db prisma generate
COPY --from=prepare /app/out/full/ .
RUN pnpm turbo build --filter=yjs

FROM base AS runner
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodejs
USER nodejs
COPY --from=builder --chown=nodejs:nodejs /app/apps/yjs/dist ./apps/yjs/dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/yjs/node_modules ./apps/yjs/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/packages ./packages
WORKDIR /app/apps/yjs
EXPOSE 1234
CMD ["node", "dist/index.js"]
```

**Note:** `apps/yjs/package.json` `start` script reads `--env-file=../../.env` — in container, env comes from compose, so the CMD bypasses the start script directly.

### 8. Refactored: `apps/engines/Dockerfile` and `apps/agents/Dockerfile`

Both refactored to follow the same `turbo prune --docker` multi-stage pattern (uniform across all four services per user request).

- **`engines`** — straightforward port from manual copy to `turbo prune engines --docker`. Removes ~10 lines of manual COPY plumbing.
- **`agents`** — uses `turbo prune agents --docker` to pull the agents subworkspace into the build context. Inside the runner stage, still uses `uv sync --frozen --no-dev` against `apps/agents/pyproject.toml` and `uv.lock` and runs `python -m spacy download` for the two language models. The Python build does not benefit from turbo prune the way TS does (turbo doesn't manage Python deps), but using the same pattern keeps the Dockerfile shape uniform.

### 9. New file: `apps/web/src/app/api/health/route.ts`

```ts
export const runtime = 'nodejs'

export async function GET() {
  return Response.json({ status: 'ok' })
}
```

`runtime = 'nodejs'` matches the convention used by every other route handler under `apps/web/src/app/api/`. Route handlers are not statically prerendered, so no `dynamic` directive is needed.

## Data flow

The pipeline does not move application data; it moves CI artifacts:

1. **Tests run** against ephemeral service containers; data is discarded after the job.
2. **Built Docker images** are pushed to `ghcr.io/anynoteinc/anynote-<service>:<version>` with `latest` floating tag.
3. **Verify** boots the four images alongside infra service containers in a single `docker compose` network; healthchecks confirm boot.
4. **Deploy** is a no-op `echo 'deploy'` placeholder.

## Error handling

| Failure mode | Behavior |
|---|---|
| Lint or typecheck fails on PR | `ci.yml` fails red; merge blocked by branch protection |
| Test fails on PR | `ci.yml` fails red; same as above |
| Lint/test fails on merge to main | `release.yml` fails red; no tag is cut. Fix forward via a follow-up PR |
| `semantic-release` finds no releasable commits | Job exits 0; no tag pushed; `deploy.yml` does not fire. Expected for `chore:`-only merges |
| Single matrix image build fails | Other 3 still build (`fail-fast: false`); `verify` job does not run (depends on full `build` success); release artifacts incomplete |
| `verify` boot times out | `deploy.yml` fails red; logs printed via `if: failure()`. Deploy mock does not run |
| `deploy` mock | Always succeeds (`echo 'deploy'`) when reached |

## Testing strategy

This change is itself the testing strategy for the rest of the codebase. Verifying the pipeline works:

1. **PR: dry-run on a draft branch** — open a no-op PR, watch `ci.yml` run green.
2. **Release: merge a `feat:` commit** — verify `release.yml` runs, semantic-release publishes a tag, and `deploy.yml` fires from the tag.
3. **Image verification** — confirm GHCR shows four images at the new version, and the verify job logs show all four healthy.

No automated tests of the workflow YAML itself (`act` and similar are heavy). Manual verification is sufficient for first deploy.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `uv sync` slow on cold cache (~2–3 min) | pnpm/uv lockfile caching via `actions/cache`; subsequent runs warm |
| spaCy model downloads bloat agents image (~1.2 GB) | Accepted; cached at the Docker layer level after first build |
| Token-pushed tags may not trigger `deploy.yml` if org tightens Action-on-Action policy | Document fallback: switch to `secrets.RELEASE_PAT` (fine-grained PAT) |
| `compose.ci.yml` env drift when `turbo.json` globalEnv changes | Pre-existing CLAUDE.md guidance already calls out env-var-add discipline; document in this design too |
| `agents` DB requires `postgres-init` | CI gets fresh volume each run, so SQL reruns; no special handling needed |
| Node 24 is Active LTS, supported through Apr 2027 (maintenance Apr 2027 onward) | No action — pin to a major version like `node:24-alpine` and reassess at LTS end-of-life |
| Existing engines & agents Dockerfile refactor introduces regression | Verify job catches boot regressions; image size diff watched manually |

## Files added / changed

**Added (9 files):**

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.github/workflows/deploy.yml`
- `.github/actions/setup/action.yml`
- `.releaserc.json`
- `compose.ci.yml`
- `apps/yjs/Dockerfile`
- `apps/web/src/app/api/health/route.ts`
- `docs/superpowers/specs/2026-05-02-cicd-pipeline-design.md` (this file)

**Changed (4 files):**

- `apps/web/Dockerfile` — bump base image `node:22-alpine` → `node:24-alpine`
- `apps/engines/Dockerfile` — refactor to `turbo prune --docker` pattern; bump Node 22 → 24
- `apps/agents/Dockerfile` — refactor to `turbo prune --docker` pattern (Python core unchanged)
- `package.json` — add `semantic-release` + `@semantic-release/changelog` + `@semantic-release/git` to `devDependencies`

## Open questions

None at design time. Implementation may surface tactical issues (e.g. exact env var names for `compose.ci.yml`, healthcheck timing tuning) — to be resolved during implementation.

## References

- Existing project conventions: `CLAUDE.md`, `AGENTS.md`
- Service infra: `compose.yml`
- Build orchestration: `turbo.json`
- Existing Dockerfiles: `apps/web/Dockerfile`, `apps/engines/Dockerfile`, `apps/agents/Dockerfile`
- semantic-release docs: https://semantic-release.gitbook.io/
- Docker Action docs: https://github.com/docker/build-push-action
