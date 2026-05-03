# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `https://anynote.ru` production deployment via `deploy/compose.yml` + Traefik + GitHub Actions deploy job that renders `.env` from secrets and runs `docker compose up -d` on the server.

**Architecture:** Single-host Docker Compose stack, Traefik fronts all public traffic with Let's Encrypt TLS, GHCR-hosted images for `web/yjs/engines/agents`, one-shot `migrate` service applies Prisma migrations + seed by reusing the `web` image with Prisma CLI bundled in.

**Tech Stack:** Docker Compose v2, Traefik v3.5, Let's Encrypt (HTTP-01), GitHub Actions, rsync over SSH, envsubst for `.env` rendering, Prisma 7, Postgres 16, MinIO, Qdrant.

**Spec:** `docs/superpowers/specs/2026-05-03-production-deployment-design.md`

---

## File Map

**New files:**
- `deploy/compose.yml` — production compose with all services
- `deploy/.env.template` — envsubst input
- `deploy/.env.example` — documentation companion
- `deploy/traefik/traefik.yml` — static traefik config
- `deploy/traefik/dynamic/middlewares.yml` — rate limit / inflight / headers / strip / redirects / basic-auth
- `deploy/postgres-init/01-create-agents-db.sql` — creates `anynote_agents` DB
- `docker/postgres-init/01-create-agents-db.sql` — same script mirrored into dev compose's mounted init dir

**Modified files:**
- `apps/web/Dockerfile` — runner stage adds Prisma CLI + `packages/db/` (schema + migrations + seed) for the one-shot `migrate` compose service
- `.github/workflows/deploy.yml` — replace `echo 'deploy'` with the real deploy job (env render, rsync, compose up)

---

## Operator Prerequisites (NOT in plan, document only)

These steps are out of scope for the code plan but **must be done by an operator before the first deploy succeeds**. List them in the project handover notes:

1. Provision a Linux server with Docker + Docker Compose v2 installed.
2. Open ports 22 (SSH), 80, 443 in the host firewall.
3. Create a deploy user (matching `DEPLOY_USER` secret) with passwordless `docker` group membership.
4. Add the public key matching `DEPLOY_KEY_PRIVATE` to `~/.ssh/authorized_keys` for that user.
5. Create DNS A-records: `anynote.ru`, `www.anynote.ru`, `traefik.anynote.ru` → server IP.
6. Confirm `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` GitHub secrets match the server.

---

## Task 1: Create the `deploy/` directory tree

**Files:**
- Create: `deploy/postgres-init/01-create-agents-db.sql`
- Create: `docker/postgres-init/01-create-agents-db.sql`

