# PWA Install + Page Icon/Cover Implementation Plan (Phase 9A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honest PWA install experience (manifest + install UX + conservative shell cache grown into the existing push SW) and Notion-aligned page icons (emoji + image) and covers (gradients/upload/URL) — per `docs/superpowers/specs/2026-06-16-pwa-page-appearance-design.md` (THE SPEC; normative).

**Architecture:** Page columns + upload kinds + domain validation ride existing paths (page.update, file-validation, the properties_updated emission); the PWA is web-only (manifest.ts convention, a context provider, sw.js grown in place — SAME URL/scope so push survives); a shared `PageIcon` renderer replaces raw emoji spans.

**Template files:** `apps/web/src/app/api/files/upload/route.ts` + `apps/web/src/lib/file-validation.ts` (the avatar kind = the public-by-id precedent), `apps/web/src/components/page/page-header.tsx` (the icon picker/popover + cache-patching idioms — KEEP the getQueryKey patching style, do not switch to useUtils), `apps/web/public/sw.js` + `apps/web/src/lib/push/register-sw.ts` (preserve), `apps/web/src/components/workspace/{workspace-user-menu,page-tree-section,page-tree-picker}.tsx`, `apps/web/src/components/database/database-item-modal.tsx`, `packages/domain/src/pages/**` (the update validation + emission), `apps/e2e/{security,people}.spec.ts` (fixtures/nav).

**Shared-dev-DB migration rule (Task 1):** the established diff→psql→resolve flow (two nullable Page columns — trivial).

**Test discipline:** fixture-scoped; suites alone; the SW-source guard test is a FILE-CONTENT test (no SW runtime harness).

**Commits:** explicit paths, NEVER `git add -A`.

---

## Task 1: Schema + upload kinds + domain validation + emission

