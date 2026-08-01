# Telegram WARP Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route only AnyNote Telegram Bot API calls through a free Cloudflare WARP local proxy and prove that a production contact submission reaches Telegram.

**Architecture:** The shared `@repo/telegram` client attaches a per-request `undici.ProxyAgent` only when `TELEGRAM_PROXY_URL` is configured. Production runs the official Cloudflare WARP client in local proxy mode on host loopback; a locked-down `socat` service exposes that loopback listener only on Docker's host-gateway address so `web` and `engines` can reach it.

**Tech Stack:** TypeScript 6, Vitest 4, Undici 7, Node.js 24.18.1, Docker Compose, Bash, systemd, Cloudflare WARP/MASQUE, GitHub Actions.

## Global Constraints

- Execute implementation in an isolated worktree created with `superpowers:using-git-worktrees`; use branch `codex/telegram-warp-proxy` so the user's dirty `main` worktree remains untouched.
- Production is Ubuntu 22.04 `amd64`; both `web` and `engines` run Node.js 24.18.1.
- Use the official stable `cloudflare-warp` package and free consumer registration.
- WARP must run in local proxy mode. Never enable full-tunnel `warp`, `warp+doh`, or traffic-only mode.
- If `warp-cli mode --help` does not advertise local proxy mode after installation, stop without changing application routing.
- Fixed Docker bridge port: `40001`. Discover the WARP loopback port and Docker host-gateway address at runtime.
- Bind the bridge only to the Docker host-gateway address, never `0.0.0.0` or a public interface.
- Proxy only `@repo/telegram` requests. Do not set process-wide `HTTP_PROXY`, `HTTPS_PROXY`, or `ALL_PROXY`.
- Preserve end-to-end TLS to `api.telegram.org`; do not install TLS inspection certificates.
- Never log bot tokens, chat IDs, proxy credentials, Telegram request URLs, or lead payloads.
- Do not add automatic `sendMessage` retries because an ambiguous retry can duplicate a lead.
- Configuration and shell-script tests must execute the artifact and assert observable output, exit status, or filesystem effects; do not use source-text assertions. This requirement supersedes the original static-test wording by user decision on 2026-08-01.
- Land code with `TELEGRAM_PROXY_URL` unset first; enable production routing only after WARP and the bridge pass independent probes.
- On any failed production gate, stop and execute the scoped rollback steps for that task.

---

## File Map

### Application boundary

- Create `packages/telegram/src/proxy.ts`: validate `TELEGRAM_PROXY_URL`, cache one dedicated Undici dispatcher, and expose it to the Telegram client.
- Modify `packages/telegram/src/api.ts`: attach the dispatcher only when the built-in fetch path is used.
- Modify `packages/telegram/test/api.test.ts`: cover direct, proxied, injected-fetch, and invalid-protocol behavior.
- Modify `packages/telegram/package.json` and `pnpm-lock.yaml`: add `undici@7.28.0` as a direct runtime dependency.

### Deployment boundary

- Modify `.env.example`, `deploy/.env.template`, and `turbo.json`: document and propagate `TELEGRAM_PROXY_URL`.
- Modify `deploy/compose.yml`: add `host.docker.internal:host-gateway` only to `web` and `engines`.
- Modify `.github/workflows/deploy.yml`: render the production variable and sync versioned WARP assets.
- Create `deploy/test/telegram-proxy-config.test.mjs`: execute `docker compose config --format json` and assert the resolved deployment contract without contacting production.

### Host operations boundary

- Create `deploy/warp/install.sh`: idempotent `check`, `install`, `status`, and `disable` commands for WARP and the bridge.
- Create `deploy/warp/anynote-warp-bridge.service`: hardened systemd service for the Docker-only TCP bridge.
- Create `deploy/test/warp-assets.test.mjs`: execute the installer in a temporary stubbed host harness and assert fail-closed behavior and generated bridge artifacts.
- Modify `deploy/README.md`: operator runbook, health checks, enablement, and rollback.

---

### Task 1: Dedicated Telegram proxy dispatcher

**Files:**

- Create: `packages/telegram/src/proxy.ts`
- Modify: `packages/telegram/src/api.ts:1-58`
- Modify: `packages/telegram/test/api.test.ts:1-140`
- Modify: `packages/telegram/package.json:20-26`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: optional process environment value `TELEGRAM_PROXY_URL`.
- Produces: `telegramProxyDispatcher(raw?: string): Dispatcher | undefined` in `packages/telegram/src/proxy.ts`.
- Preserves: `TelegramApi` constructor and `TelegramApiResult<T>` public contracts.

- [ ] **Step 1: Add the explicit Undici dependency**

Run:

```bash
pnpm --filter @repo/telegram add undici@7.28.0
```

Expected: `packages/telegram/package.json` contains `"undici": "7.28.0"` under `dependencies`; the lockfile reuses the existing `undici@7.28.0` resolution.

- [ ] **Step 2: Add failing proxy-routing tests**

Change the Vitest import and add a hoisted constructor mock before importing `TelegramApi`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { proxyAgentConstructor } = vi.hoisted(() => ({
  proxyAgentConstructor: vi.fn(function ProxyAgent() {}),
}))

vi.mock('undici', () => ({
  ProxyAgent: proxyAgentConstructor,
}))

