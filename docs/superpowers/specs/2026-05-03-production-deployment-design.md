# Production Deployment Design

**Date:** 2026-05-03
**Status:** Draft for review
**Repository:** `git@github.com:AnyNoteInc/AnyNote.git`
**Domain:** `https://anynote.ru` (+ `https://www.anynote.ru` redirect)
**Builds on:** `2026-05-02-cicd-pipeline-design.md` (which set up the `build` job that publishes images to GHCR; this spec adds the `deploy` job and the production compose file).

## Goal

Stand up the production environment for AnyNote on a single Linux host, served from `https://anynote.ru`, with:

1. A `deploy/compose.yml` containing every service the app needs (Traefik, web, yjs, engines, agents, postgres, minio, qdrant, plus a one-shot `migrate` task).
2. A `deploy/.env.template` rendered into a real `.env` on the server during the GitHub Actions deploy job, populated from repository secrets.
3. Traefik as the single ingress: TLS termination via Let's Encrypt, host- and path-based routing, rate limiting, anti-DDoS in-flight cap, security headers, and an authenticated dashboard at `https://traefik.anynote.ru`.
4. A `.github/workflows/deploy.yml` `deploy` job that — after `build` — renders the `.env`, syncs deploy artifacts to the server over SSH, runs `docker compose pull` + `docker compose up -d --remove-orphans`, and lets the one-shot `migrate` service apply Prisma migrations + seeds.

## Scope

### In scope

- New `deploy/` directory with: `compose.yml`, `.env.example` (documentation), `.env.template` (envsubst input), `traefik/traefik.yml`, `traefik/dynamic/middlewares.yml`, `postgres-init/01-create-agents-db.sql`.
- Updated `apps/web/Dockerfile` runner stage to ship the Prisma CLI + migrations + seed (so the same image can run as the `migrate` one-shot service).
- Updated `.github/workflows/deploy.yml` with a real `deploy` job (replacing the current `echo 'deploy'`).
- New GitHub repository secrets (already added in this brainstorming session): `POSTGRES_PASSWORD`, `DATABASE_URL`, `DB__PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_JWT_AUDIENCE`, `AGENTS_SERVICE_TOKEN`, `AGENTS_SECRET_KEY`, `ENGINES_MCP_TOKEN`, `MAIL_FROM`, `TRAEFIK_DASHBOARD_USER`, `TRAEFIK_DASHBOARD_PASSWORD_HASH`, `TRAEFIK_DASHBOARD_USERS_LINE`, `ACME_EMAIL`. Plus `NEXT_PUBLIC_YJS_URL` updated to `wss://anynote.ru/ws`.
- Mirror the new `postgres-init` script into the existing dev `docker/postgres-init/` so local dev also gets the `anynote_agents` database.

### Out of scope

- Backups / disaster recovery for postgres / minio / qdrant volumes (separate operational concern).
- Multi-host / Swarm / Kubernetes (single-host docker compose is the deployment target).
- Ollama in production — `apps/agents` reads LLM/embedding provider config per-request from the API payload (the connection details, including `base_url` and `api_key`, are stored per-workspace in the DB). Users wanting a self-hosted Ollama configure their workspace AI connection to point at it themselves.
- Mailhog in production — production uses real SMTP via `SMTP_*` secrets.
- An `agents-migrate` service — `apps/agents` currently has no committed Alembic migration files; it relies on `langgraph_checkpoint_postgres.AsyncPostgresSaver.setup()` to auto-create its tables on first connection. If `apps/agents` introduces SQLAlchemy models with migrations later, add a follow-up.
- DNS configuration — A-records for `anynote.ru`, `www.anynote.ru`, and `traefik.anynote.ru` pointing at `DEPLOY_HOST` are operator-managed in the DNS provider.
- A separate `apps/migrate` workspace package — we reuse the `web` image instead.

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │          GitHub Actions (deploy)            │
                    │  1. envsubst .env.template → /tmp/.env      │
                    │  2. rsync deploy/ → server:/opt/anynote/    │
                    │  3. ssh: docker compose pull && up -d       │
                    └────────────────────┬────────────────────────┘
                                         │ SSH (ed25519)
                                         ▼
