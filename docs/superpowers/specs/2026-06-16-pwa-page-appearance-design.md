# PWA Install + Page Icon/Cover (Phase 9A)

**Date:** 2026-06-16
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl9.md` Prompt 9.1 + Prompt 9.2 sub-step 1 — sub-phase 1 of 6
(9A PWA+appearance → 9B media/embeds/headings → 9C tabs+synced → 9D inline AI →
9E meetings → 9F dashboards).

An honest app-shell install experience (explicitly NOT presented as Notion
parity) plus Notion-aligned page icons (emoji + uploaded images) and page
covers (gradients, uploads, external URLs).

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Icons | Emoji + uploaded image icons. `Page.icon` discriminated format: plain string = emoji (back-compatible, NO migration); `url:<path>` prefix = image. Two-tab picker. One shared `PageIcon` renderer everywhere. |
| PWA depth | Manifest + install UX + a CONSERVATIVE shell cache grown into the existing `/sw.js` (same URL + root scope — push subscriptions survive). No private data cached; no offline editing promised. Fixes the push 404-icon bug. |
| Covers | Upload (new public-by-id kind, 10MB image) + https external URL + ~10 built-in CSS gradient presets. Public-share visitors see covers (the avatar public-by-id precedent). Reposition + AI covers deferred. |

## 2. Data model (one migration `*_page_appearance` — Page columns only)

```prisma
// Page gains:
//   coverUrl    String? @db.VarChar(1024)  // '/api/files/<id>' or an https URL
//   coverPreset String? @db.VarChar(32)    // a key from COVER_PRESETS; mutually exclusive with coverUrl (service-enforced: setting one clears the other)
// Page.icon stays String? @db.Text — the format becomes:
//   plain value  -> emoji (today's data unchanged)
//   'url:<path>' -> image icon ('/api/files/<id>' or https URL — uploads only in the MVP picker)
```

File upload kinds (apps/web `file-validation.ts`) gain:
- `icon` — 1 MB, image MIME (png/jpeg/webp/gif), **isPublic: true**, workspaceId: null (the avatar semantics: served by unguessable UUID to anyone — icons render in public shares).
- `cover` — 10 MB, image MIME, **isPublic: true**, workspaceId: null (same rationale).
Both count toward NO workspace quota (workspaceId null, like avatars) — document;
the per-file caps bound abuse.

`COVER_PRESETS` (in `@repo/ui` or a web-side constants file — client-rendered
CSS, no server meaning beyond whitelist validation): 10 keys → CSS gradients
(e.g. `sunset`, `ocean`, `forest`, `lavender`, `peach`, `slate`, `aurora`,
`sand`, `berry`, `midnight`). The tRPC layer validates `coverPreset ∈ keys`
via a shared constant list exported from a small `packages/domain` pages dto
addition or a web constant mirrored with a sync comment — IMPLEMENTATION:
the canonical list lives in `packages/domain/src/pages/dto` (server validation)
and the CSS map lives web-side keyed by the same names (drift-guarded by a
unit test importing both).

## 3. Page appearance behavior

- **page.update** (the existing domain path) accepts `icon` (validated:
  emoji-ish length ≤ 32 for plain, or `url:` + a same-origin `/api/files/<uuid>`
  path or https URL ≤ 1024), `coverUrl` (same-origin files path or https URL),
  `coverPreset` (whitelist). Setting coverUrl clears coverPreset and vice versa;
  explicit nulls clear. Validation lives in the domain pages service (the
  existing update path) — honest BAD_REQUEST messages.
- **Header rendering** (`page-header.tsx` + the page route): the cover band
  (height ~200px desktop / 120px mobile, object-fit cover for images, the CSS
  gradient for presets) renders ABOVE the header inside the page column for
  non-full-bleed page types; hover reveals «Сменить обложку» / «Убрать обложку»;
  «Добавить обложку» ghost button appears next to «Добавить иконку» when no
  cover. The icon overlaps the cover bottom edge (Notion-style) when both exist.
- **Icon picker**: the existing Popover grows tabs — «Эмодзи» (the current
  EmojiPicker) and «Загрузить» (file input → `/api/files/upload?kind=icon` →
  `icon = 'url:/api/files/<id>'`); remove stays. Client-side square crop is a
  nice-to-have — MVP: accept as-is, render `object-fit: cover` in a rounded
  square.
- **Cover picker**: a Popover/Dialog with tabs «Градиенты» (the preset grid),
  «Загрузить» (upload → coverUrl), «Ссылка» (https URL input with validation
  + a load-error fallback note). testids: `page-cover-add`, `page-cover-change`,
  `page-icon-add` (exists implicitly — give it a testid), `cover-preset-<key>`.
- **`PageIcon` shared component** (packages/ui or apps/web/components/page):
  parses the format → emoji span (today's rendering) or a rounded `<img>`;
  consumed by page-header, page-tree-section (+ drag overlay), page-tree-picker,
  database-item-modal. Sizes via prop.
- **Database surfaces**: the item modal header renders icon (both forms) +
  cover band (small, ~96px). Board/table cards keep title-only (gallery view
  does not exist; deferred).
- **Public share pages**: covers/icons render for anonymous visitors (the
  public-by-id files make this just work — pinned by a test).
- **History/webhooks**: icon/cover changes ride the existing
  `page.properties_updated` emission with `changed: ['icon']`/`['coverUrl']`…
  — extend the changed-fields list where the domain update tracks them (verify
  the current emission includes icon already — it does [`changed:[title|icon|type|archivedAt]`];
  add the two cover fields).

## 4. PWA

- **`apps/web/src/app/manifest.ts`** (Next MetadataRoute.Manifest): name
  «AnyNote», short_name «AnyNote», description, `start_url: '/app'`,
  `display: 'standalone'`, `background_color`/`theme_color` (single dark-neutral
  pair consistent with the brand; the in-app theme stays dynamic), icons:
  `/icon` (512, `purpose: 'any'`), `/apple-icon` (180) + a NEW
  `/icon-maskable` ImageResponse route (512, padded safe-zone art via
  `renderBrandIconArt`, `purpose: 'maskable'`).
- **Root layout**: `export const viewport: Viewport = { themeColor: ... }`;
  `metadata.manifest` is auto-linked by the file convention (verify the
  `<link rel="manifest">` lands).
- **Install UX**: `pwa-install-context.tsx` client provider (mounted in the
  protected layout) capturing `beforeinstallprompt` (prevented + stored),
  tracking `appinstalled` + `display-mode: standalone`; exposes
  `{canInstall, promptInstall, isInstalled}`. Surfaces: a MenuItem «Установить
  приложение» in `workspace-user-menu.tsx` (hidden unless canInstall) and a
  one-time dismissible `InstallPromptBanner` (localStorage dismiss key) on the
  protected layout (NOT on marketing pages). testids: `pwa-install-menu-item`,
  `pwa-install-banner`.
- **Help block**: a card in `/settings/general` («Приложение AnyNote»):
  installed-vs-browser explanation, the honest offline scope («открывается без
  сети; страницы и данные требуют подключения — офлайн-редактирование не
  поддерживается»), the install button again for discoverability. testid
  `pwa-help-card`.
- **Service worker** (`apps/web/public/sw.js` — grown in place, same URL/scope):
  - Keep the push + notificationclick handlers byte-compatible in behavior;
    fix `icon: '/icon.png'` → `'/icon'` (the real route).
  - Add: `SW_VERSION` const; `install` → precache `['/offline', '/icon',
    '/manifest.webmanifest']` into `anynote-shell-v<N>`; `activate` → delete
    old `anynote-shell-*` caches + `clients.claim()`; `fetch` → ONLY
    same-origin GET **navigation** requests, network-first with
    `caches.match('/offline')` fallback; static brand assets cache-first.
    EXPLICITLY no caching for anything under `/api/`, non-GET, cross-origin,
    or non-navigation document requests (a guard test greps the file for the
    `/api/` exclusion logic).
  - `/offline` — a tiny static RSC page («Нет подключения…», retry button),
    added to the precache.
- **No env changes.** No plan gates (install is free).

## 5. Tests

- Unit (web): icon-format helpers (parse/serialize/back-compat: plain emoji
  untouched, url: round-trip), cover validation (preset whitelist, https-only,
  same-origin file path shape, mutual exclusion), the preset name drift guard
  (domain list ≡ web CSS map keys), upload-kind validation (icon 1MB/cover
  10MB/MIME), manifest route shape (name/icons/display — call the manifest fn),
  the SW source guard (contains the `/api/` exclusion + the push handlers +
  `'/icon'` not `'/icon.png'`).
- tRPC/domain: page.update icon/cover validation matrix + the
  properties_updated emission gains the cover fields (extend the existing
  emission tests); public-share page payload carries icon/cover (the share
  resolver's page select — extend if needed).
- E2E (`appearance-pwa.spec.ts`): manifest responds with the right name;
  page flow — add emoji icon → switch to uploaded image icon (file input) →
  add gradient cover → switch to uploaded cover → remove both; the sidebar
  tree shows the image icon; a PUBLIC share of the page shows the cover
  anonymously; the install banner renders under a mocked `beforeinstallprompt`
  (dispatch the event in an init script) and the user-menu item appears;
  /settings/general shows the honest help card (assert the copy does NOT
  contain «офлайн-редактирование поддерживается» — assert the honest phrase).
- Push regression: the existing push-toggle unit/spec paths stay green; the
  SW guard test pins the handlers' presence.
- Full gates + forced sweep; changelog «Приложение AnyNote и оформление страниц».

## 6. Non-goals

- Offline page data/editing; background sync; periodic sync.
- Cover repositioning; AI-generated covers (no image-generation substrate —
  honestly deferred); Unsplash/external galleries.
- Icon libraries beyond emoji+upload (e.g. icon fonts); workspace-level icons.
- Gallery database view (cards keep title-only).
- Desktop-app-style tabs/shortcuts (cl9 names them as Notion desktop behaviors,
  not PWA scope).
