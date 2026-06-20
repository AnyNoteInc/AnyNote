# Desktop Electron client (`apps/desktop`) — design

Date: 2026-06-20

## Goal

Ship a cross-platform desktop application (macOS, Windows, Linux) for AnyNote
that **reuses the existing web product** instead of duplicating it. The desktop
app is a **thin Electron client**: it opens a window that loads the remote
AnyNote server (`https://anynote.ru` by default, or a self-hosted URL), so the
entire UI and feature set come from the server. When the server changes, the
desktop changes with it — no native duplication of business logic.

## Non-goals (v1, YAGNI)

- Bundling Next.js / Prisma / SSR inside Electron.
- Offline data editing.
- Native notifications / tray (can be added later).
- Code signing & notarization (follow-up; needs certs/secrets).
- Self-hosted S3 distribution channel.
- Deep-link / device-flow auth (only if Google blocks the embedded webview).

## Architecture

`apps/desktop` is a standalone Electron workspace package (sibling of
`apps/e2e`). It is **not** part of the Turborepo Docker image build — it is not
a service. A separate CI workflow builds it into native installers.

It does **not** depend on any `@repo/*` package (to keep Next/Prisma/MUI out of
the desktop bundle). It may share `@repo/typescript-config` / lint config only.

Three internal layers:

- **main** (`src/main/`) — Electron main process. Owns windows, application
  menu, auto-update, the server-selection flow, the custom User-Agent, and
  `electron-store` persistence. Pure Node, no React.
- **preload** (`src/preload/`) — `contextBridge` bridge. Exposes a frozen,
  safe `window.anynote = { isDesktop, platform, arch, appVersion, … }` to the
  loaded remote site, plus IPC for "change server".
- **renderer** (`src/renderer/`) — **only** the local native server-selection
  screen (first launch / change server). Everything else is the remote site,
  not our renderer.

Dependencies: `electron`, `electron-builder`, `electron-updater`,
`electron-store`. `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true` for the main window; the renderer screen is local and trusted.

### Window / session model

The main `BrowserWindow` uses a **persistent** session partition
(`persist:anynote`) so better-auth cookies survive restarts. Navigation is
constrained to the configured server origin (external links open in the system
browser via `setWindowOpenHandler`).

## First-run & server selection

```
App start
  └─ electron-store: saved serverUrl?
       ├─ no  → native selection screen (renderer):
       │          URL field (default https://anynote.ru)
       │          → ping GET {url}/api/health (expects { status: 'ok' })
       │             ├─ ok  → save, load {url} in main window
       │             └─ fail → show error, stay on screen
       └─ yes → load saved {url} directly
```

- The selection screen is **local** HTML/React in the renderer (the server is
  not yet known, so it cannot come from the server).
- Validation reuses the existing `GET /api/health` endpoint
  (`apps/web/src/app/api/health/route.ts`, returns `{ status: 'ok' }`).
- "Change server" lives in the application menu → returns to the selection
  screen and clears the current session partition (logout).
- `serverUrl` is stored in `electron-store` (JSON under `userData`).

## Platform / client identification

Four surfaces:

1. **User-Agent** — the main process sets a custom UA on the window session:
   `AnyNote-Desktop/<appVersion> (<platform>; <arch>) Electron/<v>` appended to
   the default Chrome UA. The server already persists `session.userAgent`
   (column exists in `packages/db/prisma/schema.prisma`), so desktop vs web is
   distinguishable with **no DB change**.
2. **`window.anynote`** — preload exposes
   `{ isDesktop: true, platform, arch, appVersion }`. The web UI may read it
   (e.g. hide the PWA install banner, show "you're in the desktop app"). On the
   web it is simply `undefined`.
3. **Active-sessions list** — `apps/web` parses our UA into a human label like
   "AnyNote Desktop (macOS) v1.2.0" in the session-management UI. *(Small web
   change: UA → label parser.)*
4. **Login telemetry** — platform is already captured in `session.userAgent` at
   sign-in; no new field is introduced (YAGNI). Counts derive from UA.

Surfaces 1–2 live entirely in `apps/desktop`. Surfaces 3–4 are small additions
in `apps/web` (UA parsing for the session label).

## Authentication

Login happens **inside the loaded site** using the standard better-auth cookie
session. The persistent partition keeps the user signed in across restarts.

- Email/password — works out of the box; nothing changes.
- Google OAuth — attempted in-window first (simplest). **Risk to verify in
  implementation:** Google may block embedded webviews
  (`disallowed_useragent`). If so, fall back to opening OAuth in the system
  browser with an `anynote://` deep-link return. This is flagged as a risk in
  the plan, not a design blocker.

## Home page "Download" section

A new `HomeDownload` component becomes the **first** section on
`apps/web/src/app/page.tsx` (above `HomeHero`).

- The primary button auto-detects the visitor's OS (client component, via
  `navigator.userAgent`): "Download for macOS / Windows / Linux".
- Secondary links to the other platforms.
- Links point to the **GitHub Release** stable path
  (`<repo>/releases/latest/download/<asset>`) — no API request needed.
- Assets: `.dmg` (macOS), `.exe` NSIS (Windows), `.AppImage` + `.deb` (Linux).

## Build, distribution, auto-update

- **electron-builder** config in `apps/desktop`: mac (dmg, zip), win (nsis),
  linux (AppImage, deb). `appId` e.g. `ru.anynote.desktop`.
- **New CI workflow** `.github/workflows/desktop.yml`: triggered on the same
  `v*` tag as Deploy. A 3-runner matrix (`macos-latest`, `windows-latest`,
  `ubuntu-latest`) each builds its platform and publishes assets to the same
  GitHub Release as the tag.
- **Auto-update** via `electron-updater` (provider: github) — the native shell
  updates itself from new releases. The remote content already updates on its
  own; this keeps the shell current too.
- Code signing / notarization is out of v1 scope (follow-up; needs
  certs/secrets). v1 ships unsigned builds.

## Testing

- **main/preload unit tests** (vitest, node env): server-URL persistence,
  health-ping validation logic, UA string construction, `window.anynote`
  shape. Pure functions extracted so Electron APIs are mockable.
- **web unit tests** (vitest): `HomeDownload` OS detection + asset link
  builder; the UA → session-label parser.
- No E2E for the Electron binary in v1 (would need a headless Electron driver);
  the thin-client surface is small and the heavy logic is unit-tested.

## Risks

1. Google OAuth embedded-webview block (see Authentication). Mitigation: system
   browser + deep-link fallback.
2. Unsigned builds trigger OS warnings (Gatekeeper / SmartScreen). Accepted for
   v1; signing is the documented follow-up.
3. CI matrix build time / runner cost on every `v*` tag. Acceptable; same
   cadence as Deploy.

## Follow-ups (post-v1)

- **Auto-update UX.** v1 uses `autoUpdater.autoDownload = true` +
  `checkForUpdatesAndNotify()` (native OS notification). There is no in-app
  "restart to update" banner. Add an `update-downloaded` IPC → main-window
  banner when we control more of the shell chrome.
- **Code signing / notarization** (mac codesign + notarize, win signtool) —
  needs certs/secrets; v1 ships unsigned (Gatekeeper/SmartScreen warnings).
- **Google OAuth fallback** — only if the embedded webview is blocked (see
  Authentication); system browser + `anynote://` deep-link.
- **Electron upgrades** — track the supported-major cadence (started on 37);
  a thin client loading remote origins should not run an EOL Chromium.
