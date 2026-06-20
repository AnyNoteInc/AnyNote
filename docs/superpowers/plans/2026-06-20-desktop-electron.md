# Desktop Electron Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cross-platform Electron thin-client (`apps/desktop`) that loads the remote AnyNote server (default `https://anynote.ru`, or a self-hosted URL), identifies itself as a desktop client, auto-updates, and is offered for download from the home page.

**Architecture:** Electron app with three layers — `main` (windows, menu, server selection, custom User-Agent, electron-store, auto-update), `preload` (contextBridge → `window.anynote`), and a local `renderer` screen used only for first-run server selection. All product UI comes from the remote server, so the desktop tracks server changes automatically. A 3-runner CI matrix builds native installers on each `v*` tag and publishes them to the same GitHub Release. The web app gets a `HomeDownload` section and recognizes the desktop User-Agent in its session list.

**Tech Stack:** Electron, electron-builder, electron-updater, electron-store, TypeScript, Vitest (node env), esbuild (bundling main/preload), Next.js/React/MUI (web side), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-20-desktop-electron-design.md`

**Repo:** `github.com/AnyNoteInc/AnyNote` — used for GitHub Release asset URLs and electron-updater `provider: github` (`owner: AnyNoteInc`, `repo: AnyNote`).

---

## File Structure

```
apps/desktop/
  package.json                      # name "desktop", electron deps, scripts
  tsconfig.json                     # extends @repo/typescript-config base
  electron-builder.yml              # build targets: mac dmg/zip, win nsis, linux AppImage/deb
  vitest.config.ts                  # node env, test/ folder
  esbuild.config.mjs                # bundles main + preload to dist/
  src/
    main/
      index.ts                      # app entry: create window, wire menu/update
      config.ts                     # electron-store wrapper (serverUrl get/set/clear)
      server-url.ts                 # PURE: normalizeServerUrl, isValidServerUrl
      health-check.ts               # pingHealth(url, fetchFn) → boolean
      user-agent.ts                 # PURE: buildDesktopUserAgent(base, info)
      window.ts                     # createMainWindow(serverUrl), createSelectionWindow()
      menu.ts                       # application menu incl. "Change server"
      updater.ts                    # electron-updater wiring
    preload/
      index.ts                      # contextBridge → window.anynote + IPC
      api.ts                        # PURE: buildAnynoteApi(platform, arch, version)
    renderer/
      selection.html               # local first-run server picker markup
      selection.ts                  # picker logic: validate + submit via IPC
  test/
    server-url.test.ts
    health-check.test.ts
    user-agent.test.ts
    api.test.ts

apps/web/  (modifications)
  src/lib/parse-user-agent.ts       # extend: recognize AnyNote-Desktop UA
  src/lib/download-links.ts         # NEW: detectOS + assetUrl helpers (pure)
  src/components/public/home/home-download.tsx   # NEW section component
  src/app/page.tsx                  # insert <HomeDownload/> first in <main>
  test/parse-user-agent.test.ts     # NEW
  test/download-links.test.ts       # NEW

.github/workflows/desktop.yml       # NEW: matrix build on v* tag
```

**Design notes:**
- `server-url.ts`, `user-agent.ts`, `api.ts`, `health-check.ts` (with injected `fetch`), and the web `download-links.ts`/`parse-user-agent.ts` are **pure** so they're unit-testable without Electron or a browser. Electron-touching files (`index.ts`, `window.ts`, `menu.ts`, `updater.ts`, `config.ts`) are thin glue and are not unit-tested in v1.
- `apps/desktop` depends on **no** `@repo/*` runtime package (keeps Next/Prisma/MUI out). It may extend `@repo/typescript-config` for tsconfig only.

---

## Task 1: Scaffold `apps/desktop` package

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/vitest.config.ts`
- Create: `apps/desktop/.gitignore`

- [ ] **Step 1: Create `apps/desktop/package.json`**

```json
{
  "name": "desktop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/main/index.js",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "node esbuild.config.mjs --watch & electron .",
    "lint": "eslint --max-warnings 0 src",
    "check-types": "tsc --noEmit",
    "test": "vitest run",
    "dist": "pnpm build && electron-builder",
    "dist:mac": "pnpm build && electron-builder --mac",
    "dist:win": "pnpm build && electron-builder --win",
    "dist:linux": "pnpm build && electron-builder --linux"
  },
  "dependencies": {
    "electron-store": "^10.0.0",
    "electron-updater": "^6.3.9"
  },
  "devDependencies": {
    "@repo/eslint-config": "workspace:*",
    "@repo/typescript-config": "workspace:*",
    "electron": "^33.2.0",
    "electron-builder": "^25.1.8",
    "esbuild": "^0.24.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `electron`, `electron-builder`, `esbuild` are devDependencies — they are not needed inside the packaged app. `electron-store` and `electron-updater` are runtime deps (bundled).

- [ ] **Step 2: Create `apps/desktop/tsconfig.json`**

```json
{
  "extends": "@repo/typescript-config/base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "esbuild.config.mjs", "vitest.config.ts"]
}
```

(If `@repo/typescript-config/base.json` does not exist, check `packages/typescript-config/` for the actual exported file name — e.g. `nextjs.json`/`react-library.json` — and extend the base one. Confirm with `cat packages/typescript-config/package.json`.)

- [ ] **Step 3: Create `apps/desktop/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 4: Create `apps/desktop/.gitignore`**

```
dist/
release/
node_modules/
```

- [ ] **Step 4b: Create `apps/desktop/eslint.config.mjs`** (flat config, mirrors `apps/yjs`)

The `lint` script needs a flat config to resolve. `@repo/eslint-config` exports a named `config` from `./base`:

```js
import { config } from '@repo/eslint-config/base'

/** @type {import("eslint").Linter.Config[]} */
export default config
```

Also add `@types/node`, `eslint`, and `typescript` to `devDependencies` (matching `apps/yjs`) so `lint` and `check-types` resolve their tools and `types: ["node"]` is satisfied.

- [ ] **Step 5: Install and verify the workspace picks up the new package**

Run: `pnpm install`
Expected: completes without error; `pnpm --filter desktop exec true` resolves the `desktop` filter.

Run: `pnpm --filter desktop exec node -e "console.log('desktop ok')"`
Expected: prints `desktop ok`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/package.json apps/desktop/tsconfig.json apps/desktop/vitest.config.ts apps/desktop/.gitignore pnpm-lock.yaml
git commit -m "chore(desktop): scaffold electron workspace package"
```