**Files:** Modify `packages/db/prisma/schema.prisma` (Page.coverUrl/coverPreset), `apps/web/src/lib/file-validation.ts` (+`icon` 1MB/`cover` 10MB kinds, image MIME, the upload route's kind handling + isPublic/workspaceId semantics — read how `avatar` flows through `apps/web/src/app/api/files/upload/route.ts` and extend BOTH files), `packages/domain/src/pages/**` (update-path validation: the icon format [plain ≤32 chars | `url:` + same-origin `/api/files/<uuid>` or https ≤1024], coverUrl [same-origin file path or https], coverPreset whitelist, mutual exclusion coverUrl↔coverPreset [setting one clears the other; explicit null clears]; the `changed` emission gains `coverUrl`/`coverPreset`), `packages/domain/src/pages/dto/**` (+`COVER_PRESET_KEYS` const: sunset, ocean, forest, lavender, peach, slate, aurora, sand, berry, midnight); Create the migration; tests in the existing domain pages + web suites.

- [ ] **Step 1:** schema (+ regenerate) + migration via the shared-DB flow; verify `\d pages` shows the two columns.
- [ ] **Step 2 (TDD):** upload kinds — extend `validateUpload` + the route's kind switch (`icon`: 1MB, AVATAR_MIME; `cover`: 10MB, AVATAR_MIME; both isPublic true + workspaceId null with the avatar rationale comment; quota-exempt like avatars — document); extend the existing upload-route tests (find them: `ls apps/web/test | grep -i upload` — if none exist, add `apps/web/test/api/files-upload-kinds.test.ts` mirroring files-route.test.ts's style).
- [ ] **Step 3 (TDD):** domain validation + emission: extend the pages service/repo update path; the validation matrix red-first in the domain pages tests (emoji ok, 33-char plain rejected, url: file path ok, url: http rejected, preset whitelist, mutual exclusion, nulls clear); the emission test gains the cover fields in `changed`.
- [ ] **Step 4:** `pnpm --filter @repo/domain test` + `pnpm --filter web test` + `pnpm --filter @repo/trpc test` (page.update flows through trpc — update its zod input: read `packages/trpc/src/routers/page.ts` update input and widen) + check-types. **Step 5 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/* apps/web/src/lib/file-validation.ts apps/web/src/app/api/files/upload/route.ts packages/domain/src/pages packages/trpc/src/routers/page.ts packages/domain/test apps/web/test packages/trpc/test
git commit -m "feat(pages): icon format + cover fields — upload kinds, validation, emission"
```

---

## Task 2: PageIcon component + header cover band + pickers

**Files:** Create `apps/web/src/components/page/{page-icon.tsx,cover-band.tsx,cover-picker.tsx,icon-picker-popover.tsx}` + `apps/web/src/components/page/cover-presets.ts` (the CSS map keyed by COVER_PRESET_KEYS + the drift-guard unit test); Modify `page-header.tsx` (cover band + «Добавить обложку» ghost + the two-tab icon popover; keep the cache-patching idioms), the page route (`(active)/pages/[pageId]/page.tsx` — the cover renders inside the page column above the header), `workspace/page-tree-section.tsx` (+drag overlay), `workspace/page-tree-picker.tsx`, `database/database-item-modal.tsx` (icon both-forms + small cover band).

- [ ] **Step 1:** `PageIcon` (parse plain/url:, emoji span vs rounded img, size prop) + swap ALL raw icon renders; the drift-guard test (domain keys ≡ CSS map keys).
- [ ] **Step 2:** the cover band (image vs preset gradient; hover «Сменить/Убрать»; heights per spec) + the cover picker (tabs Градиенты/Загрузить/Ссылка; upload via `/api/files/upload?kind=cover`; URL input https-validated client-side too) + the icon popover gains the «Загрузить» tab (kind=icon). testids per spec §3.
- [ ] **Step 3:** the public-share page renders icon/cover (check what the share page renders today — `apps/web/src/app/s/[shareId]/**` or equivalent: find the public page component and add the cover/icon render; the resolver's page select may need the two fields — extend `ShareAccessRepository`'s selects + the web share-access lib pass-through).
- [ ] **Step 4:** web lint/check-types/build (env sourced, FOREGROUND). **Step 5 — commit:**
```bash
git add apps/web/src/components/page apps/web/src/components/workspace apps/web/src/components/database apps/web/src/app packages/domain/src/share-access apps/web/src/lib
git commit -m "feat(web): page icon component, cover band and pickers across all surfaces"
```
(Narrow paths.)

---

## Task 3: Manifest + install UX + help card

**Files:** Create `apps/web/src/app/manifest.ts`, `apps/web/src/app/icon-maskable/route.tsx` (or the metadata-convention equivalent — an ImageResponse at a STABLE url; check how icon.tsx/apple-icon.tsx are declared and mirror with padded safe-zone art), `apps/web/src/components/pwa/{pwa-install-context.tsx,install-prompt-banner.tsx}`, the help card in `/settings/general`; Modify `apps/web/src/app/layout.tsx` (viewport.themeColor), `apps/web/src/components/workspace/workspace-user-menu.tsx` (the MenuItem), `apps/web/src/app/(protected)/layout.tsx` (provider + banner mount).

- [ ] **Step 1:** manifest.ts per spec §4 (verify the `<link rel="manifest">` renders — curl the page); the maskable icon route (test: GET 200 + content-type png).
- [ ] **Step 2:** the install context (beforeinstallprompt capture, appinstalled, display-mode standalone detection) + the MenuItem (hidden unless canInstall) + the banner (one-time, localStorage dismiss) + the help card (the HONEST copy per spec — no offline-editing promises). testids per spec §4.
- [ ] **Step 3:** unit tests: the manifest fn shape; the banner under a synthetic beforeinstallprompt event (jsdom CustomEvent dispatch — the context must listen on window); the help copy assert. Web lint/check-types/build. **Step 4 — commit:**
```bash
git add apps/web/src/app/manifest.ts apps/web/src/app apps/web/src/components/pwa apps/web/src/components/workspace/workspace-user-menu.tsx apps/web/src/components/settings apps/web/test
git commit -m "feat(web): pwa manifest, install prompt surfaces, honest app help card"
```

---

## Task 4: Service worker growth (same URL/scope) + offline page

**Files:** Modify `apps/web/public/sw.js`; Create `apps/web/src/app/offline/page.tsx`; Create `apps/web/test/sw-source.test.ts` (the file-content guard).

- [ ] **Step 1:** grow sw.js per spec §4: SW_VERSION, install→precache `['/offline','/icon','/manifest.webmanifest']`, activate→cleanup+claim, fetch→same-origin GET NAVIGATION network-first with the /offline fallback + cache-first for the precached statics; the push/notificationclick handlers PRESERVED (and `'/icon.png'`→`'/icon'` fixed). Keep it dependency-free vanilla JS (it's a static asset — no build step).
- [ ] **Step 2:** `/offline` page (static, tiny, retry button; ensure it renders without a session — place it OUTSIDE (protected); RSC-pure).
- [ ] **Step 3 (the guard test):** read public/sw.js as text: asserts the `/api/` exclusion logic present, the push + notificationclick handlers present, `'/icon'` referenced and `'/icon.png'` ABSENT, SW_VERSION present, no `fetch` caching of non-GET (assert the method check string). Plus the push-flow regression: run the existing push-related unit/spec files (find them: grep push apps/web/test packages/notifications/test).
- [ ] **Step 4:** a LIVE smoke: dev server, curl /offline (200), curl /sw.js (content), curl /manifest.webmanifest (200 json). Web lint/check-types/build. **Step 5 — commit:**
```bash
git add apps/web/public/sw.js apps/web/src/app/offline apps/web/test/sw-source.test.ts
git commit -m "feat(pwa): conservative shell cache in the push service worker, offline fallback"
```

---

## Task 5: E2E + changelog

**Files:** Create `apps/e2e/appearance-pwa.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** per spec §5: manifest name; the page appearance journey (emoji icon → uploaded image icon [set a small fixture png via setInputFiles] → gradient cover → uploaded cover → remove both; sidebar shows the image icon); the public-share cover (make the page PUBLIC via the share dialog [plan-free setAccess], open anonymously, assert the cover band); the install banner + menu item under an init-script-dispatched beforeinstallprompt (`page.addInitScript` dispatching a constructible event with prompt/userChoice stubs — verify the event shape the context expects); the help card honesty assert.
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Приложение AnyNote и оформление страниц**

- Устанавливайте AnyNote как приложение (PWA): манифест, кнопка установки и честная справка о том, что работает офлайн, а что требует сети.
- Иконки страниц — эмодзи или своя картинка; обложки — градиенты, загрузка или ссылка. Видны везде: в дереве, карточках базы и на публичных страницах.
```
- [ ] **Step 3:** run (FOREGROUND, retries, 3100 free, .next wipe if a build preceded). **Step 4 — commits:**
```bash
git add apps/e2e/appearance-pwa.spec.ts && git commit -m "test(e2e): page icons and covers, public-share cover, pwa install surfaces"
git add docs/changelog.md && git commit -m "docs(changelog): pwa and page appearance"
```

---

## Completion

Group reviews: Tasks 1–2 (data+surfaces) then 3–5 (PWA+E2E). Final whole-branch review foci: (1) the SW contract — push handlers byte-equivalent in behavior, the same URL/scope, NO private-data caching (the /api/ exclusion + navigation-only logic adversarially read), the precache list bounded; (2) public-by-id file semantics for icon/cover kinds (quota exemption documented; no workspace leak vector — the files are world-readable by design: confirm nothing sensitive can be uploaded under these kinds beyond images); (3) the icon-format back-compat (existing emoji pages render untouched — pinned); (4) honest copy (manifest/help/banner never promise offline editing or Notion parity); (5) regression — page.update emission shape for 7A/7B consumers (changed-fields additive), the share-page payload, push registration untouched. Then full gates + the forced uncached sweep + the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T1 (validation/emission) + T2 (surfaces); §4→T3/T4; §5→per-task + T5.
- Type consistency: COVER_PRESET_KEYS (T1 domain) ↔ the web CSS map (T2, drift-guarded); PageIcon (T2) consumed by all four surfaces; the install context API (T3) consumed by the menu + banner + help card.
- Known risks named in-task: the share-page select extension (T2.3), the maskable-icon route convention (T3.1), the beforeinstallprompt event shape in E2E (T5.1), upload-route test home (T1.2).