import { TelegramApi } from '../src/api.ts'
```

Add this suite after `capturingFetch`:

```ts
describe('TelegramApi proxy routing', () => {
  beforeEach(() => {
    proxyAgentConstructor.mockClear()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('keeps the default fetch path direct when TELEGRAM_PROXY_URL is unset', async () => {
    vi.stubEnv('TELEGRAM_PROXY_URL', '')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { id: 1 } }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await new TelegramApi(TOKEN).getMe()

    const init = fetchMock.mock.calls[0]![1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBeUndefined()
    expect(proxyAgentConstructor).not.toHaveBeenCalled()
  })

  it('attaches one dedicated dispatcher when TELEGRAM_PROXY_URL is configured', async () => {
    vi.stubEnv('TELEGRAM_PROXY_URL', 'http://host.docker.internal:40001')
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { id: 1 } }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await new TelegramApi(TOKEN).getMe()

    expect(proxyAgentConstructor).toHaveBeenCalledWith('http://host.docker.internal:40001/')
    const init = fetchMock.mock.calls[0]![1] as RequestInit & { dispatcher?: unknown }
    expect(init.dispatcher).toBe(proxyAgentConstructor.mock.instances[0])
  })

  it('does not create or attach a dispatcher when fetchFn is injected', async () => {
    vi.stubEnv('TELEGRAM_PROXY_URL', 'http://host.docker.internal:40001')
    const { calls, fetchFn } = capturingFetch({ ok: true, result: { id: 1 } })

    await new TelegramApi(TOKEN, { fetchFn }).getMe()

    expect(proxyAgentConstructor).not.toHaveBeenCalled()
    expect(calls[0]!.init).not.toHaveProperty('dispatcher')
  })

  it('rejects unsupported proxy schemes without contacting Telegram', async () => {
    vi.stubEnv('TELEGRAM_PROXY_URL', 'socks5h://127.0.0.1:9050')
    const fetchMock = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchMock)

    const result = await new TelegramApi(TOKEN).getMe()

    expect(result).toEqual({ ok: false, description: 'TypeError' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })
})
```

- [ ] **Step 3: Run the focused test and confirm RED**

Run:

```bash
pnpm --filter @repo/telegram test -- api.test.ts
```

Expected: the configured-proxy test fails because no `ProxyAgent` is created and no dispatcher is attached.

- [ ] **Step 4: Implement the focused proxy module**

Create `packages/telegram/src/proxy.ts`:

```ts
import { ProxyAgent, type Dispatcher } from 'undici'

let cachedProxy: { url: string; dispatcher: Dispatcher } | undefined

export function telegramProxyDispatcher(
  raw = process.env.TELEGRAM_PROXY_URL,
): Dispatcher | undefined {
  const value = raw?.trim()
  if (!value) return undefined

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('Invalid TELEGRAM_PROXY_URL')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('Unsupported TELEGRAM_PROXY_URL protocol')
  }

  if (cachedProxy?.url === url.href) return cachedProxy.dispatcher

  const dispatcher = new ProxyAgent(url.href)
  cachedProxy = { url: url.href, dispatcher }
  return dispatcher
}
```

Do not export this helper from `packages/telegram/src/index.ts`; it is an internal transport detail.

- [ ] **Step 5: Attach the dispatcher only to the built-in fetch path**

At the top of `packages/telegram/src/api.ts`, add:

```ts
import type { Dispatcher } from 'undici'

import { telegramProxyDispatcher } from './proxy.ts'

type TelegramRequestInit = RequestInit & { dispatcher?: Dispatcher }
```

Inside `call`, build the request within the existing `try` block:

```ts
const init: TelegramRequestInit = {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
  signal: AbortSignal.timeout(timeoutMs),
}
if (!this.opts.fetchFn) {
  init.dispatcher = telegramProxyDispatcher()
}

const res = await fetchFn(`${this.baseUrl}/bot${this.token}/${method}`, init)
```

Keep dispatcher creation inside `try` so malformed deployment configuration returns the existing safe `{ ok: false, description: 'TypeError' }` shape.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run:

```bash
pnpm --filter @repo/telegram test -- api.test.ts
pnpm --filter @repo/telegram check-types
pnpm --filter @repo/telegram lint
```

Expected: all commands pass with zero warnings.

- [ ] **Step 7: Run the full Telegram package suite**

Run:

```bash
pnpm --filter @repo/telegram test
```

Expected: all Telegram API, delivery, fan-out, secret, and command tests pass.

- [ ] **Step 8: Commit the application boundary**

```bash
git add packages/telegram/src/proxy.ts packages/telegram/src/api.ts packages/telegram/test/api.test.ts packages/telegram/package.json pnpm-lock.yaml
git commit -m "feat(telegram): support dedicated outbound proxy"
```

---

### Task 2: Deployment configuration contract

**Files:**

- Create: `deploy/test/telegram-proxy-config.test.mjs`
- Modify: `.env.example:164-171`
- Modify: `deploy/.env.template:104-115`
- Modify: `turbo.json:96-102`
- Modify: `deploy/compose.yml:119-159`
- Modify: `.github/workflows/deploy.yml:121-125`

**Interfaces:**

- Consumes: GitHub production variable `TELEGRAM_PROXY_URL`.
- Produces: `TELEGRAM_PROXY_URL` in rendered production `.env` for Compose interpolation; a derived `.app.env` without that key for application runtime; plus `host.docker.internal` resolution in `web` and `engines`.
- Preserves: empty or unset proxy configuration leaves direct Telegram behavior unchanged.

**Scoped environment contract:**

- Production `.env` retains `TELEGRAM_PROXY_URL` only as a stable Compose interpolation source.
- The workflow creates `/tmp/.app.env` by filtering exactly `^TELEGRAM_PROXY_URL=` from `/tmp/.env`, and uploads both files to `/opt/anynote`.
- Every application service (`migrate`, `web`, `yjs`, `engines`, `agents`) uses `.app.env` as `env_file`.
- Only `web` and `engines` receive `TELEGRAM_PROXY_URL: ${TELEGRAM_PROXY_URL:-}` explicitly and receive the Docker host-gateway mapping. Every other resolved service must lack the key entirely, including when the proxy value is empty.

- [ ] **Step 1: Write a failing behavioral deployment contract test**

Create `deploy/test/telegram-proxy-config.test.mjs`:

```js
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const proxyUrl = 'http://host.docker.internal:40001'

async function resolvedCompose(telegramProxyUrl) {
  const directory = await mkdtemp(join(tmpdir(), 'anynote-compose-'))
  const composePath = join(directory, 'compose.yml')
  const envPath = join(directory, '.env')
  const appEnvPath = join(directory, '.app.env')

  try {
    await writeFile(composePath, await readFile(join(root, 'deploy/compose.yml')))
    await writeFile(
      envPath,
      [
        'FORM_TOKEN_SECRET=01234567890123456789012345678901',
        'ACME_EMAIL=ops@anynote.ru',
        'POSTGRES_PASSWORD=test',
        'S3_ACCESS_KEY=test',
        'S3_SECRET_KEY=test',
        'S3_BUCKET=test',
        'QDRANT__AUTH__BEARER_TOKEN=test',
        `TELEGRAM_PROXY_URL=${telegramProxyUrl}`,
      ].join('\n'),
    )
    await writeFile(
      appEnvPath,
      [
        'FORM_TOKEN_SECRET=01234567890123456789012345678901',
        'ACME_EMAIL=ops@anynote.ru',
        'POSTGRES_PASSWORD=test',
        'S3_ACCESS_KEY=test',
        'S3_SECRET_KEY=test',
        'S3_BUCKET=test',
        'QDRANT__AUTH__BEARER_TOKEN=test',
      ].join('\n'),
    )
    const composeEnv = { ...process.env }
    delete composeEnv.TELEGRAM_PROXY_URL
    const { stdout } = await execFileAsync(
      'docker',
      ['compose', '--env-file', envPath, '-f', composePath, 'config', '--format', 'json'],
      { env: composeEnv },
    )
    return JSON.parse(stdout)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('resolved Compose routes only Telegram-capable services to the host bridge', async () => {
  const compose = await resolvedCompose(proxyUrl)
  const proxyServiceNames = new Set(['web', 'engines'])

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (proxyServiceNames.has(serviceName)) {
      assert.equal(service.environment.TELEGRAM_PROXY_URL, proxyUrl)
      assert.deepEqual(service.extra_hosts, ['host.docker.internal=host-gateway'])
      continue
    }

    assert.equal(Object.hasOwn(service.environment ?? {}, 'TELEGRAM_PROXY_URL'), false)
    assert.equal(service.extra_hosts, undefined)
  }
})

test('resolved Compose preserves an explicitly disabled Telegram proxy', async () => {
  const compose = await resolvedCompose('')
  assert.equal(compose.services.web.environment.TELEGRAM_PROXY_URL, '')
  assert.equal(compose.services.engines.environment.TELEGRAM_PROXY_URL, '')

  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (serviceName === 'web' || serviceName === 'engines') continue

    assert.equal(Object.hasOwn(service.environment ?? {}, 'TELEGRAM_PROXY_URL'), false)
  }
})

test('resolved Compose ignores an ambient Telegram proxy URL', async () => {
  const previousProxyUrl = process.env.TELEGRAM_PROXY_URL
  process.env.TELEGRAM_PROXY_URL = 'http://external.invalid:49999'

  try {
    const compose = await resolvedCompose(proxyUrl)
    assert.equal(compose.services.web.environment.TELEGRAM_PROXY_URL, proxyUrl)
    assert.equal(compose.services.engines.environment.TELEGRAM_PROXY_URL, proxyUrl)
  } finally {
    if (previousProxyUrl === undefined) {
      delete process.env.TELEGRAM_PROXY_URL
    } else {
      process.env.TELEGRAM_PROXY_URL = previousProxyUrl
    }
  }
})
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run:

```bash
node --test deploy/test/telegram-proxy-config.test.mjs
```

Expected: both tests fail because the current shared `env_file: .env` leaks `TELEGRAM_PROXY_URL` to non-target services. The fixture creates an isolated production-shaped `.env` containing the configured or empty proxy value and a corresponding `.app.env` without the key.

- [ ] **Step 3: Add the environment contract**

Add this directly after `TELEGRAM_API_BASE_URL` in `.env.example` and `deploy/.env.template`:

```dotenv
# Optional HTTP CONNECT proxy used only by @repo/telegram.
TELEGRAM_PROXY_URL=
```

Use the rendered form in `deploy/.env.template`:

```dotenv
TELEGRAM_PROXY_URL=${TELEGRAM_PROXY_URL}
```

Add `"TELEGRAM_PROXY_URL"` directly after `"TELEGRAM_API_BASE_URL"` in `turbo.json`.

Add the GitHub production variable to the `Render .env from template` environment block:

```yaml
TELEGRAM_PROXY_URL: ${{ vars.TELEGRAM_PROXY_URL }}
```

Immediately after rendering `/tmp/.env`, derive the application runtime file and upload both artifacts:

```bash
grep -v '^TELEGRAM_PROXY_URL=' /tmp/.env > /tmp/.app.env
chmod 600 /tmp/.app.env
```

```bash
scp -P "$DEPLOY_PORT" /tmp/.env \
  "$DEPLOY_USER@$DEPLOY_HOST:/opt/anynote/.env"
scp -P "$DEPLOY_PORT" /tmp/.app.env \
  "$DEPLOY_USER@$DEPLOY_HOST:/opt/anynote/.app.env"
```

- [ ] **Step 4: Add scoped Docker host mappings**

Change every application service (`migrate`, `web`, `yjs`, `engines`, and `agents`) to use the derived runtime file:

```yaml
env_file: .app.env
```

Add the explicit proxy value and host mapping to `web` and `engines` only, preserving their existing `FORM_TOKEN_SECRET` entries:

```yaml
environment:
  TELEGRAM_PROXY_URL: ${TELEGRAM_PROXY_URL:-}
extra_hosts:
  - 'host.docker.internal:host-gateway'
```

Do not add the explicit proxy setting or mapping to `migrate`, `yjs`, `agents`, Traefik, databases, or storage services. The resulting environments of every non-target service must omit `TELEGRAM_PROXY_URL`, not merely set it to an empty string.

- [ ] **Step 5: Run deployment contract and Compose validation**

Run:

```bash
node --test deploy/test/telegram-proxy-config.test.mjs
FORM_TOKEN_SECRET=01234567890123456789012345678901 \
  ACME_EMAIL=ops@anynote.ru \
  POSTGRES_PASSWORD=test \
  S3_ACCESS_KEY=test \
  S3_SECRET_KEY=test \
  S3_BUCKET=test \
  docker compose -f deploy/compose.yml config --quiet
```

Expected: the Node test passes and Compose exits zero. The Node verifier creates both temporary `.env` and `.app.env` files, executes configured and disabled proxy cases through Compose's parser, and checks every resolved service; warnings for unrelated optional empty variables are acceptable, interpolation errors are not.

- [ ] **Step 6: Confirm the proxy is not global**

Run:

```bash
rg -n 'HTTP_PROXY|HTTPS_PROXY|ALL_PROXY' .env.example deploy/.env.template deploy/compose.yml .github/workflows/deploy.yml
```

Expected: no new global outbound proxy variable appears in these files.

- [ ] **Step 7: Commit deployment wiring**

```bash
git add .env.example deploy/.env.template turbo.json deploy/compose.yml .github/workflows/deploy.yml deploy/test/telegram-proxy-config.test.mjs
git commit -m "chore(deploy): wire Telegram proxy endpoint"
```

---

### Task 3: Reproducible WARP and bridge operations

**Files:**

- Create: `deploy/warp/install.sh`
- Create: `deploy/warp/anynote-warp-bridge.service`
- Create: `deploy/test/warp-assets.test.mjs`
- Modify: `deploy/README.md`
- Modify: `.github/workflows/deploy.yml:179-198`

**Interfaces:**

- Consumes: official Cloudflare apt repository, Docker daemon, systemd, and local proxy capability from `warp-cli`.
- Produces: `/etc/default/anynote-warp-bridge`, `anynote-warp-bridge.service`, and an HTTP CONNECT endpoint at `host.docker.internal:40001` reachable only through Docker host networking.
- Commands: `deploy/warp/install.sh check|install|status|disable`.

- [ ] **Step 1: Write failing behavioral installer tests**

Create `deploy/test/warp-assets.test.mjs` as a temporary fake-host harness. It must execute `deploy/warp/install.sh` with `PATH`-injected stubs for `id`, `dpkg`, `docker`, `systemctl`, `apt-get`, `curl`, `gpg`, `warp-cli`, `ip`, `ss`, and `sleep`. Every stub appends its invocation to a trace file and returns scenario-controlled output. Use temporary paths for the OS release file, apt keyring/list, bridge environment file, and installed unit; do not read or regex-match the installer or unit source as the assertion.

Cover these observable behaviors:

1. `check` exits zero on a fake Ubuntu 22.04 `amd64` host and probes only the official Cloudflare package endpoint.
2. `install` exits nonzero when `warp-cli mode --help` omits `proxy:`; the trace proves `mode proxy` and bridge activation never occurred.
3. `install` disconnects and exits nonzero when the default route differs after connection; the bridge files are not installed.
4. A successful `install` writes `BRIDGE_PORT=40001`, the discovered Docker host gateway, and the discovered WARP loopback port to the temporary bridge environment file; installs the unit; and enables both services. The trace proves capability inspection occurred before `mode proxy` and that neither full-tunnel mode nor a public bind was selected.
5. `disable` stops the bridge and disconnects WARP without removing packages or generated configuration.
6. The checked-in installer mode is `0755` so `rsync -a` preserves executability.

The tests may parse generated temporary files because those are runtime effects. They must not assert that the source contains or omits a string.

- [ ] **Step 2: Run behavioral tests and confirm RED**

Run:

```bash
node --test deploy/test/warp-assets.test.mjs
```

Expected: failure because the executable installer and its fake-host interfaces do not exist.

- [ ] **Step 3: Add the hardened systemd unit**

Create `deploy/warp/anynote-warp-bridge.service`:

```ini
[Unit]
Description=AnyNote Docker bridge to Cloudflare WARP local proxy
After=docker.service warp-svc.service
Requires=docker.service warp-svc.service

[Service]
Type=simple
EnvironmentFile=/etc/default/anynote-warp-bridge
ExecStart=/usr/bin/socat TCP-LISTEN:${BRIDGE_PORT},bind=${DOCKER_HOST_GATEWAY},reuseaddr,fork TCP:127.0.0.1:${WARP_PROXY_PORT}
Restart=always
RestartSec=2
User=nobody
Group=nogroup
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
RestrictAddressFamilies=AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Implement the idempotent installer**

Create `deploy/warp/install.sh` with these exact operational boundaries:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly BRIDGE_PORT=40001
readonly BRIDGE_ENV="${ANYNOTE_WARP_BRIDGE_ENV:-/etc/default/anynote-warp-bridge}"
readonly BRIDGE_UNIT="${ANYNOTE_WARP_BRIDGE_UNIT:-/etc/systemd/system/anynote-warp-bridge.service}"
readonly OS_RELEASE_FILE="${ANYNOTE_WARP_OS_RELEASE_FILE:-/etc/os-release}"
readonly WARP_KEYRING="${ANYNOTE_WARP_KEYRING:-/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg}"
readonly WARP_APT_LIST="${ANYNOTE_WARP_APT_LIST:-/etc/apt/sources.list.d/cloudflare-client.list}"
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_supported_host() {
  [[ $(id -u) -eq 0 ]] || die 'run as root'
  [[ -r ${OS_RELEASE_FILE} ]] || die 'cannot read OS release metadata'
  # shellcheck disable=SC1091
  . "${OS_RELEASE_FILE}"
  [[ ${ID} == ubuntu && ${VERSION_ID} == 22.04 ]] || die 'expected Ubuntu 22.04'
  [[ $(dpkg --print-architecture) == amd64 ]] || die 'expected amd64'
  command -v docker >/dev/null || die 'docker is required'
  command -v systemctl >/dev/null || die 'systemd is required'
}

install_packages() {
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg lsb-release socat
  curl -fsSL https://pkg.cloudflareclient.com/pubkey.gpg \
    | gpg --batch --yes --dearmor --output "${WARP_KEYRING}"
  printf 'deb [signed-by=%s] https://pkg.cloudflareclient.com/ jammy main\n' "${WARP_KEYRING}" \
    > "${WARP_APT_LIST}"
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y cloudflare-warp
  systemctl enable --now warp-svc.service
}

configure_local_proxy() {
  local default_route_before default_route_after
  default_route_before=$(ip route show default)

  warp-cli --accept-tos registration show >/dev/null 2>&1 \
    || warp-cli --accept-tos registration new

  warp-cli --accept-tos mode --help 2>&1 \
    | grep -Eq '(^|[[:space:]])proxy:' \
    || die 'installed WARP client does not support local proxy mode'

  warp-cli --accept-tos tunnel protocol set MASQUE
  warp-cli --accept-tos mode proxy
  warp-cli --accept-tos connect

  for _ in $(seq 1 30); do
    warp-cli --accept-tos status 2>&1 | grep -q 'Connected' && break
    sleep 1
  done
  warp-cli --accept-tos status 2>&1 | grep -q 'Connected' \
    || die 'WARP did not connect in local proxy mode'

  default_route_after=$(ip route show default)
  if [[ ${default_route_before} != "${default_route_after}" ]]; then
    warp-cli --accept-tos disconnect
    die 'WARP changed the default route; disconnected'
  fi
}

detect_warp_proxy_port() {
  local port
  port=$(ss -lntpH \
    | awk '$4 ~ /^127\.0\.0\.1:/ && $0 ~ /warp-svc/ {n=split($4,a,":"); print a[n]; exit}')
  [[ ${port} =~ ^[0-9]+$ ]] || die 'cannot discover WARP loopback proxy port'
  printf '%s\n' "${port}"
}

detect_docker_host_gateway() {
  local gateway
  gateway=$(docker run --rm --add-host=host.docker.internal:host-gateway busybox:1.36 \
    getent hosts host.docker.internal | awk 'NR == 1 {print $1}')
  [[ ${gateway} =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] \
    || die 'cannot discover Docker host-gateway address'
  printf '%s\n' "${gateway}"
}

install_bridge() {
  local warp_proxy_port docker_host_gateway env_tmp
  warp_proxy_port=$(detect_warp_proxy_port)
  docker_host_gateway=$(detect_docker_host_gateway)
  env_tmp=$(mktemp)
  trap 'rm -f "${env_tmp}"' RETURN

  {
    printf 'BRIDGE_PORT=%s\n' "${BRIDGE_PORT}"
    printf 'DOCKER_HOST_GATEWAY=%s\n' "${docker_host_gateway}"
    printf 'WARP_PROXY_PORT=%s\n' "${warp_proxy_port}"
  } > "${env_tmp}"

  install -m 0644 "${env_tmp}" "${BRIDGE_ENV}"
  install -m 0644 "${SCRIPT_DIR}/anynote-warp-bridge.service" "${BRIDGE_UNIT}"
  systemctl daemon-reload
  systemctl enable --now anynote-warp-bridge.service
}

status() {
  systemctl is-active warp-svc.service
  systemctl is-active anynote-warp-bridge.service
  warp-cli --accept-tos status
  ss -lntH | grep -E ":${BRIDGE_PORT}[[:space:]]"
}

disable_proxy() {
  systemctl disable --now anynote-warp-bridge.service
  warp-cli --accept-tos disconnect
}

main() {
  require_supported_host
  case "${1:-}" in
    check)
      curl -fsS --connect-timeout 8 --max-time 12 https://pkg.cloudflareclient.com/ >/dev/null
      ;;
    install)
      install_packages
      configure_local_proxy
      install_bridge
      status
      ;;
    status)
      status
      ;;
    disable)
      disable_proxy
      ;;
    *)
      die 'usage: install.sh check|install|status|disable'
      ;;
  esac
}

main "$@"
```

Make the versioned installer executable so `rsync -a` preserves the mode:

```bash
chmod 0755 deploy/warp/install.sh
```

Do not add package removal to `disable`; emergency rollback must remain fast and reversible.

- [ ] **Step 5: Add the operator runbook**

Append a `Telegram WARP egress` section to `deploy/README.md` containing:

```bash
sudo /opt/anynote/warp/install.sh check
sudo /opt/anynote/warp/install.sh install
sudo /opt/anynote/warp/install.sh status
sudo /opt/anynote/warp/install.sh disable
```

Document these invariants next to the commands:

- `install` must report WARP `Connected` in proxy mode.
- `ip route show default` must be unchanged.
- port `40001` must listen only on the Docker host-gateway address.
- `disable` is the infrastructure rollback and does not uninstall packages.

- [ ] **Step 6: Sync WARP assets in the deployment workflow**

In `.github/workflows/deploy.yml`, extend the exact managed directories:

```yaml
ssh -p "$DEPLOY_PORT" "$DEPLOY_USER@$DEPLOY_HOST" \
"mkdir -p /opt/anynote/traefik/dynamic /opt/anynote/postgres-init /opt/anynote/warp"
```

Add this rsync after `deploy/postgres-init/`:

```yaml
rsync -avz --delete \
-e "ssh -p $DEPLOY_PORT" \
deploy/warp/ \
"$DEPLOY_USER@$DEPLOY_HOST:/opt/anynote/warp/"
```

The workflow syncs the installer but does not execute it automatically.

- [ ] **Step 7: Run static, syntax, and formatting checks**

Run:

```bash
node --test deploy/test/warp-assets.test.mjs
bash -n deploy/warp/install.sh
pnpm exec prettier --check deploy/README.md .github/workflows/deploy.yml
```

Expected: all commands pass. The behavioral harness proves fail-closed mode selection, unchanged routing, private generated bridge configuration, and reversible disable behavior.

- [ ] **Step 8: Commit operations assets**

```bash
git add deploy/warp/install.sh deploy/warp/anynote-warp-bridge.service deploy/test/warp-assets.test.mjs deploy/README.md .github/workflows/deploy.yml
git commit -m "chore(deploy): add WARP proxy bootstrap"
```

---

### Task 4: Branch verification and review

**Files:**

- Verify only; no new files.

**Interfaces:**

- Consumes: Tasks 1-3 commits.
- Produces: reviewed branch `codex/telegram-warp-proxy` ready to merge and deploy.

- [ ] **Step 1: Run task-scoped gates**

```bash
pnpm --filter @repo/telegram test
pnpm --filter @repo/telegram check-types
pnpm --filter @repo/telegram lint
node --test deploy/test/telegram-proxy-config.test.mjs deploy/test/warp-assets.test.mjs
bash -n deploy/warp/install.sh
```

Expected: every command passes.

- [ ] **Step 2: Validate formatting and whitespace**

```bash
pnpm exec prettier --check \
  packages/telegram/src/api.ts \
  packages/telegram/src/proxy.ts \
  packages/telegram/test/api.test.ts \
  packages/telegram/package.json \
  .env.example \
  deploy/.env.template \
  deploy/compose.yml \
  deploy/README.md \
  .github/workflows/deploy.yml \
  turbo.json
git diff --check HEAD~3..HEAD
```

Expected: formatting and whitespace checks pass.

- [ ] **Step 3: Review the complete branch diff**

```bash
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/telegram \
  deploy \
  .env.example \
  turbo.json \
  .github/workflows/deploy.yml
```

Confirm the diff contains no bot token, chat ID, proxy credential, global proxy variable, public port mapping, or unrelated user changes.

- [ ] **Step 4: Request code review**

Use `superpowers:requesting-code-review`. Resolve all correctness and security findings before publishing.

- [ ] **Step 5: Push and open a focused PR**

```bash
git push -u origin codex/telegram-warp-proxy
gh pr create \
  --base main \
  --head codex/telegram-warp-proxy \
  --title "feat(telegram): route Bot API through optional WARP proxy" \
  --body "Adds per-request Telegram proxy routing, Docker host-gateway wiring, and a fail-closed WARP local-proxy runbook. No production proxy is enabled by this PR alone."
```

- [ ] **Step 6: Wait for CI and merge**

```bash
gh pr checks --watch
gh pr merge --squash --delete-branch
```

If branch protection requires human approval, stop and report the PR URL instead of bypassing it.

---

### Task 5: Behavior-preserving production deployment

**Files:**

- Production deployment only; no repository edits.

**Interfaces:**

- Consumes: merged application and deployment support with GitHub production variable still unset.
- Produces: new images and Compose host mappings in production while Telegram remains on the existing direct path.

- [ ] **Step 1: Verify the production variable is absent**

Run locally:

```bash
if gh variable list --env production | rg -q '^TELEGRAM_PROXY_URL\b'; then
  printf 'ERROR: production TELEGRAM_PROXY_URL is already set\n' >&2
  exit 1
fi
```

Expected: no production `TELEGRAM_PROXY_URL` variable exists. If it already exists, inspect it without printing credentials and stop before deployment.

- [ ] **Step 2: Deploy merged code from main**

```bash
PREVIOUS_DEPLOY_RUN_ID=$(gh run list \
  --workflow deploy.yml \
  --branch main \
  --event workflow_dispatch \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId // empty')
gh workflow run deploy.yml --ref main

DEPLOY_RUN_ID=''
for _ in $(seq 1 30); do
  CANDIDATE_DEPLOY_RUN_ID=$(gh run list \
    --workflow deploy.yml \
    --branch main \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')
  if [[ -n ${CANDIDATE_DEPLOY_RUN_ID} && ${CANDIDATE_DEPLOY_RUN_ID} != "${PREVIOUS_DEPLOY_RUN_ID}" ]]; then
    DEPLOY_RUN_ID=${CANDIDATE_DEPLOY_RUN_ID}
    break
  fi
  sleep 2
done
[[ -n ${DEPLOY_RUN_ID} ]] || { printf 'ERROR: dispatched deploy run was not found\n' >&2; exit 1; }
gh run watch "${DEPLOY_RUN_ID}" --exit-status
```

Expected: build and deploy jobs succeed.

- [ ] **Step 3: Verify containers and disabled proxy state**

```bash
ssh -p 2222 root@77.105.170.20 \
  "cd /opt/anynote && docker compose ps && \
   docker exec anynote-web-1 node -e \"console.log(process.env.TELEGRAM_PROXY_URL ? 'set' : 'unset')\" && \
   docker exec anynote-engines-1 node -e \"console.log(process.env.TELEGRAM_PROXY_URL ? 'set' : 'unset')\""
```

Expected: required containers are running and both commands print `unset`.

- [ ] **Step 4: Confirm existing behavior is unchanged**

Run a redacted `getMe` probe in `web` without printing the token or URL. Expected: the same timeout-class failure observed before this change. Do not submit another public lead at this stage.

---

### Task 6: Install and verify WARP infrastructure

**Files:**

- Production host: `/opt/anynote/warp/*`
- Production host: `/etc/default/anynote-warp-bridge`
- Production host: `/etc/systemd/system/anynote-warp-bridge.service`

**Interfaces:**

- Consumes: synced Task 3 assets.
- Produces: private HTTP CONNECT endpoint `http://host.docker.internal:40001`.

- [ ] **Step 1: Capture pre-install network state**

```bash
ssh -p 2222 root@77.105.170.20 \
  "ip route show default; ss -lntp | grep ':40001 ' || true; systemctl is-active warp-svc 2>/dev/null || true"
```

Record the default route. Port `40001` must not already be occupied.

- [ ] **Step 2: Run the read-only capability check**

```bash
ssh -p 2222 root@77.105.170.20 \
  "chmod 0755 /opt/anynote/warp/install.sh && /opt/anynote/warp/install.sh check"
```

Expected: Ubuntu/architecture checks pass and the official Cloudflare package repository is reachable.

- [ ] **Step 3: Install WARP and the bridge**

```bash
ssh -p 2222 root@77.105.170.20 \
  "/opt/anynote/warp/install.sh install"
```

Expected: free registration succeeds, local proxy mode is advertised, WARP connects over MASQUE, the default route is unchanged, and both services are active.

If local proxy mode is absent or the default route changes, the installer must disconnect and exit nonzero. Stop the task; do not substitute full-tunnel mode.

- [ ] **Step 4: Verify listener isolation**

```bash
ssh -p 2222 root@77.105.170.20 <<'REMOTE'
set -euo pipefail
. /etc/default/anynote-warp-bridge
/opt/anynote/warp/install.sh status
BRIDGE_LISTENERS=$(ss -lntH "sport = :${BRIDGE_PORT}")
test "$(printf '%s\n' "${BRIDGE_LISTENERS}" | wc -l)" -eq 1
printf '%s\n' "${BRIDGE_LISTENERS}" | grep -Fq "${DOCKER_HOST_GATEWAY}:${BRIDGE_PORT}"
REMOTE
```

Expected: `40001` is bound exactly once to the discovered Docker host-gateway address.

- [ ] **Step 5: Probe HTTPS through the bridge without a bot token**

After Task 5 has added `host.docker.internal`, use a pinned disposable curl container to prove the Docker host mapping, HTTP CONNECT path, and end-to-end TLS independently of the application image:

```bash
ssh -p 2222 root@77.105.170.20 <<'REMOTE'
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  curlimages/curl:8.14.1@sha256:e4618c47d1f3c5446937eca7fc516085121b3ab3672bd97935898e97d2662532 \
  --silent \
  --show-error \
  --connect-timeout 8 \
  --max-time 12 \
  --proxy http://host.docker.internal:40001 \
  --output /dev/null \
  --write-out 'HTTP_STATUS=%{http_code}\n' \
  https://api.telegram.org/
REMOTE
```

Expected: an HTTP status is printed within twelve seconds. Curl exits nonzero on any proxy, TLS, or timeout failure; the response body is discarded.

- [ ] **Step 6: Probe the shared Telegram client through the bridge**

Run the shared Telegram client from the `engines` container with a one-command proxy override. The standalone `web` image does not expose workspace packages to ad hoc Node imports, so this redacted `engines` probe verifies the shared client; Task 7's real `contact.submit` call verifies the `web` path. `getMe` is non-mutating:

```bash
ssh -p 2222 root@77.105.170.20 <<'REMOTE'
docker exec \
  -e TELEGRAM_PROXY_URL=http://host.docker.internal:40001 \
  anynote-engines-1 \
  node --input-type=module -e "
    import { TelegramApi } from '@repo/telegram';
    const result = await new TelegramApi(process.env.TELEGRAM_BOT_TOKEN).getMe();
    console.log(JSON.stringify({ ok: result.ok, description: result.ok ? undefined : result.description }));
    process.exit(result.ok ? 0 : 1);
  "
REMOTE
```

Expected: `{"ok":true}` within ten seconds. This proves Docker-to-bridge routing, HTTP CONNECT support, TLS preservation, and bot authentication without printing bot identity or credentials.

- [ ] **Step 7: Verify public port closure**

Run from the local workstation:

```bash
if nc -zvw3 77.105.170.20 40001; then
  printf 'ERROR: bridge port is reachable publicly\n' >&2
  exit 1
fi
```

Expected: the public connection fails.

- [ ] **Step 8: Roll back infrastructure on any failed gate**

```bash
ssh -p 2222 root@77.105.170.20 \
  "/opt/anynote/warp/install.sh disable"
```

Expected: the bridge is stopped and WARP is disconnected. Do not remove packages or configuration while diagnosing.

---

### Task 7: Enable Telegram proxying and send the test lead

**Files:**

- GitHub production variable: `TELEGRAM_PROXY_URL`
- Production `/opt/anynote/.env` rendered by the deploy workflow.

**Interfaces:**

- Consumes: verified endpoint `http://host.docker.internal:40001`.
- Produces: successful Telegram `getMe` and public `contact.submit` delivery.

- [ ] **Step 1: Set the scoped production variable**

```bash
gh variable set TELEGRAM_PROXY_URL \
  --env production \
  --body 'http://host.docker.internal:40001'
```

Expected: the value is stored as a non-secret internal endpoint; it contains no credentials.

- [ ] **Step 2: Deploy the enabled configuration**

```bash
PREVIOUS_DEPLOY_RUN_ID=$(gh run list \
  --workflow deploy.yml \
  --branch main \
  --event workflow_dispatch \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId // empty')
gh workflow run deploy.yml --ref main

DEPLOY_RUN_ID=''
for _ in $(seq 1 30); do
  CANDIDATE_DEPLOY_RUN_ID=$(gh run list \
    --workflow deploy.yml \
    --branch main \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')
  if [[ -n ${CANDIDATE_DEPLOY_RUN_ID} && ${CANDIDATE_DEPLOY_RUN_ID} != "${PREVIOUS_DEPLOY_RUN_ID}" ]]; then
    DEPLOY_RUN_ID=${CANDIDATE_DEPLOY_RUN_ID}
    break
  fi
  sleep 2
done
[[ -n ${DEPLOY_RUN_ID} ]] || { printf 'ERROR: dispatched deploy run was not found\n' >&2; exit 1; }
gh run watch "${DEPLOY_RUN_ID}" --exit-status
```

Expected: deployment succeeds and only normal Compose recreation occurs.

- [ ] **Step 3: Verify the variable without printing secrets**

```bash
ssh -p 2222 root@77.105.170.20 \
  "docker exec anynote-web-1 node -e \"console.log(process.env.TELEGRAM_PROXY_URL === 'http://host.docker.internal:40001')\"; \
   docker exec anynote-engines-1 node -e \"console.log(process.env.TELEGRAM_PROXY_URL === 'http://host.docker.internal:40001')\""
```

Expected: both commands print `true`.

- [ ] **Step 4: Run a redacted bot-authentication probe**

```bash
ssh -p 2222 root@77.105.170.20 <<'REMOTE'
docker exec anynote-engines-1 node --input-type=module -e "
  import { TelegramApi } from '@repo/telegram';
  const result = await new TelegramApi(process.env.TELEGRAM_BOT_TOKEN).getMe();
  console.log(JSON.stringify({ ok: result.ok, description: result.ok ? undefined : result.description }));
  process.exit(result.ok ? 0 : 1);
"
REMOTE
```

Expected: `{"ok":true}`. The command must not print bot identity, token, or request URL.

- [ ] **Step 5: Submit one marked production test lead**

Run from the local workstation:

```bash
curl --fail-with-body --silent --show-error \
  'https://anynote.ru/api/trpc/contact.submit' \
  -H 'content-type: application/json' \
  -H 'origin: https://anynote.ru' \
  --data-binary '{"name":"Тест WARP","company":"AnyNote","email":"test+warp-20260801@anynote.ru","phone":"+7 000 000-00-00","message":"Тестовая заявка после настройки Cloudflare WARP. Можно игнорировать.","consentPersonalData":true,"consentMarketing":true}'
```

Expected: HTTP 200 with an `ok: true` tRPC result. That response is returned only after Telegram accepts `sendMessage`.

- [ ] **Step 6: Check service health and secret-safe logs**

```bash
ssh -p 2222 root@77.105.170.20 <<'REMOTE'
set -euo pipefail
cd /opt/anynote
docker compose ps
if docker compose logs --since=10m web engines 2>&1 \
  | grep -Eq 'TELEGRAM_BOT_TOKEN|bot[0-9]+:|test\+warp-20260801@anynote.ru'; then
  printf 'ERROR: sensitive Telegram pattern found in logs\n' >&2
  exit 1
fi
/opt/anynote/warp/install.sh status
REMOTE
```

Expected: containers and WARP services are healthy, and the grep emits no token pattern or lead email.

- [ ] **Step 7: Execute scoped rollback if enablement fails**

Only if Steps 2-6 fail:

```bash
gh variable delete TELEGRAM_PROXY_URL --env production

PREVIOUS_DEPLOY_RUN_ID=$(gh run list \
  --workflow deploy.yml \
  --branch main \
  --event workflow_dispatch \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId // empty')
gh workflow run deploy.yml --ref main

DEPLOY_RUN_ID=''
for _ in $(seq 1 30); do
  CANDIDATE_DEPLOY_RUN_ID=$(gh run list \
    --workflow deploy.yml \
    --branch main \
    --event workflow_dispatch \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty')
  if [[ -n ${CANDIDATE_DEPLOY_RUN_ID} && ${CANDIDATE_DEPLOY_RUN_ID} != "${PREVIOUS_DEPLOY_RUN_ID}" ]]; then
    DEPLOY_RUN_ID=${CANDIDATE_DEPLOY_RUN_ID}
    break
  fi
  sleep 2
done
[[ -n ${DEPLOY_RUN_ID} ]] || { printf 'ERROR: rollback deploy run was not found\n' >&2; exit 1; }
gh run watch "${DEPLOY_RUN_ID}" --exit-status
ssh -p 2222 root@77.105.170.20 \
  "/opt/anynote/warp/install.sh disable"
```

Expected: `web` and `engines` return to direct Telegram behavior; all unrelated AnyNote services stay online.

- [ ] **Step 8: Record final evidence**

Report:

- merged commit and deployment run URL;
- WARP mode and bridge bind address, without IDs or credentials;
- redacted `getMe` result;
- contact endpoint HTTP status;
- whether Telegram accepted the marked test lead;
- final container and service health;
- whether rollback was needed.