---

## Task 2: Pure server-URL normalization & validation

**Files:**
- Create: `apps/desktop/src/main/server-url.ts`
- Test: `apps/desktop/test/server-url.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { isValidServerUrl, normalizeServerUrl, DEFAULT_SERVER_URL } from '../src/main/server-url'

describe('normalizeServerUrl', () => {
  it('defaults to anynote.ru when given empty input', () => {
    expect(normalizeServerUrl('')).toBe('https://anynote.ru')
    expect(DEFAULT_SERVER_URL).toBe('https://anynote.ru')
  })

  it('adds https:// when scheme is missing', () => {
    expect(normalizeServerUrl('example.com')).toBe('https://example.com')
  })

  it('preserves an explicit http:// scheme (self-host LAN)', () => {
    expect(normalizeServerUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it('strips a trailing slash', () => {
    expect(normalizeServerUrl('https://anynote.ru/')).toBe('https://anynote.ru')
  })

  it('trims whitespace', () => {
    expect(normalizeServerUrl('  https://anynote.ru  ')).toBe('https://anynote.ru')
  })
})

describe('isValidServerUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isValidServerUrl('https://anynote.ru')).toBe(true)
    expect(isValidServerUrl('http://localhost:3000')).toBe(true)
  })

  it('rejects non-http schemes and garbage', () => {
    expect(isValidServerUrl('ftp://x')).toBe(false)
    expect(isValidServerUrl('not a url')).toBe(false)
    expect(isValidServerUrl('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop test server-url`
Expected: FAIL — cannot resolve `../src/main/server-url`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/server-url.ts
export const DEFAULT_SERVER_URL = 'https://anynote.ru'

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === '') return DEFAULT_SERVER_URL
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, '')
}