┌──────────────────────────── DEPLOY_HOST ───────────────────────────────┐
│                                                                         │
│  ┌─────────┐  :80,:443                                                  │
│  │ traefik │◀────── public Internet (HTTPS via Let's Encrypt)           │
│  └────┬────┘                                                            │
│       │                                                                 │
│       ├─ Host(`anynote.ru`,`www.anynote.ru`) && PathPrefix(`/ws`)       │
│       │     → strip `/ws` → yjs:1234   (websocket upgrade)              │
│       │                                                                 │
│       ├─ Host(`anynote.ru`,`www.anynote.ru`)                            │
│       │     → web:3000                                                  │
│       │                                                                 │
│       └─ Host(`traefik.anynote.ru`)                                     │
│             → api@internal (basic-auth)                                 │
│                                                                         │
│  ┌─────┐    ┌─────┐    ┌─────────┐    ┌────────┐                        │
│  │ web │    │ yjs │    │ engines │    │ agents │                        │
│  └──┬──┘    └──┬──┘    └────┬────┘    └───┬────┘                        │
│     │ tRPC↘   │            │ MCP        │ HTTP                          │
│     │       (web→engines, web→agents, engines→agents over docker DNS)   │
│     │         │            │             │                              │
│     └─────────┴────────────┴─────────────┴──▶ postgres                  │
│                                                (anynote / anynote_agents)│
│                              ┌──▶ qdrant   (vector index, internal)     │
│                              └──▶ minio    (S3 storage,    internal)    │
│                                                                         │
│  ┌─────────┐                                                            │
│  │ migrate │  one-shot, exits after Prisma migrate+seed                 │
│  └─────────┘                                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

**Network model:** all containers on the default compose network. Only `traefik` publishes ports (`80`, `443`) to the host. `engines`, `agents`, `postgres`, `minio`, `qdrant`, `yjs`, `web` are reachable only inside the network — `yjs` and `web` are exposed to the public via Traefik routers, the rest stay internal.

## Components

### `deploy/compose.yml`

```yaml
services:
  traefik:
    image: traefik:v3.5
    restart: unless-stopped
    ports: ['80:80', '443:443']
    volumes:
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ./traefik/dynamic:/etc/traefik/dynamic:ro
      - traefik_acme:/letsencrypt
      - /var/run/docker.sock:/var/run/docker.sock:ro
    labels:
      - traefik.enable=true
      # Dashboard router (uses api@internal service)
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
      test: ['CMD-SHELL', 'pg_isready -U anynote -d anynote']
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
    volumes: [minio_data:/data]
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
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
    restart: 'no'

  qdrant:
    image: qdrant/qdrant:v1.12.4
    restart: unless-stopped
    environment:
      QDRANT__SERVICE__API_KEY: ${QDRANT__AUTH__BEARER_TOKEN}
      QDRANT__TELEMETRY_DISABLED: 'true'
    volumes: [qdrant_data:/qdrant/storage]

  migrate:
    image: ghcr.io/anynoteinc/anynote-web:latest
    restart: 'no'
    env_file: .env
    depends_on:
      postgres:
        condition: service_healthy
    working_dir: /app/packages/db
    command: >
      sh -c "
        ../../node_modules/.bin/prisma migrate deploy &&
        ../../node_modules/.bin/prisma db seed
      "

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

### `deploy/traefik/traefik.yml` (static config)

```yaml
api:
  dashboard: true

entryPoints:
  web:
    address: ':80'
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ':443'

providers:
  docker:
    exposedByDefault: false
    network: anynote_default # set explicitly so traefik picks the right network
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

### `deploy/traefik/dynamic/middlewares.yml`

```yaml
http:
  middlewares:
    ratelimit:
      rateLimit:
        average: 100
        burst: 200
        period: 1s
        sourceCriterion:
          ipStrategy:
            depth: 1
    ratelimit-ws:
      # WebSocket establishes one HTTP connection then stays open;
      # we mostly want to throttle the *opens*, not in-flight frames.
      rateLimit:
        average: 20
        burst: 40
        period: 1s
    inflight:
      inFlightReq:
        amount: 50
        sourceCriterion:
          ipStrategy:
            depth: 1
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
    strip-ws:
      stripPrefix:
        prefixes: ['/ws']
    www-redirect:
      redirectRegex:
        regex: "^https?://www\\.anynote\\.ru/(.*)"
        replacement: 'https://anynote.ru/${1}'
        permanent: true
    dashboard-auth:
      basicAuth:
        usersFile: /etc/traefik/dynamic/dashboard-users
        removeHeader: true
```

### `deploy/postgres-init/01-create-agents-db.sql`

```sql
SELECT 'CREATE DATABASE anynote_agents'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'anynote_agents')\gexec
GRANT ALL PRIVILEGES ON DATABASE anynote_agents TO anynote;
```

The same file is mirrored into `docker/postgres-init/` (the dev compose already mounts that directory) so local dev gets the `anynote_agents` database too.

### `deploy/.env.template`

The deploy job runs `envsubst < deploy/.env.template > /tmp/.env` with all GH secrets exported as env vars. Full template body:

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

`TRAEFIK_DASHBOARD_USERS_LINE` is not consumed by any app container — it's materialised into `/opt/anynote/traefik/dynamic/dashboard-users` by the deploy step, where Traefik's `basicAuth.usersFile` middleware reads it.

### `deploy/.env.example`

Documentation companion (not consumed by anything). Same keys as `.env.template`, but with placeholder values and inline comments explaining what each one is for. Lives in git so a new operator can read it without grepping the workflow.

### Updated `apps/web/Dockerfile` (runner stage additions)

```dockerfile
# After existing COPY lines, before EXPOSE:

# Prisma CLI + schema/migrations/seed for the one-shot `migrate` compose service.
# The Next.js standalone runner doesn't include these by default.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/packages/db ./packages/db
```

(The `packages/db` copy supersedes any narrower previous copy — it brings the schema, migrations folder, `prisma.config.ts`, the seed script, and the package.json with the `prisma.seed` config in one shot.)

The runtime entrypoint is unchanged: `CMD node apps/web/server.js`. Only the one-shot `migrate` compose service overrides the command.

### Updated `.github/workflows/deploy.yml` (`deploy` job)

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
        # Public URLs / config
        NEXT_PUBLIC_BASE_URL: ${{ secrets.NEXT_PUBLIC_BASE_URL }}
        BETTER_AUTH_URL: ${{ secrets.BETTER_AUTH_URL }}
        BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
        BETTER_AUTH_JWT_AUDIENCE: ${{ secrets.BETTER_AUTH_JWT_AUDIENCE }}
        NEXT_PUBLIC_YJS_URL: ${{ secrets.NEXT_PUBLIC_YJS_URL }}
        # Postgres / DB
        POSTGRES_PASSWORD: ${{ secrets.POSTGRES_PASSWORD }}
        DATABASE_URL: ${{ secrets.DATABASE_URL }}
        DB__PASSWORD: ${{ secrets.DB__PASSWORD }}
        # S3
        S3_ENDPOINT: ${{ secrets.S3_ENDPOINT }}
        S3_REGION: ${{ secrets.S3_REGION }}
        S3_ACCESS_KEY: ${{ secrets.S3_ACCESS_KEY }}
        S3_SECRET_KEY: ${{ secrets.S3_SECRET_KEY }}
        S3_BUCKET: ${{ secrets.S3_BUCKET }}
        S3_FORCE_PATH_STYLE: ${{ secrets.S3_FORCE_PATH_STYLE }}
        # Qdrant
        QDRANT__HOST: ${{ secrets.QDRANT__HOST }}
        QDRANT__AUTH__TYPE: ${{ secrets.QDRANT__AUTH__TYPE }}
        QDRANT__AUTH__BEARER_TOKEN: ${{ secrets.QDRANT__AUTH__BEARER_TOKEN }}
        QDRANT__COLLECTION_NAME: ${{ secrets.QDRANT__COLLECTION_NAME }}
        # Inter-service
        AGENTS_SERVICE_URL: ${{ secrets.AGENTS_SERVICE_URL }}
        AGENTS_SERVICE_TOKEN: ${{ secrets.AGENTS_SERVICE_TOKEN }}
        AGENTS_SECRET_KEY: ${{ secrets.AGENTS_SECRET_KEY }}
        ENGINES_URL: ${{ secrets.ENGINES_URL }}
        ENGINES_PORT: ${{ secrets.ENGINES_PORT }}
        ENGINES_MCP_TOKEN: ${{ secrets.ENGINES_MCP_TOKEN }}
        # Mail
        SMTP_HOST: ${{ secrets.SMTP_HOST }}
        SMTP_PORT: ${{ secrets.SMTP_PORT }}
        SMTP_SECURE: ${{ secrets.SMTP_SECURE }}
        SMTP_USER: ${{ secrets.SMTP_USER }}
        SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}
        MAIL_FROM: ${{ secrets.MAIL_FROM }}
        # OAuth + reCAPTCHA + YooKassa
        GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
        GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
        NEXT_PUBLIC_RECAPTCHA_SITE_KEY: ${{ secrets.NEXT_PUBLIC_RECAPTCHA_SITE_KEY }}
        RECAPTCHA_SECRET_KEY: ${{ secrets.RECAPTCHA_SECRET_KEY }}
        YOOKASSA_SHOP_ID: ${{ secrets.YOOKASSA_SHOP_ID }}
        YOOKASSA_SECRET_KEY: ${{ secrets.YOOKASSA_SECRET_KEY }}
        # Traefik
        ACME_EMAIL: ${{ secrets.ACME_EMAIL }}
        TRAEFIK_DASHBOARD_USERS_LINE: ${{ secrets.TRAEFIK_DASHBOARD_USERS_LINE }}
      run: |
        envsubst < deploy/.env.template > /tmp/.env
        chmod 600 /tmp/.env
        # Materialise dashboard-users for the basicAuth middleware
        printf '%s\n' "$TRAEFIK_DASHBOARD_USERS_LINE" > /tmp/dashboard-users

    - name: Setup SSH
      uses: webfactory/ssh-agent@v0.9.1
      with:
        ssh-private-key: ${{ secrets.DEPLOY_KEY_PRIVATE }}

    - name: Add deploy host to known_hosts
      run: |
        mkdir -p ~/.ssh
        ssh-keyscan -p ${{ secrets.DEPLOY_PORT }} ${{ secrets.DEPLOY_HOST }} >> ~/.ssh/known_hosts

    - name: Sync deploy artifacts
      run: |
        ssh -p ${{ secrets.DEPLOY_PORT }} \
          ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
          "mkdir -p /opt/anynote/traefik/dynamic /opt/anynote/postgres-init"
        rsync -avz --delete \
          -e "ssh -p ${{ secrets.DEPLOY_PORT }}" \
          deploy/compose.yml \
          deploy/traefik/ \
          deploy/postgres-init/ \
          ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/
        scp -P ${{ secrets.DEPLOY_PORT }} \
          /tmp/.env \
          ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/.env
        scp -P ${{ secrets.DEPLOY_PORT }} \
          /tmp/dashboard-users \
          ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/opt/anynote/traefik/dynamic/dashboard-users

    - name: Pull and start
      env:
        GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        GHCR_USER: ${{ github.actor }}
      run: |
        ssh -p ${{ secrets.DEPLOY_PORT }} \
          ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
          "cd /opt/anynote && \
           echo '$GHCR_TOKEN' | docker login ghcr.io -u $GHCR_USER --password-stdin && \
           docker compose pull && \
           docker compose up -d --remove-orphans"
