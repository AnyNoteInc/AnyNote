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

## Layout

- `src/main/` — Electron main process (windows, menu, server selection, custom
  UA, electron-store, auto-update). Pure logic (`server-url`, `health-check`,
  `user-agent`) is unit-tested with Vitest.
- `src/preload/` — `contextBridge` exposing `window.anynote` and the connect /
  change-server IPC bridges.
- `src/renderer/` — the local first-run server-selection screen only.

## Not bundled

No `@repo/*` runtime package is bundled (keeps Next/Prisma/MUI out). Electron
glue (`window`, `menu`, `index`, `config`, `updater`) is verified by running
the app; pure logic is unit-tested.