export function isValidServerUrl(input: string): boolean {
  try {
    const url = new URL(normalizeServerUrl(input))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
```

Important: empty input AND explicit non-http schemes both need guarding. `normalizeServerUrl('ftp://x')` wraps into `https://ftp://x` (no `https?://` prefix matched), which `new URL` parses as valid `https:` → would wrongly pass. Reject explicit non-http(s) schemes before normalizing:

```ts
export function isValidServerUrl(input: string): boolean {
  const trimmed = input.trim()
  if (trimmed === '') return false
  // Reject any explicit scheme that is not http(s); otherwise the missing-scheme
  // path would wrap e.g. "ftp://x" into "https://ftp://x" and wrongly pass.
  const explicitScheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)
  if (explicitScheme && !/^https?$/i.test(explicitScheme[1]!)) return false
  try {
    const url = new URL(normalizeServerUrl(trimmed))
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
```

`'not a url'` → `normalizeServerUrl` returns `https://not a url`; `new URL` throws on the space → `false`. Correct.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test server-url`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/server-url.ts apps/desktop/test/server-url.test.ts
git commit -m "feat(desktop): server-url normalization and validation"
```

---

## Task 3: Health-check ping (injected fetch)

**Files:**
- Create: `apps/desktop/src/main/health-check.ts`
- Test: `apps/desktop/test/health-check.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from 'vitest'
import { pingHealth } from '../src/main/health-check'

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as unknown as Response
}

describe('pingHealth', () => {
  it('returns true when /api/health responds { status: "ok" }', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(true)
    expect(fetchFn).toHaveBeenCalledWith(
      'https://anynote.ru/api/health',
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('returns false on non-ok HTTP status', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }, false))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(false)
  })

  it('returns false when body status is not "ok"', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ status: 'down' }))
    await expect(pingHealth('https://anynote.ru', fetchFn)).resolves.toBe(false)
  })

  it('returns false when fetch throws (unreachable host)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(pingHealth('https://nope.invalid', fetchFn)).resolves.toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop test health-check`
Expected: FAIL — cannot resolve `../src/main/health-check`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/health-check.ts
type FetchFn = (input: string, init?: { method?: string; signal?: AbortSignal }) => Promise<Response>

// timeoutMs aborts the request so the connect button never hangs on a
// firewalled host that accepts the connection but never responds.
export async function pingHealth(
  serverUrl: string,
  fetchFn: FetchFn,
  timeoutMs = 8000,
): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${serverUrl}/api/health`, {
      method: 'GET',
      signal: controller.signal,
    })
    if (!res.ok) return false
    const body = (await res.json()) as { status?: string }
    return body.status === 'ok'
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
```

Add a 5th test asserting the timeout path:

```ts
  it('returns false when the request exceeds the timeout', async () => {
    const fetchFn = vi.fn().mockImplementation((_url, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      }),
    )
    await expect(pingHealth('https://slow.invalid', fetchFn, 10)).resolves.toBe(false)
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test health-check`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/health-check.ts apps/desktop/test/health-check.test.ts
git commit -m "feat(desktop): health-check ping with injectable fetch"
```

---

## Task 4: Desktop User-Agent builder

**Files:**
- Create: `apps/desktop/src/main/user-agent.ts`
- Test: `apps/desktop/test/user-agent.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildDesktopUserAgent } from '../src/main/user-agent'

describe('buildDesktopUserAgent', () => {
  const base = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36'

  it('appends an AnyNote-Desktop token with version/platform/arch', () => {
    const ua = buildDesktopUserAgent(base, { version: '1.2.0', platform: 'darwin', arch: 'arm64' })
    expect(ua.startsWith(base)).toBe(true)
    expect(ua).toContain('AnyNote-Desktop/1.2.0')
    expect(ua).toContain('(darwin; arm64)')
  })

  it('produces a UA that the web parser can detect as desktop', () => {
    const ua = buildDesktopUserAgent(base, { version: '1.2.0', platform: 'win32', arch: 'x64' })
    expect(/AnyNote-Desktop\/[\d.]+/.test(ua)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop test user-agent`
Expected: FAIL — cannot resolve `../src/main/user-agent`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/main/user-agent.ts
export type DesktopInfo = { version: string; platform: string; arch: string }

export function buildDesktopUserAgent(base: string, info: DesktopInfo): string {
  return `${base} AnyNote-Desktop/${info.version} (${info.platform}; ${info.arch})`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test user-agent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/user-agent.ts apps/desktop/test/user-agent.test.ts
git commit -m "feat(desktop): desktop user-agent builder"
```

---

## Task 5: `window.anynote` API shape (preload-pure)

**Files:**
- Create: `apps/desktop/src/preload/api.ts`
- Test: `apps/desktop/test/api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { buildAnynoteApi } from '../src/preload/api'

describe('buildAnynoteApi', () => {
  it('exposes isDesktop, platform, arch, appVersion', () => {
    const api = buildAnynoteApi({ platform: 'darwin', arch: 'arm64', version: '1.2.0' })
    expect(api).toEqual({
      isDesktop: true,
      platform: 'darwin',
      arch: 'arm64',
      appVersion: '1.2.0',
    })
  })

  it('returns a frozen object (cannot be tampered by the remote site)', () => {
    const api = buildAnynoteApi({ platform: 'linux', arch: 'x64', version: '1.0.0' })
    expect(Object.isFrozen(api)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter desktop test api`
Expected: FAIL — cannot resolve `../src/preload/api`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/desktop/src/preload/api.ts
export type AnynoteApi = {
  isDesktop: true
  platform: string
  arch: string
  appVersion: string
}

export function buildAnynoteApi(info: { platform: string; arch: string; version: string }): AnynoteApi {
  return Object.freeze({
    isDesktop: true,
    platform: info.platform,
    arch: info.arch,
    appVersion: info.version,
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter desktop test api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/api.ts apps/desktop/test/api.test.ts
git commit -m "feat(desktop): window.anynote api shape"
```

---

## Task 6: electron-store config wrapper

**Files:**
- Create: `apps/desktop/src/main/config.ts`

This is thin Electron-touching glue (no unit test; verified manually when the app runs in Task 11).

- [ ] **Step 1: Write the implementation**

```ts
// apps/desktop/src/main/config.ts
import Store from 'electron-store'

type Schema = {
  serverUrl?: string
}

const store = new Store<Schema>({ name: 'anynote-desktop' })

export function getServerUrl(): string | undefined {
  return store.get('serverUrl')
}

export function setServerUrl(url: string): void {
  store.set('serverUrl', url)
}

export function clearServerUrl(): void {
  store.delete('serverUrl')
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter desktop check-types`
Expected: PASS (no type errors). If `electron-store`'s generic signature differs in the installed version, adjust to its API — confirm with `cat node_modules/electron-store/index.d.ts | head -40`.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/config.ts
git commit -m "feat(desktop): electron-store server-url config"
```

---

## Task 7: Preload bridge

**Files:**
- Create: `apps/desktop/src/preload/index.ts`

Thin glue (uses Electron `contextBridge`/`ipcRenderer`); not unit-tested.

- [ ] **Step 1: Write the implementation**

```ts
// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'
import { buildAnynoteApi } from './api'

// The main process injects --anynote-version=<v> via webPreferences.additionalArguments
// (Task 8). Read it from argv so the preload exposes the real app version.
const versionArg = process.argv.find((a) => a.startsWith('--anynote-version='))
const version = versionArg ? versionArg.split('=')[1] : '0.0.0'

contextBridge.exposeInMainWorld(
  'anynote',
  buildAnynoteApi({
    platform: process.platform,
    arch: process.arch,
    version,
  }),
)

// Minimal IPC the loaded site (or local selection screen) may use.
contextBridge.exposeInMainWorld('anynoteBridge', {
  changeServer: () => ipcRenderer.send('anynote:change-server'),
})
```

Note: the version comes from `--anynote-version=<v>`, which the main process sets via `webPreferences.additionalArguments` in Task 8 (`app.getVersion()`).

- [ ] **Step 2: Type-check**

Run: `pnpm --filter desktop check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): preload contextBridge for window.anynote"
```

---

## Task 8: Main window creation

**Files:**
- Create: `apps/desktop/src/main/window.ts`

Thin Electron glue; verified manually in Task 11.

- [ ] **Step 1: Write the implementation**

```ts
// apps/desktop/src/main/window.ts
import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { buildDesktopUserAgent } from './user-agent'

const PARTITION = 'persist:anynote'

function applyUserAgent(win: BrowserWindow): void {
  const base = win.webContents.getUserAgent()
  win.webContents.setUserAgent(
    buildDesktopUserAgent(base, {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    }),
  )
}

export function createMainWindow(serverUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 940,
    minHeight: 600,
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--anynote-version=${app.getVersion()}`],
    },
  })

  applyUserAgent(win)

  // Open external (non-server-origin) links in the system browser.
  // Compare parsed ORIGINS, not string prefixes — a prefix check would let
  // https://anynote.ru.evil.com through.
  const serverOrigin = new URL(serverUrl).origin
  win.webContents.setWindowOpenHandler(({ url }) => {
    let sameOrigin = false
    try {
      sameOrigin = new URL(url).origin === serverOrigin
    } catch {
      sameOrigin = false
    }
    if (!sameOrigin) {
      void shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  void win.loadURL(serverUrl)
  return win
}

export function createSelectionWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 520,
    height: 420,
    resizable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  void win.loadFile(join(__dirname, '../renderer/selection.html'))
  return win
}
```

Note: `additionalArguments` passes `--anynote-version=${app.getVersion()}` into the renderer/preload process; the preload (Task 7) already reads it from `process.argv`. No further change needed here.

- [ ] **Step 2: Type-check**

Run: `pnpm --filter desktop check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/window.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): main window with custom UA and external-link handling"
```

---

## Task 9: Local server-selection screen (renderer)

**Files:**
- Create: `apps/desktop/src/renderer/selection.html`
- Create: `apps/desktop/src/renderer/selection.ts`

Plain HTML + vanilla TS (no React needed for one screen). Verified manually in Task 11.

- [ ] **Step 1: Create `selection.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'unsafe-inline'" />
    <title>AnyNote — выбор сервера</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 32px; background: #fafafa; color: #111; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { color: #555; font-size: 13px; margin: 0 0 24px; }
      input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 8px; }
      button { margin-top: 16px; width: 100%; padding: 10px; font-size: 14px; border: 0; border-radius: 8px; background: #111; color: #fff; cursor: pointer; }
      button:disabled { opacity: 0.5; cursor: default; }
      .error { color: #c00; font-size: 13px; margin-top: 12px; min-height: 18px; }
    </style>
  </head>
  <body>
    <h1>Подключение к серверу AnyNote</h1>
    <p>Введите адрес сервера. По умолчанию — публичный облачный сервис.</p>
    <input id="url" type="text" value="https://anynote.ru" autocomplete="off" />
    <button id="connect">Подключиться</button>
    <div class="error" id="error"></div>
    <!-- IIFE bundle (see esbuild renderer entry); NOT type="module" -->
    <script src="./selection.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `selection.ts`**

```ts
// apps/desktop/src/renderer/selection.ts
// Talks to the main process over IPC exposed by the preload's anynoteBridge.
// The actual connect handler lives in main (Task 10); here we just send input.
declare global {
  interface Window {
    anynoteSetup?: {
      connect: (url: string) => Promise<{ ok: boolean; error?: string }>
    }
  }
}

const input = document.getElementById('url') as HTMLInputElement
const button = document.getElementById('connect') as HTMLButtonElement
const errorEl = document.getElementById('error') as HTMLDivElement

button.addEventListener('click', async () => {
  errorEl.textContent = ''
  button.disabled = true
  button.textContent = 'Проверка…'
  try {
    const result = (await window.anynoteSetup?.connect(input.value)) ?? {
      ok: false,
      error: 'Мост недоступен',
    }
    if (!result.ok) {
      errorEl.textContent = result.error ?? 'Сервер недоступен'
    }
    // On success the main process swaps this window for the main window.
  } finally {
    button.disabled = false
    button.textContent = 'Подключиться'
  }
})

export {}
```

- [ ] **Step 3: Add `anynoteSetup` to the preload**

Modify `apps/desktop/src/preload/index.ts` — append:

```ts
contextBridge.exposeInMainWorld('anynoteSetup', {
  connect: (url: string) => ipcRenderer.invoke('anynote:connect', url),
})
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter desktop check-types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/selection.html apps/desktop/src/renderer/selection.ts apps/desktop/src/preload/index.ts
git commit -m "feat(desktop): local server-selection screen"
```

---

## Task 10: App entry, menu, IPC wiring, updater

**Files:**
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/menu.ts`
- Create: `apps/desktop/src/main/updater.ts`

Thin Electron glue; verified manually in Task 11.

- [ ] **Step 1: Create `updater.ts`**

```ts
// apps/desktop/src/main/updater.ts
import { autoUpdater } from 'electron-updater'

export function initAutoUpdates(): void {
  // electron-updater reads owner/repo from electron-builder.yml publish config.
  autoUpdater.autoDownload = true
  autoUpdater.on('error', (err) => console.error('[updater]', err))
  void autoUpdater.checkForUpdatesAndNotify()
}
```

- [ ] **Step 2: Create `menu.ts`**

```ts
// apps/desktop/src/main/menu.ts
import { Menu, type MenuItemConstructorOptions } from 'electron'

export function buildAppMenu(onChangeServer: () => void): Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'AnyNote',
      submenu: [
        { label: 'Сменить сервер…', click: () => onChangeServer() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}
```

- [ ] **Step 3: Create `index.ts`**

```ts
// apps/desktop/src/main/index.ts
import { app, BrowserWindow, ipcMain, Menu, net, session } from 'electron'
import { clearServerUrl, getServerUrl, setServerUrl } from './config'
import { pingHealth } from './health-check'
import { isValidServerUrl, normalizeServerUrl } from './server-url'
import { buildAppMenu } from './menu'
import { initAutoUpdates } from './updater'
import { createMainWindow, createSelectionWindow } from './window'

let currentWindow: BrowserWindow | null = null

// Electron's net.fetch is a WHATWG fetch usable in main.
const fetchFn = (url: string, init?: { method?: string }) =>
  net.fetch(url, init) as unknown as Promise<Response>

function showMain(serverUrl: string): void {
  currentWindow?.close()
  currentWindow = createMainWindow(serverUrl)
}

function showSelection(): void {
  currentWindow?.close()
  currentWindow = createSelectionWindow()
}

async function changeServer(): Promise<void> {
  clearServerUrl()
  await session.fromPartition('persist:anynote').clearStorageData()
  showSelection()
}

ipcMain.handle('anynote:connect', async (_event, raw: string) => {
  if (!isValidServerUrl(raw)) return { ok: false, error: 'Некорректный адрес' }
  const url = normalizeServerUrl(raw)
  const ok = await pingHealth(url, fetchFn)
  if (!ok) return { ok: false, error: 'Сервер недоступен' }
  setServerUrl(url)
  showMain(url)
  return { ok: true }
})

ipcMain.on('anynote:change-server', () => {
  changeServer().catch((err) => console.error('[change-server]', err))
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(
    buildAppMenu(() => {
      changeServer().catch((err) => console.error('[change-server]', err))
    }),
  )
  initAutoUpdates()

  const saved = getServerUrl()
  if (saved) showMain(saved)
  else showSelection()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const url = getServerUrl()
      if (url) showMain(url)
      else showSelection()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter desktop check-types`
Expected: PASS. If `net.fetch` typing complains, the cast above handles it; otherwise import `fetch` from `undici` is not needed — Electron provides `net.fetch`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/main/menu.ts apps/desktop/src/main/updater.ts
git commit -m "feat(desktop): app entry, menu, connect IPC, auto-update"
```

---

## Task 11: esbuild bundling + electron-builder config + manual smoke run

**Files:**
- Create: `apps/desktop/esbuild.config.mjs`
- Create: `apps/desktop/electron-builder.yml`

- [ ] **Step 1: Create `esbuild.config.mjs`**

```js
// apps/desktop/esbuild.config.mjs
import { build, context } from 'esbuild'
import { copyFile, mkdir } from 'node:fs/promises'

const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
}

const entries = [
  { entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' },
  { entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' },
  // Renderer MUST be iife, not the shared cjs format — it's loaded by a plain
  // <script> tag in a browser context; a cjs bundle would throw at runtime.
  { entryPoints: ['src/renderer/selection.ts'], outfile: 'dist/renderer/selection.js', platform: 'browser', format: 'iife' },
]

async function copyStatic() {
  await mkdir('dist/renderer', { recursive: true })
  await copyFile('src/renderer/selection.html', 'dist/renderer/selection.html')
}

if (watch) {
  for (const e of entries) {
    const ctx = await context({ ...common, ...e })
    await ctx.watch()
  }
  await copyStatic()
  console.log('[esbuild] watching')
} else {
  await Promise.all(entries.map((e) => build({ ...common, ...e })))
  await copyStatic()
  console.log('[esbuild] built')
}
```

Note: the `main` field in `package.json` (Task 1) points to `dist/main/index.js`, matching this output.

- [ ] **Step 2: Create `electron-builder.yml`**

```yaml
appId: ru.anynote.desktop
productName: AnyNote
directories:
  output: release
files:
  - dist/**
  - package.json
publish:
  provider: github
  owner: AnyNoteInc
  repo: AnyNote
mac:
  category: public.app-category.productivity
  target:
    - dmg
    - zip
win:
  target:
    - nsis
linux:
  target:
    - AppImage
    - deb
  category: Office
```

- [ ] **Step 3: Build the bundle**

Run: `pnpm --filter desktop build`
Expected: prints `[esbuild] built`; `apps/desktop/dist/main/index.js`, `dist/preload/index.js`, `dist/renderer/selection.{js,html}` exist.

- [ ] **Step 4: Smoke-run the app against a local web server (manual)**

Start the web app in another terminal: `pnpm --filter web dev` (port 3000), with `docker compose up -d` already running.

Run: `cd apps/desktop && pnpm exec electron .`
Expected:
- First launch shows the **selection screen**.
- Enter `http://localhost:3000`, click Подключиться → health ping passes → main window loads the AnyNote site.
- App menu → "Сменить сервер…" returns to the selection screen.
- Restart the app → it loads `http://localhost:3000` directly (persisted), and you are still logged in (persistent partition).

If any step fails, debug before continuing (this is the integration checkpoint for Tasks 6–10).

- [ ] **Step 5: Verify the custom UA reaches the server (manual)**

While the main window is loaded, in the app open DevTools (View menu) → Console → run `navigator.userAgent`.
Expected: contains `AnyNote-Desktop/<version> (<platform>; <arch>)`.
Also run `window.anynote` → expected `{ isDesktop: true, platform, arch, appVersion }`.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/esbuild.config.mjs apps/desktop/electron-builder.yml
git commit -m "build(desktop): esbuild bundling and electron-builder config"
```

---

## Task 12: Web — recognize desktop UA in session list

**Files:**
- Modify: `apps/web/src/lib/parse-user-agent.ts`
- Test: `apps/web/test/parse-user-agent.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/parse-user-agent.test.ts
import { describe, expect, it } from 'vitest'
import { parseUserAgent } from '@/lib/parse-user-agent'

describe('parseUserAgent — desktop client', () => {
  it('labels the AnyNote desktop UA as a desktop app with OS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130 Safari/537.36 AnyNote-Desktop/1.2.0 (darwin; arm64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'macOS' })
  })

  it('maps win32 desktop UA to Windows', () => {
    const ua = 'Mozilla/5.0 Chrome/130 AnyNote-Desktop/1.0.0 (win32; x64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'Windows' })
  })

  it('maps linux desktop UA to Linux', () => {
    const ua = 'Mozilla/5.0 Chrome/130 AnyNote-Desktop/1.0.0 (linux; x64)'
    expect(parseUserAgent(ua)).toEqual({ browser: 'AnyNote Desktop', os: 'Linux' })
  })

  it('still parses a normal browser UA', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537.36'
    expect(parseUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test parse-user-agent`
Expected: FAIL — the first three cases return `Chrome`/`Unknown`, not `AnyNote Desktop`.

- [ ] **Step 3: Update `parse-user-agent.ts`**

```ts
// apps/web/src/lib/parse-user-agent.ts
export function parseUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' }

  const desktop = /AnyNote-Desktop\/[\d.]+\s*\((\w+);/.exec(ua)
  if (desktop) {
    const platform = desktop[1]
    const os =
      platform === 'darwin'
        ? 'macOS'
        : platform === 'win32'
          ? 'Windows'
          : platform === 'linux'
            ? 'Linux'
            : 'Unknown'
    return { browser: 'AnyNote Desktop', os }
  }

  const browser = /Edg/.test(ua)
    ? 'Edge'
    : /Chrome/.test(ua)
      ? 'Chrome'
      : /Firefox/.test(ua)
        ? 'Firefox'
        : /Safari/.test(ua)
          ? 'Safari'
          : 'Unknown'
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua)
      ? 'macOS'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Android/.test(ua)
          ? 'Android'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown'
  return { browser, os }
}
```

Note: the desktop check runs **first** because the desktop UA also contains `Chrome`/`Macintosh` tokens.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test parse-user-agent`
Expected: PASS (all 4 cases). The session table (`apps/web/src/components/settings/sessions-table.tsx`) renders `{browser} на {os}` → "AnyNote Desktop на macOS" with no further change.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/parse-user-agent.ts apps/web/test/parse-user-agent.test.ts
git commit -m "feat(web): recognize AnyNote desktop client in session list"
```

---

## Task 13: Web — download-link helpers (pure)

**Files:**
- Create: `apps/web/src/lib/download-links.ts`
- Test: `apps/web/test/download-links.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/download-links.test.ts
import { describe, expect, it } from 'vitest'
import { detectOS, downloadUrl, DESKTOP_PLATFORMS } from '@/lib/download-links'

describe('detectOS', () => {
  it('detects macOS', () => {
    expect(detectOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari')).toBe('mac')
  })
  it('detects Windows', () => {
    expect(detectOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('win')
  })
  it('detects Linux (non-Android)', () => {
    expect(detectOS('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
  it('returns null for Android/unknown', () => {
    expect(detectOS('Mozilla/5.0 (Linux; Android 13)')).toBe(null)
    expect(detectOS('weird')).toBe(null)
  })
})

describe('downloadUrl', () => {
  it('builds a GitHub latest-release asset URL per platform', () => {
    expect(downloadUrl('mac')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote.dmg',
    )
    expect(downloadUrl('win')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote-Setup.exe',
    )
    expect(downloadUrl('linux')).toBe(
      'https://github.com/AnyNoteInc/AnyNote/releases/latest/download/AnyNote.AppImage',
    )
  })

  it('DESKTOP_PLATFORMS lists all three platforms with labels', () => {
    expect(DESKTOP_PLATFORMS.map((p) => p.id)).toEqual(['mac', 'win', 'linux'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test download-links`
Expected: FAIL — cannot resolve `@/lib/download-links`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/web/src/lib/download-links.ts
export type DesktopOS = 'mac' | 'win' | 'linux'

const RELEASE_BASE = 'https://github.com/AnyNoteInc/AnyNote/releases/latest/download'

const ASSET: Record<DesktopOS, string> = {
  mac: 'AnyNote.dmg',
  win: 'AnyNote-Setup.exe',
  linux: 'AnyNote.AppImage',
}

export const DESKTOP_PLATFORMS: { id: DesktopOS; label: string }[] = [
  { id: 'mac', label: 'macOS' },
  { id: 'win', label: 'Windows' },
  { id: 'linux', label: 'Linux' },
]

export function downloadUrl(os: DesktopOS): string {
  return `${RELEASE_BASE}/${ASSET[os]}`
}

export function detectOS(ua: string): DesktopOS | null {
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac'
  if (/Windows/.test(ua)) return 'win'
  if (/Android/.test(ua)) return null
  if (/Linux/.test(ua)) return 'linux'
  return null
}
```

Note: the asset names (`AnyNote.dmg`, `AnyNote-Setup.exe`, `AnyNote.AppImage`) are electron-builder's default artifact names for `productName: AnyNote` (dmg → `${productName}.dmg`, nsis → `${productName}-Setup.exe`, AppImage → `${productName}.AppImage`). If a later electron-builder version changes defaults, pin `artifactName` in `electron-builder.yml` to match these.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test download-links`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/download-links.ts apps/web/test/download-links.test.ts
git commit -m "feat(web): desktop download-link helpers"
```

---

## Task 14: Web — `HomeDownload` section component

**Files:**
- Create: `apps/web/src/components/public/home/home-download.tsx`

- [ ] **Step 1: Write the component**

Follow the existing home-section style (`@repo/ui/components`, `homeBaseSx`/`homeTokens` from `./home-tokens`, `component="section"`). OS detection is client-side, so this is a client component.

```tsx
// apps/web/src/components/public/home/home-download.tsx
'use client'

import { useEffect, useState } from 'react'

import { Box, Button, Container, Stack, Typography } from '@repo/ui/components'

import { DESKTOP_PLATFORMS, type DesktopOS, detectOS, downloadUrl } from '@/lib/download-links'
import { homeBaseSx } from './home-tokens'

const LABEL: Record<DesktopOS, string> = { mac: 'macOS', win: 'Windows', linux: 'Linux' }

export function HomeDownload() {
  const [primary, setPrimary] = useState<DesktopOS | null>(null)

  useEffect(() => {
    setPrimary(detectOS(navigator.userAgent))
  }, [])

  const others = DESKTOP_PLATFORMS.filter((p) => p.id !== primary)

  return (
    <Box
      component="section"
      sx={{
        ...homeBaseSx,
        borderBottom: '1px solid',
        borderColor: 'divider',
        py: { xs: 5, md: 7 },
      }}
    >
      <Container maxWidth="xl">
        <Stack spacing={2} alignItems="center" textAlign="center">
          <Typography variant="h4" component="h2" fontWeight={700}>
            Десктоп-приложение AnyNote
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560 }}>
            Нативное приложение для macOS, Windows и Linux. Работает с облаком
            anynote.ru или с вашим self-hosted сервером.
          </Typography>

          {primary ? (
            <Button
              component="a"
              href={downloadUrl(primary)}
              variant="contained"
              size="large"
            >
              Скачать для {LABEL[primary]}
            </Button>
          ) : (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {DESKTOP_PLATFORMS.map((p) => (
                <Button key={p.id} component="a" href={downloadUrl(p.id)} variant="contained">
                  Скачать для {p.label}
                </Button>
              ))}
            </Stack>
          )}

          {primary && (
            <Stack direction="row" spacing={2}>
              {others.map((p) => (
                <Typography
                  key={p.id}
                  component="a"
                  href={downloadUrl(p.id)}
                  variant="body2"
                  sx={{ color: 'text.secondary', textDecoration: 'underline' }}
                >
                  Скачать для {p.label}
                </Typography>
              ))}
            </Stack>
          )}
        </Stack>
      </Container>
    </Box>
  )
}
```

Note: this is a **client** component (`'use client'`), so `<Button component="a" href=…>` is safe (the RSC "Functions cannot be passed to Client Components" rule does not apply — `"a"` is a string and `href` is a string). Confirm `homeBaseSx` is exported from `./home-tokens` (it is, per `home-hero.tsx`).

- [ ] **Step 2: Type-check the web package**

Run: `pnpm --filter web check-types`
Expected: PASS. If `Button`/`Typography` need an extra re-export, add it to `packages/ui/src/components/index.ts` (they are already used in `home-hero.tsx`, so they resolve).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/public/home/home-download.tsx
git commit -m "feat(web): HomeDownload section component"
```

---

## Task 15: Web — insert `HomeDownload` first on the home page

**Files:**
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: Add the import and render the section first in `<main>`**

In `apps/web/src/app/page.tsx`:

Add the import alongside the other home imports (after line 13, the `HomeHero` import):

```tsx
import { HomeDownload } from '@/components/public/home/home-download'
```

Then make `HomeDownload` the first child of `<main>` (before `HomeHero`):

```tsx
      <main>
        <HomeDownload />
        <HomeHero primaryHref={primaryHref} primaryLabel={primaryLabel} showSecondary={!session} />
        <HomeMarketFit />
        <HomeModes />
        <HomeCapabilities />
        <HomeSearch />
        <HomeFeatures />
        <HomePricing />
        <HomeContact />
        <HomeFinalCta primaryHref={primaryHref} primaryLabel={primaryLabel} />
      </main>
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter web check-types`
Expected: PASS.

- [ ] **Step 3: Verify the route renders at runtime (RSC boundary check)**

Per CLAUDE.md, `/` is a dynamic route (uses `getSession()`), so RSC prop errors only surface at request time. With `pnpm --filter web dev` running:

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200`. Then load `http://localhost:3000/` in a browser and confirm the "Десктоп-приложение AnyNote" section appears first, above the hero, with a "Скачать для …" button.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/page.tsx
git commit -m "feat(web): show desktop download section first on home page"
```

---

## Task 16: CI workflow — build & publish installers on `v*` tag

**Files:**
- Create: `.github/workflows/desktop.yml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Desktop

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            target: dist:mac
          - os: windows-latest
            target: dist:win
          - os: ubuntu-latest
            target: dist:linux
    runs-on: ${{ matrix.os }}
    timeout-minutes: 40
    permissions:
      contents: write # publish release assets
    steps:
      - uses: actions/checkout@v5

      - uses: pnpm/action-setup@v4
        with:
          version: 9

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install deps
        run: pnpm install --frozen-lockfile

      - name: Build & publish desktop installer
        # electron-builder publishes to the GitHub Release for this tag
        # (publish config in apps/desktop/electron-builder.yml). It uploads
        # to the release matching the current tag, creating it if needed.
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm --filter desktop run ${{ matrix.target }} -- --publish always
```

Notes:
- `electron-builder`'s GitHub publisher uses `GH_TOKEN`. `secrets.GITHUB_TOKEN` with `contents: write` is sufficient to attach assets to the tag's release.
- The matrix builds each platform on its native runner (electron-builder cannot cross-build dmg from Linux, and nsis/AppImage are cleanest on their own OS).
- This runs in parallel with `Deploy` (both trigger on `v*`); they are independent.

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `pnpm dlx @action-validator/cli .github/workflows/desktop.yml` (or, if unavailable, `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/desktop.yml'))" && echo OK`)
Expected: no syntax errors / `OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/desktop.yml
git commit -m "ci(desktop): build and publish installers on version tags"
```

---

## Task 17: Wire desktop into repo gates & docs

**Files:**
- Modify: `apps/web/next.config.js` — **no change** (desktop is not imported by web; do NOT add it to `transpilePackages`). This step is a deliberate no-op note to prevent a wrong edit.
- Modify: `turbo.json` — confirm `build`/`test`/`lint`/`check-types` already fan out to all workspace packages (they do, via globs). The desktop `build` runs esbuild; ensure that's acceptable in `pnpm gates`.
- Create: `apps/desktop/README.md`
- Modify: `AGENTS.md` — add the one-line module entry for `apps/desktop`.

- [ ] **Step 1: Create `apps/desktop/README.md`**

```markdown
# apps/desktop

Cross-platform Electron **thin client** for AnyNote. It loads the remote
AnyNote server (default `https://anynote.ru`, or a self-hosted URL) in a
desktop window — all product UI comes from the server, so the desktop tracks
server changes automatically.

## Dev

```bash
docker compose up -d            # infra for the web server
pnpm --filter web dev           # the server the desktop will load
pnpm --filter desktop build     # bundle main/preload/renderer to dist/
cd apps/desktop && pnpm exec electron .
```

First launch shows a local server-selection screen (validates via
`GET {url}/api/health`). The choice is persisted in electron-store; change it
later via the app menu → "Сменить сервер…".

## Build installers

```bash
pnpm --filter desktop dist:mac     # .dmg / .zip
pnpm --filter desktop dist:win     # NSIS .exe
pnpm --filter desktop dist:linux   # .AppImage / .deb
```

CI (`.github/workflows/desktop.yml`) builds all three on each `v*` tag and
publishes to the matching GitHub Release. `electron-updater` auto-updates the
shell from those releases.

## Identification

The window sends a custom User-Agent
(`AnyNote-Desktop/<version> (<platform>; <arch>)`) so the server records it in
`session.userAgent` and the web session list shows "AnyNote Desktop на <OS>".
The preload exposes `window.anynote = { isDesktop, platform, arch, appVersion }`
to the loaded site.

## Not bundled

No `@repo/*` runtime package is bundled (keeps Next/Prisma/MUI out). Pure logic
(`server-url`, `health-check`, `user-agent`, preload `api`) is unit-tested with
Vitest; Electron glue is verified by running the app.
```

- [ ] **Step 2: Add the AGENTS.md module entry**

In `AGENTS.md`, find the module tour list and add (matching the existing format):

```
- `apps/desktop` — Electron thin-client (loads the remote server; macOS/Windows/Linux).
```

Run first to locate the list: `grep -n "apps/e2e\|apps/yjs\|module tour" AGENTS.md | head`. Insert the new line adjacent to the other `apps/*` entries.

- [ ] **Step 3: Run the full gates to confirm the new package integrates**

Run: `pnpm check-types`
Expected: PASS across all packages including `desktop`.

Run: `pnpm --filter desktop test && pnpm --filter web test`
Expected: PASS — desktop pure-logic tests (server-url, health-check, user-agent, api) and web tests (parse-user-agent, download-links) all green.

Run: `pnpm lint`
Expected: PASS (`--max-warnings 0`) including `apps/desktop/src`.

Run: `pnpm check-architecture`
Expected: PASS — `apps/desktop` is not under the dependency-cruiser scope (`packages apps/engines apps/yjs`), and it imports no `@repo/*` runtime package, so no new violations.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/README.md AGENTS.md
git commit -m "docs(desktop): readme and module tour entry"
```

---

## Task 18: Final verification & branch wrap-up

- [ ] **Step 1: Run the merge gate**

Run: `pnpm gates`
Expected: `check-types`, `lint`, `check-architecture`, `build`, `test` all PASS. If `build` for `desktop` (esbuild) fails because `dist/` is gitignored but turbo expects outputs, confirm the `build` script exits 0 and produces `dist/` — that's sufficient.

- [ ] **Step 2: Re-run the manual desktop smoke test** (Task 11, Steps 4–5) one final time against `pnpm --filter web dev` to confirm nothing regressed: selection screen → connect localhost → main window loads → UA + `window.anynote` correct → session list (in the loaded web app, Settings → sessions) shows "AnyNote Desktop на <OS>".

- [ ] **Step 3: Confirm the spec is fully covered**

Cross-check against `docs/superpowers/specs/2026-06-20-desktop-electron-design.md`:
- Thin client loading remote server ✓ (Tasks 8, 10, 11)
- Server-URL first-run selection + default anynote.ru + health validation ✓ (Tasks 2, 3, 9, 10)
- Platform identification: UA ✓ (Task 4, 8), `window.anynote` ✓ (Tasks 5, 7), session list ✓ (Task 12), telemetry-via-UA ✓ (no new field, by design)
- Cookie-session auth in-window ✓ (Task 8 persistent partition) — Google OAuth risk noted, verify manually in the smoke test
- Download section first on home page ✓ (Tasks 13, 14, 15)
- electron-builder targets + CI matrix on v* tag + auto-update ✓ (Tasks 11, 16, updater in 10)

- [ ] **Step 4: Hand off for review**

Use superpowers:requesting-code-review (or open a PR with `gh pr create`) once the user confirms. Do not merge without the user's go-ahead.

---

## Open risk to verify during implementation

**Google OAuth in embedded webview.** During Task 11's smoke test, attempt a Google sign-in. If Google returns `disallowed_useragent` / blocks the embedded view, implement the fallback: open the OAuth URL via `shell.openExternal` and register an `anynote://` protocol handler (`app.setAsDefaultProtocolClient('anynote')`) that the server redirects back to with the session. This fallback is **not** in the task list above because it is conditional; add it as a follow-up task only if the smoke test shows it's needed. Email/password auth is unaffected and is the baseline.
```