```

## Data Flow

### Cold start on a fresh server

1. Operator creates the server, opens ports 22/80/443, sets DNS A-records for `anynote.ru`, `www.anynote.ru`, `traefik.anynote.ru` → server IP.
2. Operator installs Docker + Docker Compose on the server, creates the `DEPLOY_USER` with sudo-less docker access, and adds the deploy SSH public key to `~/.ssh/authorized_keys`.
3. Operator pushes a tag `vX.Y.Z` (or it gets cut by `release.yml` semantic-release). The `deploy.yml` workflow fires.
4. `build` job builds 4 images (`web`, `yjs`, `engines`, `agents`) and pushes them to GHCR with the `vX.Y.Z` tag and `latest`.
5. `deploy` job:
   - Renders `.env` and `dashboard-users` from secrets locally on the runner.
   - rsyncs `deploy/compose.yml`, `deploy/traefik/`, `deploy/postgres-init/`, `.env`, `dashboard-users` to `/opt/anynote/` on the server.
   - SSHs in, logs into GHCR, runs `docker compose pull && docker compose up -d --remove-orphans`.
6. Compose starts containers in dependency order:
   - `postgres` (waits healthy) → `minio-init` and `migrate` start.
   - `migrate` runs `prisma migrate deploy && prisma db seed`, exits 0.
   - `web`, `yjs`, `engines`, `agents` start once `migrate` exits successfully.
   - `traefik` reads docker labels, requests TLS certs from LE on first HTTPS hit.

### Subsequent deploys

Same flow as cold start. `migrate` runs every deploy — `prisma migrate deploy` skips already-applied migrations, and the seed script is upsert-based, so re-running is safe and idempotent.

## Security Notes

- Only Traefik publishes ports to the host (`80`, `443`).
- All inter-service traffic stays on the docker network (no host-port exposure for postgres/minio/qdrant/engines/agents).
- Postgres password, all service tokens, OAuth secrets, SMTP credentials, S3 keys, Qdrant token, traefik dashboard hash — all generated with `openssl rand -hex` (or `htpasswd -nbB` for the dashboard) and stored only in GitHub repo secrets.
- The rendered `.env` on the server has `chmod 600` and lives only in `/opt/anynote/.env`.
- TLS is enforced: HTTP `:80` always 308-redirects to HTTPS `:443` (Traefik `entryPoints.web.http.redirections`).
- HSTS with 2-year max-age + preload. Frame-Deny, Nosniff, strict referrer policy.
- Rate limiter: 100 req/sec average / 200 burst per source IP for HTTP; 20/40 per source for WebSocket open. In-flight cap of 50 concurrent requests per source IP.
- Traefik dashboard behind basic-auth with bcrypt hash, on its own subdomain.
- `www.anynote.ru` 301-redirects to `anynote.ru` so canonical URL is single.

## Testing Plan

This is infrastructure — testing is out-of-band rather than via unit tests. Acceptance criteria:

1. **Local docker compose smoke** — on the developer machine: `cd deploy && docker compose --env-file .env.smoke up -d --build` (using a `.env.smoke` populated with throwaway local-network values + `localhost`-pointed cert disabled), confirms compose YAML parses and services start. Done before opening the PR.
2. **First deploy on the production host** — push a tag, watch `deploy.yml` complete green, then verify:
   - `https://anynote.ru` loads, returns the Next.js home page.
   - `https://anynote.ru/api/health` returns 200.
   - `wss://anynote.ru/ws` accepts a hocuspocus handshake (use `wscat` from a developer machine).
   - `https://traefik.anynote.ru` prompts for basic auth, then renders the dashboard.
   - `https://www.anynote.ru` 301-redirects to `https://anynote.ru`.
   - LE certificates are issued and visible in the Traefik dashboard "TLS" panel.
3. **Idempotency** — re-run the deploy workflow against the same tag; confirm `docker compose up -d` is a no-op (no container restarts) and `migrate` exits cleanly with no schema drift.

## Open Items / Follow-Ups

- **`apps/agents` migrations:** if/when agents introduces SQLAlchemy models that need migrations, add an `agents-migrate` one-shot service mirroring the `migrate` pattern.
- **Backups:** out of scope for this spec, but `postgres_data`, `minio_data`, `qdrant_data` and `traefik_acme` (the LE state) are the volumes that need a backup story.
- **Deploy trigger:** currently triggered by tag push (`v*`). A future iteration may add a `workflow_dispatch` for manual rollback.
- **Image tag pinning:** the deploy currently uses `:latest` for all images. A safer pattern is to pin to `${{ github.ref_name }}` (the tag) so re-running an older tag's deploy job pulls the right image. Worth doing in a follow-up once the basic flow is verified working.