The existing dev compose at `/Users/victor/Projects/anynote/compose.yml` already mounts `./docker/postgres-init:/docker-entrypoint-initdb.d:ro` (line 17 of the original file before the Ollama removal). Currently `docker/postgres-init/` is empty. We need a script that creates `anynote_agents` only if not present, and grants the same `anynote` user access. The script must be re-runnable (Postgres init scripts run only on a fresh data dir, but rsync doesn't care).

- [ ] **Step 1: Create the agents DB init script**

Write file `deploy/postgres-init/01-create-agents-db.sql`:

```sql
-- Idempotently create the anynote_agents database for apps/agents.
-- Postgres has no native CREATE DATABASE IF NOT EXISTS, so we use \gexec.
SELECT 'CREATE DATABASE anynote_agents OWNER anynote'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'anynote_agents')\gexec
```

- [ ] **Step 2: Mirror the script into the dev tree**

```bash
mkdir -p docker/postgres-init
cp deploy/postgres-init/01-create-agents-db.sql docker/postgres-init/01-create-agents-db.sql
```

- [ ] **Step 3: Verify both files exist**

```bash
ls -la deploy/postgres-init/ docker/postgres-init/
```

Expected: both directories contain `01-create-agents-db.sql`, identical contents. Run `diff deploy/postgres-init/01-create-agents-db.sql docker/postgres-init/01-create-agents-db.sql` — expected: no output.

- [ ] **Step 4: Commit**

```bash
git add deploy/postgres-init docker/postgres-init
git commit -m "feat(deploy): add postgres init script creating anynote_agents DB"
```

---

## Task 2: Write `deploy/.env.template`

**Files:**
- Create: `deploy/.env.template`

This file is the source of truth for the `.env` rendered by the deploy job via `envsubst`. It contains every variable any container reads, with `${VAR}` placeholders for values that come from GH secrets.

- [ ] **Step 1: Write the template**

Write file `deploy/.env.template`:

```bash
# === Public URLs ===
NEXT_PUBLIC_BASE_URL=${NEXT_PUBLIC_BASE_URL}
BETTER_AUTH_URL=${BETTER_AUTH_URL}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
BETTER_AUTH_JWT_AUDIENCE=${BETTER_AUTH_JWT_AUDIENCE}
NEXT_PUBLIC_YJS_URL=${NEXT_PUBLIC_YJS_URL}
YJS_PORT=1234

# === Database (Prisma — web/engines/yjs) ===
DATABASE_URL=${DATABASE_URL}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}

# === Database (agents — fast_clean nested settings) ===
DB__HOST=postgres
DB__PORT=5432
DB__USER=anynote
DB__PASSWORD=${DB__PASSWORD}
DB__NAME=anynote_agents

# === S3 / MinIO ===
S3_ENDPOINT=${S3_ENDPOINT}
S3_REGION=${S3_REGION}
S3_ACCESS_KEY=${S3_ACCESS_KEY}
S3_SECRET_KEY=${S3_SECRET_KEY}
S3_BUCKET=${S3_BUCKET}
S3_FORCE_PATH_STYLE=${S3_FORCE_PATH_STYLE}

# === Qdrant ===
QDRANT__HOST=${QDRANT__HOST}
QDRANT__AUTH__TYPE=${QDRANT__AUTH__TYPE}
QDRANT__AUTH__BEARER_TOKEN=${QDRANT__AUTH__BEARER_TOKEN}
QDRANT__COLLECTION_NAME=${QDRANT__COLLECTION_NAME}

# === Inter-service ===
AGENTS_SERVICE_URL=${AGENTS_SERVICE_URL}
AGENTS_SERVICE_TOKEN=${AGENTS_SERVICE_TOKEN}
ENGINES_SERVICE_URL=${ENGINES_URL}:${ENGINES_PORT}
ENGINES_MCP_URL=${ENGINES_URL}:${ENGINES_PORT}/mcp
ENGINES_MCP_TOKEN=${ENGINES_MCP_TOKEN}
ANYNOTE_MCP_URL=${ENGINES_URL}:${ENGINES_PORT}/mcp
ENGINES_PORT=${ENGINES_PORT}

# === Agents service settings (fast_clean) ===
ENVIRONMENT=production
DEBUG=false
TITLE=AI Agents
SECRET_KEY=${AGENTS_SECRET_KEY}
BASE_URL=${NEXT_PUBLIC_BASE_URL}
CORS_ORIGINS=["https://anynote.ru","https://www.anynote.ru"]
AGENTS_LOG_LEVEL=INFO

# === Mail ===
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}
MAIL_FROM=${MAIL_FROM}
MAIL_DISPATCH_CRON_EXPRESSION=*/30 * * * * *
MAIL_DISPATCH_BATCH=20
MAIL_DISPATCH_MAX_ATTEMPTS=5

# === Indexer cron ===
INDEXER_CRON_EXPRESSION=0 */5 * * * *
INDEXER_MAX_ATTEMPTS=5
INDEXER_BATCH=10
UPLOAD_INLINE_MAX_BYTES=1048576

# === OAuth providers ===
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}

# === reCAPTCHA v3 ===
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=${NEXT_PUBLIC_RECAPTCHA_SITE_KEY}
RECAPTCHA_SECRET_KEY=${RECAPTCHA_SECRET_KEY}

# === Billing (YooKassa) ===
YOOKASSA_SHOP_ID=${YOOKASSA_SHOP_ID}
YOOKASSA_SECRET_KEY=${YOOKASSA_SECRET_KEY}
YOOKASSA_RETURN_URL_BASE=${NEXT_PUBLIC_BASE_URL}
BILLING_RENEWAL_CRON_EXPRESSION=0 0 0 * * *
BILLING_RENEWAL_BATCH_SIZE=50

# === Traefik (compose interpolation only — not passed to app containers) ===
ACME_EMAIL=${ACME_EMAIL}
TRAEFIK_DASHBOARD_USERS_LINE=${TRAEFIK_DASHBOARD_USERS_LINE}
```

- [ ] **Step 2: Verify template renders without errors**

```bash
# Use a fake env to test envsubst expands every ${VAR}
cd /Users/victor/Projects/anynote
env -i \
  NEXT_PUBLIC_BASE_URL=x BETTER_AUTH_URL=x BETTER_AUTH_SECRET=x BETTER_AUTH_JWT_AUDIENCE=x \
  NEXT_PUBLIC_YJS_URL=x DATABASE_URL=x POSTGRES_PASSWORD=x DB__PASSWORD=x \
  S3_ENDPOINT=x S3_REGION=x S3_ACCESS_KEY=x S3_SECRET_KEY=x S3_BUCKET=x S3_FORCE_PATH_STYLE=x \
  QDRANT__HOST=x QDRANT__AUTH__TYPE=x QDRANT__AUTH__BEARER_TOKEN=x QDRANT__COLLECTION_NAME=x \
  AGENTS_SERVICE_URL=x AGENTS_SERVICE_TOKEN=x AGENTS_SECRET_KEY=x \
  ENGINES_URL=x ENGINES_PORT=x ENGINES_MCP_TOKEN=x \
  SMTP_HOST=x SMTP_PORT=x SMTP_SECURE=x SMTP_USER=x SMTP_PASSWORD=x MAIL_FROM=x \
  GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x \
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY=x RECAPTCHA_SECRET_KEY=x \
  YOOKASSA_SHOP_ID=x YOOKASSA_SECRET_KEY=x \
  ACME_EMAIL=x TRAEFIK_DASHBOARD_USERS_LINE=x \
  envsubst < deploy/.env.template | grep -E '\$\{' && echo "FAIL: unsubstituted vars found" || echo "OK: all vars substituted"
```

Expected output: `OK: all vars substituted`. If any `${...}` remains in the rendered output, that's a missing secret name — fix the template.

- [ ] **Step 3: Commit**

```bash
git add deploy/.env.template
git commit -m "feat(deploy): add envsubst-rendered .env template"
```

---

## Task 3: Write `deploy/.env.example`

**Files:**
- Create: `deploy/.env.example`

Documentation companion. Same keys as `.env.template` but with placeholder values + inline comments. An operator should be able to read this and understand what every variable is for without reading the deploy workflow.

- [ ] **Step 1: Write the example file**

Write file `deploy/.env.example`:

```bash
# Production .env example.
# This file is for documentation only — at deploy time the .env on the
# server is rendered from deploy/.env.template by envsubst with values
# pulled from GitHub repository secrets.
#
# To regenerate the production secrets manually:
#   openssl rand -hex 32           # for *_SECRET, *_TOKEN, POSTGRES_PASSWORD
#   htpasswd -nbB <user> <pass>    # for TRAEFIK_DASHBOARD_USERS_LINE

# === Public URLs ===
NEXT_PUBLIC_BASE_URL=https://anynote.ru
BETTER_AUTH_URL=https://anynote.ru
BETTER_AUTH_SECRET=replace-with-32+-char-random
BETTER_AUTH_JWT_AUDIENCE=anynote-yjs
NEXT_PUBLIC_YJS_URL=wss://anynote.ru/ws
YJS_PORT=1234

# === Database (Prisma — web/engines/yjs) ===
DATABASE_URL=postgresql://anynote:CHANGE_ME@postgres:5432/anynote
POSTGRES_PASSWORD=CHANGE_ME

# === Database (agents — fast_clean nested settings) ===
DB__HOST=postgres
DB__PORT=5432
DB__USER=anynote
DB__PASSWORD=CHANGE_ME    # same value as POSTGRES_PASSWORD
DB__NAME=anynote_agents

# === S3 / MinIO ===
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_ACCESS_KEY=admin
S3_SECRET_KEY=CHANGE_ME
S3_BUCKET=storage
S3_FORCE_PATH_STYLE=true

# === Qdrant ===
QDRANT__HOST=http://qdrant:6333
QDRANT__AUTH__TYPE=bearer_token
QDRANT__AUTH__BEARER_TOKEN=CHANGE_ME
QDRANT__COLLECTION_NAME=pages

# === Inter-service ===
AGENTS_SERVICE_URL=http://agents:8080
AGENTS_SERVICE_TOKEN=CHANGE_ME
ENGINES_SERVICE_URL=http://engines:8082
ENGINES_MCP_URL=http://engines:8082/mcp
ENGINES_MCP_TOKEN=CHANGE_ME
ANYNOTE_MCP_URL=http://engines:8082/mcp
ENGINES_PORT=8082

# === Agents service settings (fast_clean) ===
ENVIRONMENT=production
DEBUG=false
TITLE=AI Agents
SECRET_KEY=CHANGE_ME
BASE_URL=https://anynote.ru
CORS_ORIGINS=["https://anynote.ru","https://www.anynote.ru"]
AGENTS_LOG_LEVEL=INFO

# === Mail ===
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=true
SMTP_USER=mailer@anynote.ru
SMTP_PASSWORD=CHANGE_ME
MAIL_FROM=AnyNote <noreply@anynote.ru>
MAIL_DISPATCH_CRON_EXPRESSION=*/30 * * * * *
MAIL_DISPATCH_BATCH=20
MAIL_DISPATCH_MAX_ATTEMPTS=5

# === Indexer cron ===
INDEXER_CRON_EXPRESSION=0 */5 * * * *
INDEXER_MAX_ATTEMPTS=5
INDEXER_BATCH=10
UPLOAD_INLINE_MAX_BYTES=1048576

# === OAuth providers ===
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# === reCAPTCHA v3 ===
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=

# === Billing (YooKassa) ===
YOOKASSA_SHOP_ID=
YOOKASSA_SECRET_KEY=
YOOKASSA_RETURN_URL_BASE=https://anynote.ru
BILLING_RENEWAL_CRON_EXPRESSION=0 0 0 * * *
BILLING_RENEWAL_BATCH_SIZE=50

# === Traefik (used by compose interpolation only — never passed to app containers) ===
ACME_EMAIL=admin@anynote.ru
TRAEFIK_DASHBOARD_USERS_LINE=admin:$2y$05$REPLACE_WITH_BCRYPT_HASH
```

- [ ] **Step 2: Commit**

```bash
git add deploy/.env.example
git commit -m "docs(deploy): add .env.example for production secrets"
```

---

## Task 4: Write `deploy/traefik/traefik.yml` (static config)

**Files:**
- Create: `deploy/traefik/traefik.yml`

Traefik static config: entrypoints (80 + 443), Docker provider (auto-discovery via labels), file provider (middlewares), Let's Encrypt resolver via HTTP-01.

- [ ] **Step 1: Write the static config**

Write file `deploy/traefik/traefik.yml`:

```yaml
# Static Traefik config. Loaded once at startup.
# Dynamic config (middlewares, basic-auth users) lives in dynamic/ and is
# hot-reloaded by Traefik on file change.

api:
  dashboard: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

providers:
  docker:
    exposedByDefault: false
    network: anynote_default
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  le:
    acme:
      email: ${ACME_EMAIL}
      storage: /letsencrypt/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO
accessLog: {}
```

`network: anynote_default` is the default network created by `docker compose` when `compose.yml` is in directory `anynote/`. Compose names the default network `<dir>_default`. On the server we deploy into `/opt/anynote/`, so the network is `anynote_default`. If the server uses a different directory, override with `--project-name anynote` in the deploy ssh command (already done in Task 8).

- [ ] **Step 2: Commit**

```bash
git add deploy/traefik/traefik.yml
git commit -m "feat(deploy): add traefik static config (entrypoints, ACME, providers)"
```

---

## Task 5: Write `deploy/traefik/dynamic/middlewares.yml`

**Files:**
- Create: `deploy/traefik/dynamic/middlewares.yml`

Dynamic config — Traefik watches the directory and reloads on change. Defines all middlewares referenced from compose labels.

- [ ] **Step 1: Write the middlewares**

Write file `deploy/traefik/dynamic/middlewares.yml`:

```yaml
# Dynamic Traefik config. Reloaded on change (watch: true in static config).
# Middlewares are referenced from docker compose labels by name@file.

http:
  middlewares:
    # Per-IP request rate limit for HTTP routers.
    ratelimit:
      rateLimit:
        average: 100
        burst: 200
        period: 1s
        sourceCriterion:
          ipStrategy:
            depth: 1

    # Lower limit for WebSocket — we throttle the *opens*, not in-flight frames.
    ratelimit-ws:
      rateLimit:
        average: 20
        burst: 40
        period: 1s
        sourceCriterion:
          ipStrategy:
            depth: 1

    # Cap concurrent in-flight requests per source IP. Basic anti-DDoS.
    inflight:
      inFlightReq:
        amount: 50
        sourceCriterion:
          ipStrategy:
            depth: 1

    # Security headers applied to all browser-facing responses.
    headers:
      headers:
        stsSeconds: 63072000
        stsIncludeSubdomains: true
        stsPreload: true
        contentTypeNosniff: true
        frameDeny: true
        referrerPolicy: strict-origin-when-cross-origin
        browserXssFilter: true

    compress:
      compress: {}

    # Strip /ws prefix so the request reaches the yjs container as / .
    strip-ws:
      stripPrefix:
        prefixes: ["/ws"]

    # Canonical URL — redirect www.anynote.ru → anynote.ru.
    www-redirect:
      redirectRegex:
        regex: "^https?://www\\.anynote\\.ru/(.*)"
        replacement: "https://anynote.ru/${1}"
        permanent: true

    # Basic-auth for the Traefik dashboard.
    # usersFile is materialised on the server during the deploy step from
    # the TRAEFIK_DASHBOARD_USERS_LINE secret (one "user:bcrypthash" line).
    dashboard-auth:
      basicAuth:
        usersFile: /etc/traefik/dynamic/dashboard-users
        removeHeader: true
```

- [ ] **Step 2: Verify YAML parses cleanly**

```bash
python3 -c "import yaml; yaml.safe_load(open('deploy/traefik/dynamic/middlewares.yml'))" && echo OK
```

Expected: `OK`. Any other output = malformed YAML; fix indentation.

- [ ] **Step 3: Commit**

```bash
git add deploy/traefik/dynamic/middlewares.yml
git commit -m "feat(deploy): add traefik middlewares (rate limit, headers, www redirect, basic auth)"
```

---

## Task 6: Write `deploy/compose.yml`

**Files:**
- Create: `deploy/compose.yml`

The full production compose file. Pulls 4 GHCR images (web/yjs/engines/agents) at `:latest`, plus stock images for postgres/minio/qdrant/traefik/minio-mc. Dependency order: postgres healthy → minio-init + migrate → web/yjs/engines/agents.

- [ ] **Step 1: Write the compose file**

Write file `deploy/compose.yml`:

```yaml
services:
  traefik:
    image: traefik:v3.5
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ./traefik/dynamic:/etc/traefik/dynamic:ro
      - traefik_acme:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      ACME_EMAIL: ${ACME_EMAIL}
    labels:
      - traefik.enable=true
      - traefik.http.routers.dashboard.rule=Host(`traefik.anynote.ru`)
      - traefik.http.routers.dashboard.entryPoints=websecure
      - traefik.http.routers.dashboard.tls.certResolver=le
      - traefik.http.routers.dashboard.service=api@internal
      - traefik.http.routers.dashboard.middlewares=dashboard-auth@file,ratelimit@file,headers@file

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: anynote
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: anynote
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U anynote -d anynote"]
      interval: 5s
      timeout: 5s
      retries: 10

  minio:
    image: minio/minio:latest
    restart: unless-stopped
    environment:
      MINIO_ROOT_USER: ${S3_ACCESS_KEY}
      MINIO_ROOT_PASSWORD: ${S3_SECRET_KEY}
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio-init:
    image: minio/mc
    depends_on:
      minio:
        condition: service_healthy
    entrypoint: >
      /bin/sh -c "
      mc alias set local http://minio:9000 ${S3_ACCESS_KEY} ${S3_SECRET_KEY} &&
      mc mb --ignore-existing local/${S3_BUCKET}
      "
    restart: "no"

  qdrant:
    image: qdrant/qdrant:v1.12.4
    restart: unless-stopped
    environment:
      QDRANT__SERVICE__API_KEY: ${QDRANT__AUTH__BEARER_TOKEN}
      QDRANT__TELEMETRY_DISABLED: "true"
    volumes:
      - qdrant_data:/qdrant/storage

  migrate:
    image: ghcr.io/anynoteinc/anynote-web:latest
    restart: "no"
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    working_dir: /app/packages/db
    command:
      - sh
      - -c
      - "../../node_modules/.bin/prisma migrate deploy && ../../node_modules/.bin/prisma db seed"

  web:
    image: ghcr.io/anynoteinc/anynote-web:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      migrate:
        condition: service_completed_successfully
      engines:
        condition: service_started
      agents:
        condition: service_started
    labels:
      - traefik.enable=true
      - traefik.http.routers.web.rule=Host(`anynote.ru`) || Host(`www.anynote.ru`)
      - traefik.http.routers.web.entryPoints=websecure
      - traefik.http.routers.web.tls.certResolver=le
      - traefik.http.routers.web.middlewares=www-redirect@file,ratelimit@file,inflight@file,headers@file,compress@file
      - traefik.http.services.web.loadBalancer.server.port=3000

  yjs:
    image: ghcr.io/anynoteinc/anynote-yjs:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      migrate:
        condition: service_completed_successfully
    labels:
      - traefik.enable=true
      - traefik.http.routers.yjs.rule=(Host(`anynote.ru`) || Host(`www.anynote.ru`)) && PathPrefix(`/ws`)
      - traefik.http.routers.yjs.entryPoints=websecure
      - traefik.http.routers.yjs.tls.certResolver=le
      - traefik.http.routers.yjs.middlewares=strip-ws@file,ratelimit-ws@file,inflight@file
      - traefik.http.services.yjs.loadBalancer.server.port=1234

  engines:
    image: ghcr.io/anynoteinc/anynote-engines:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      migrate:
        condition: service_completed_successfully
      qdrant:
        condition: service_started
      minio:
        condition: service_healthy

  agents:
    image: ghcr.io/anynoteinc/anynote-agents:latest
    restart: unless-stopped
    env_file: .env
    depends_on:
      migrate:
        condition: service_completed_successfully
      qdrant:
        condition: service_started

volumes:
  postgres_data:
  minio_data:
  qdrant_data:
  traefik_acme:
```

- [ ] **Step 2: Verify compose YAML parses**

```bash
cd deploy
# Render a fake .env so compose has all vars
env -i \
  NEXT_PUBLIC_BASE_URL=https://anynote.ru BETTER_AUTH_URL=x BETTER_AUTH_SECRET=x BETTER_AUTH_JWT_AUDIENCE=x \
  NEXT_PUBLIC_YJS_URL=x DATABASE_URL=x POSTGRES_PASSWORD=x DB__PASSWORD=x \
  S3_ENDPOINT=x S3_REGION=x S3_ACCESS_KEY=admin S3_SECRET_KEY=x S3_BUCKET=storage S3_FORCE_PATH_STYLE=x \
  QDRANT__HOST=x QDRANT__AUTH__TYPE=x QDRANT__AUTH__BEARER_TOKEN=x QDRANT__COLLECTION_NAME=x \
  AGENTS_SERVICE_URL=x AGENTS_SERVICE_TOKEN=x AGENTS_SECRET_KEY=x \
  ENGINES_URL=x ENGINES_PORT=x ENGINES_MCP_TOKEN=x \
  SMTP_HOST=x SMTP_PORT=x SMTP_SECURE=x SMTP_USER=x SMTP_PASSWORD=x MAIL_FROM=x \
  GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x \
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY=x RECAPTCHA_SECRET_KEY=x \
  YOOKASSA_SHOP_ID=x YOOKASSA_SECRET_KEY=x \
  ACME_EMAIL=admin@anynote.ru TRAEFIK_DASHBOARD_USERS_LINE=admin:x \
  envsubst < .env.template > .env.smoke
docker compose --env-file .env.smoke config > /dev/null && echo "OK: compose YAML is valid"
rm .env.smoke
cd ..
```

Expected: `OK: compose YAML is valid`. Any error from `docker compose config` indicates a YAML or interpolation problem; fix it.

- [ ] **Step 3: Commit**

```bash
git add deploy/compose.yml
git commit -m "feat(deploy): add production compose with traefik routing for web + yjs"
```

---

## Task 7: Modify `apps/web/Dockerfile` to bundle Prisma CLI for the migrate service

**Files:**
- Modify: `apps/web/Dockerfile` (runner stage, lines 50-58 area)

The runner stage of `apps/web/Dockerfile` currently produces a Next.js standalone bundle with no Prisma CLI. The `migrate` compose service reuses this image, so we need to add the Prisma binary, the `@prisma/client` engine, and the `packages/db/` directory (schema + migrations + seed.ts + prisma.config.ts + package.json).

- [ ] **Step 1: Read the existing Dockerfile to confirm line offsets**

```bash
sed -n '40,60p' apps/web/Dockerfile
```

The runner stage starts at line ~44 (`FROM base AS runner`). The COPY statements end before the `EXPOSE 3000` line. Add the new COPY block immediately after the existing public/static COPY lines and before `EXPOSE 3000`.

- [ ] **Step 2: Add Prisma CLI + packages/db to the runner stage**

Edit `apps/web/Dockerfile`. Find:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

EXPOSE 3000
```

Replace with:

```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

# Prisma CLI + schema/migrations/seed for the one-shot `migrate` compose
# service in deploy/compose.yml. The Next.js standalone runner doesn't
# include these by default. Adds ~30 MB to the image but lets the same
# image run migrations on deploy.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db

EXPOSE 3000
```

- [ ] **Step 3: Build the image locally to confirm Dockerfile is valid**

```bash
cd /Users/victor/Projects/anynote
docker build -f apps/web/Dockerfile -t anynote-web-test --progress=plain . 2>&1 | tail -30
```

Expected: build completes (last line resembles `naming to docker.io/library/anynote-web-test:latest done`). The build is slow (~5-10 min) because it does a full Next.js build. If it fails, the most likely cause is a missing source — check `pnpm --filter @repo/db prisma:generate` ran before the COPY (it does — the `RUN pnpm --filter @repo/db prisma:generate` line in the builder stage runs before the runner stage's COPY).

- [ ] **Step 4: Verify Prisma CLI is in the image**

```bash
docker run --rm --entrypoint sh anynote-web-test -c "ls -la node_modules/.bin/prisma packages/db/prisma/schema.prisma packages/db/prisma/migrations | head -5"
```

Expected: lists the binary, the schema file, and the migrations directory entries. If any are missing, the COPY paths are wrong — the COPY-from-builder paths are absolute (`/app/...`); double-check the source paths exist by `docker run --rm --entrypoint sh anynote-web-test:builder -c "ls /app/node_modules/.bin/prisma"` (rebuild with `--target builder` to inspect).

- [ ] **Step 5: Test that prisma CLI runs in the image**

```bash
docker run --rm --entrypoint sh -w /app/packages/db anynote-web-test -c "../../node_modules/.bin/prisma --version"
```

Expected: outputs `prisma : 7.x.x` and friends. If the binary errors, the @prisma engine wasn't copied — fix the second COPY line.

- [ ] **Step 6: Clean up local image**

```bash
docker rmi anynote-web-test
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/Dockerfile
git commit -m "feat(web): bundle Prisma CLI + db package into runner image for migrate service"
```

---

## Task 8: Replace `deploy` job in `.github/workflows/deploy.yml`

**Files:**
- Modify: `.github/workflows/deploy.yml` (replace `deploy:` job at the bottom — currently `runs: echo 'deploy'`)

This adds the real deploy job: render `.env` with envsubst, materialise dashboard-users, rsync everything to the server over SSH, and run `docker compose pull && up -d --remove-orphans`.

- [ ] **Step 1: Read the current deploy.yml to confirm the structure**

```bash
sed -n '55,70p' .github/workflows/deploy.yml
```

You should see the placeholder `deploy:` job at the end. Note: the workflow currently triggers on `push: tags: ['v*']` — leave that unchanged. Image tags from `build` use `type=semver,pattern={{version}}` and `type=raw,value=latest`, so `:latest` always points at the last tagged build.

- [ ] **Step 2: Replace the deploy job**

Edit `.github/workflows/deploy.yml`. Find:

```yaml
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production

    steps:
      - run: echo 'deploy'
```

Replace with:

```yaml
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: deploy-prod
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v5

      - name: Render .env from template
        env:
          NEXT_PUBLIC_BASE_URL: ${{ secrets.NEXT_PUBLIC_BASE_URL }}
          BETTER_AUTH_URL: ${{ secrets.BETTER_AUTH_URL }}
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          BETTER_AUTH_JWT_AUDIENCE: ${{ secrets.BETTER_AUTH_JWT_AUDIENCE }}
          NEXT_PUBLIC_YJS_URL: ${{ secrets.NEXT_PUBLIC_YJS_URL }}
          POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DB__PASSWORD: ${{ secrets.DB__PASSWORD }}
          S3_ENDPOINT: ${{ secrets.S3_ENDPOINT }}
          S3_REGION: ${{ secrets.S3_REGION }}
          S3_ACCESS_KEY: ${{ secrets.S3_ACCESS_KEY }}
          S3_SECRET_KEY: ${{ secrets.S3_SECRET_KEY }}
          S3_BUCKET: ${{ secrets.S3_BUCKET }}
          S3_FORCE_PATH_STYLE: ${{ secrets.S3_FORCE_PATH_STYLE }}
          QDRANT__HOST: ${{ secrets.QDRANT__HOST }}
          QDRANT__AUTH__TYPE: ${{ secrets.QDRANT__AUTH__TYPE }}
          QDRANT__AUTH__BEARER_TOKEN: ${{ secrets.QDRANT__AUTH__BEARER_TOKEN }}
          QDRANT__COLLECTION_NAME: ${{ secrets.QDRANT__COLLECTION_NAME }}
          AGENTS_SERVICE_URL: ${{ secrets.AGENTS_SERVICE_URL }}
          AGENTS_SERVICE_TOKEN: ${{ secrets.AGENTS_SERVICE_TOKEN }}
          AGENTS_SECRET_KEY: ${{ secrets.AGENTS_SECRET_KEY }}
          ENGINES_URL: ${{ secrets.ENGINES_URL }}
          ENGINES_PORT: ${{ secrets.ENGINES_PORT }}
          ENGINES_MCP_TOKEN: ${{ secrets.ENGINES_MCP_TOKEN }}
          SMTP_HOST: ${{ secrets.SMTP_HOST }}
          SMTP_PORT: ${{ secrets.SMTP_PORT }}
          SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
          GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ${{ secrets.NEXT_PUBLIC_RECAPTCHA_SITE_KEY }}
          RECAPTCHA_SECRET_KEY: ${{ secrets.RECAPTCHA_SECRET_KEY }}
          YOOKASSA_SHOP_ID: ${{ secrets.YOOKASSA_SHOP_ID }}
          YOOKASSA_SECRET_KEY: ${{ secrets.YOOKASSA_SECRET_KEY }}
          ACME_EMAIL: ${{ secrets.ACME_EMAIL }}
          TRAEFIK_DASHBOARD_USERS_LINE: ${{ secrets.TRAEFIK_DASHBOARD_USERS_LINE }}
        run: |
          envsubst < deploy/.env.template > /tmp/.env
          chmod 600 /tmp/.env
          # Materialise the dashboard-users file for traefik basicAuth.usersFile.
          printf '%s\n' "$TRAEFIK_DASHBOARD_USERS_LINE" > /tmp/dashboard-users
          chmod 600 /tmp/dashboard-users
          # Sanity-check no unsubstituted vars remain.
          if grep -E '\$\{[A-Z_]+\}' /tmp/.env > /dev/null; then
            echo "ERROR: .env still contains unsubstituted vars:"
            grep -nE '\$\{[A-Z_]+\}' /tmp/.env
            exit 1
          fi

      - name: Setup SSH
        uses: webfactory/ssh-agent@v0.9.1
        with:
          ssh-private-key: ${{ secrets.DEPLOY_KEY_PRIVATE }}

      - name: Trust deploy host
        run: |
          mkdir -p ~/.ssh
          ssh-keyscan -p ${{ secrets.DEPLOY_PORT }} ${{ secrets.DEPLOY_HOST }} >> ~/.ssh/known_hosts

      - name: Sync deploy artifacts to server
        run: |
          ssh -p ${{ secrets.DEPLOY_PORT }} \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
            "mkdir -p /opt/anynote/traefik/dynamic /opt/anynote/postgres-init"
          rsync -avz --delete \
            -e "ssh -p ${{ secrets.DEPLOY_PORT }}" \
            deploy/compose.yml \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/compose.yml
          rsync -avz --delete \
            -e "ssh -p ${{ secrets.DEPLOY_PORT }}" \
            deploy/traefik/ \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/traefik/
          rsync -avz --delete \
            -e "ssh -p ${{ secrets.DEPLOY_PORT }}" \
            deploy/postgres-init/ \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/postgres-init/
          scp -P ${{ secrets.DEPLOY_PORT }} /tmp/.env \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/.env
          scp -P ${{ secrets.DEPLOY_PORT }} /tmp/dashboard-users \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/traefik/dynamic/dashboard-users

      - name: Pull images and bring stack up
        env:
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GHCR_USER: ${{ github.actor }}
        run: |
          ssh -p ${{ secrets.DEPLOY_PORT }} \
            ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
            "set -e; cd /opt/anynote && \
             echo '$GHCR_TOKEN' | docker login ghcr.io -u $GHCR_USER --password-stdin && \
             docker compose --project-name anynote pull && \
             docker compose --project-name anynote up -d --remove-orphans && \
             docker logout ghcr.io"
```

- [ ] **Step 3: Lint the workflow YAML**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml'))" && echo OK
```

Expected: `OK`. If YAML errors, fix indentation (most common issue with multi-line `run:` blocks).

- [ ] **Step 4: Verify the deploy job appears in `gh workflow view`**

```bash
gh workflow view deploy.yml --yaml | head -20
```

Expected: shows the workflow name `Deploy` and the trigger `on: push: tags`. If the file fails to parse server-side, gh will say so — fix accordingly.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat(ci): wire up real deploy job (env render, rsync, docker compose up)"
```

---

## Task 9: Final integration check — render .env locally and parse compose

This is the closest you can get to validating the full pipeline without an actual production server: render the .env from the template using shell-only env vars (mimicking the GitHub Actions step), then run `docker compose config` to confirm everything interpolates and the result is valid Docker.

- [ ] **Step 1: Render .env from template using throwaway values**

```bash
cd /Users/victor/Projects/anynote/deploy
env -i \
  NEXT_PUBLIC_BASE_URL=https://anynote.ru \
  BETTER_AUTH_URL=https://anynote.ru \
  BETTER_AUTH_SECRET=test-32char-secret-padding-zzzz \
  BETTER_AUTH_JWT_AUDIENCE=anynote-yjs \
  NEXT_PUBLIC_YJS_URL=wss://anynote.ru/ws \
  DATABASE_URL=postgresql://anynote:pass@postgres:5432/anynote \
  POSTGRES_PASSWORD=pass \
  DB__PASSWORD=pass \
  S3_ENDPOINT=http://minio:9000 \
  S3_REGION=us-east-1 \
  S3_ACCESS_KEY=admin \
  S3_SECRET_KEY=password \
  S3_BUCKET=storage \
  S3_FORCE_PATH_STYLE=true \
  QDRANT__HOST=http://qdrant:6333 \
  QDRANT__AUTH__TYPE=bearer_token \
  QDRANT__AUTH__BEARER_TOKEN=q-token \
  QDRANT__COLLECTION_NAME=pages \
  AGENTS_SERVICE_URL=http://agents:8080 \
  AGENTS_SERVICE_TOKEN=a-token \
  AGENTS_SECRET_KEY=a-secret \
  ENGINES_URL=http://engines \
  ENGINES_PORT=8082 \
  ENGINES_MCP_TOKEN=e-token \
  SMTP_HOST=smtp.example.com \
  SMTP_PORT=587 \
  SMTP_SECURE=true \
  SMTP_USER=mailer \
  SMTP_PASSWORD=smtp-pass \
  MAIL_FROM='AnyNote <noreply@anynote.ru>' \
  GOOGLE_CLIENT_ID=g-id \
  GOOGLE_CLIENT_SECRET=g-secret \
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY=r-site \
  RECAPTCHA_SECRET_KEY=r-secret \
  YOOKASSA_SHOP_ID=y-id \
  YOOKASSA_SECRET_KEY=y-secret \
  ACME_EMAIL=admin@anynote.ru \
  TRAEFIK_DASHBOARD_USERS_LINE='admin:$2y$05$abc' \
  envsubst < .env.template > .env
```

Expected: writes `deploy/.env` with no errors.

- [ ] **Step 2: Confirm no unsubstituted vars remain**

```bash
grep -E '\$\{[A-Z_]+\}' .env && echo "FAIL" || echo "OK: all vars substituted"
```

Expected: `OK: all vars substituted`.

- [ ] **Step 3: Parse the compose file with the rendered env**

```bash
docker compose --env-file .env config > /tmp/rendered-compose.yml
echo "Compose parsed OK; rendered to /tmp/rendered-compose.yml"
grep -E '^\s+image:' /tmp/rendered-compose.yml
```

Expected: lists images for traefik, postgres, minio, minio-init, qdrant, migrate, web, yjs, engines, agents (10 services). If `docker compose` errors, fix the compose YAML.

- [ ] **Step 4: Clean up the throwaway .env**

```bash
rm .env
cd ..
```

- [ ] **Step 5: Confirm the `.env` is gitignored**

```bash
grep -E '^/?deploy/\.env$|^\.env$' .gitignore
```

Expected: matches `/.env` (root) — but `deploy/.env` is not currently covered. Add a line to `.gitignore` if missing:

```bash
if ! grep -qE '^deploy/\.env$' .gitignore; then
  printf '\n# Production .env rendered locally for smoke tests — never commit\ndeploy/.env\n' >> .gitignore
fi
```

- [ ] **Step 6: Commit gitignore update if needed**

```bash
if ! git diff --quiet .gitignore; then
  git add .gitignore
  git commit -m "chore: gitignore deploy/.env (rendered locally for smoke tests only)"
fi
```

---

## Task 10: Open the PR

- [ ] **Step 1: Push the feature branch**

This work is on `main` so far via direct commits. Switch to a feature branch before pushing so it goes through PR review:

```bash
git switch -c feat/production-deployment
git push -u origin feat/production-deployment
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "feat: production deployment via traefik + docker compose" --body "$(cat <<'EOF'
## Summary

- Adds `deploy/` directory: `compose.yml`, `.env.template`, `.env.example`, traefik config, postgres init script
- Updates `apps/web/Dockerfile` to bundle Prisma CLI + `packages/db` for the one-shot `migrate` service
- Replaces stub `deploy` job in `.github/workflows/deploy.yml` with real envsubst-rendered .env + rsync + `docker compose up -d` over SSH
- Adds `docker/postgres-init/01-create-agents-db.sql` so dev compose also creates the `anynote_agents` database

Spec: `docs/superpowers/specs/2026-05-03-production-deployment-design.md`
Plan: `docs/superpowers/plans/2026-05-03-production-deployment.md`

## Test plan

- [x] Local `docker compose --env-file <smoke> config` passes for `deploy/compose.yml`
- [x] `apps/web/Dockerfile` builds locally; Prisma CLI runnable in resulting image
- [x] envsubst rendering catches missing vars
- [ ] Operator: DNS A-records for `anynote.ru`, `www.anynote.ru`, `traefik.anynote.ru` set
- [ ] Operator: server provisioned (Docker, deploy user, SSH key)
- [ ] Push tag `vX.Y.Z` and watch deploy workflow complete green
- [ ] Verify `https://anynote.ru` loads, `wss://anynote.ru/ws` accepts handshake, `https://traefik.anynote.ru` prompts for basic-auth

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Print PR URL for the user**

The `gh pr create` command prints the URL. Surface it in the chat so the user can open it.

---

## Self-Review Checklist (run before handing off)

1. **Spec coverage:**
   - Section "Components → `deploy/compose.yml`" → Task 6 ✓
   - Section "Components → `deploy/traefik/traefik.yml`" → Task 4 ✓
   - Section "Components → `deploy/traefik/dynamic/middlewares.yml`" → Task 5 ✓
   - Section "Components → `deploy/postgres-init/01-create-agents-db.sql`" → Task 1 ✓
   - Section "Components → `deploy/.env.template`" → Task 2 ✓
   - Section "Components → `deploy/.env.example`" → Task 3 ✓
   - Section "Components → Updated `apps/web/Dockerfile`" → Task 7 ✓
   - Section "Components → Updated `.github/workflows/deploy.yml`" → Task 8 ✓
   - Section "Data Flow → Cold start" → Operator Prerequisites + Task 8 ✓
   - Section "Security Notes" → covered by Tasks 4, 5, 6, 8 ✓
   - Section "Testing Plan → Local docker compose smoke" → Task 9 ✓
   - Section "Open Items / Follow-Ups → image tag pinning" → noted in spec, not blocking
   - Section "Open Items / Follow-Ups → backups" → out of scope, noted in spec

2. **Placeholder scan:** No "TBD"/"TODO" strings. All steps have concrete commands or code.

3. **Type/path consistency:**
   - Image names in compose: `ghcr.io/anynoteinc/anynote-{web,yjs,engines,agents}:latest` — match `IMAGE_NAMESPACE: ${{ github.repository_owner }}/anynote` and matrix in build job ✓
   - Compose project name: `anynote` (set by `--project-name anynote` in deploy ssh) — must match `network: anynote_default` in `traefik.yml` ✓
   - DB user: `anynote` everywhere (compose env, .env DB__USER, init script) ✓
   - Compose service names: `traefik`, `postgres`, `minio`, `minio-init`, `qdrant`, `migrate`, `web`, `yjs`, `engines`, `agents` — referenced consistently in env (e.g. `S3_ENDPOINT=http://minio:9000`, `AGENTS_SERVICE_URL=http://agents:8080`) ✓
