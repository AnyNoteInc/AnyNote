# Tabs + Synced Blocks Implementation Plan (Phase 9C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tabs container block + full LIVE synced blocks (own Yjs document, cross-page real-time edits, origin-page access enforcement, safe copy/unsync/delete) — per `docs/superpowers/specs/2026-06-17-tabs-synced-blocks-design.md` (THE SPEC; normative).

**Architecture:** Tabs clones the column-layout container. Synced blocks = a `SyncedBlock` entity + a NEW `syncedBlock:{id}` Hocuspocus document type in apps/yjs (prefix-routed auth/load/store reusing the page access logic) + a `syncedBlock` atom node whose NodeView mounts a nested collaborative editor (the block-move cross-doc-provider precedent) or the read-only snapshot, via the embedded-database render-prop injection + access-checked tRPC.

**Template files:** `packages/editor/src/extensions/{column-layout.schema.ts,column-layout.ts,column-layout.dissolve.test.ts}` (tabs container), `packages/editor/src/extensions/{embedded-database.schema.ts,embedded-database.tsx}` + `apps/web/src/components/database/embedded-database-embed.tsx` + `packages/trpc/src/routers/database/source.ts` (the node-references-entity + access-check + render-prop pattern — THE synced-block template), `packages/editor/src/lib/block-move.ts` (the proven in-editor second-HocuspocusProvider), `apps/yjs/src/{index.ts,auth.ts,persistence.ts}` (the document lifecycle to make prefix-polymorphic), `packages/domain/src/share-copy/services/sanitize-copied-content.ts` (the copy transform), `packages/trpc/src/helpers/page-access.ts` (assertPageAccess), `apps/yjs/src/auth.spec.ts`.

**Shared-dev-DB migration rule (Task 3):** the established diff→psql→resolve flow (one model).

**Test discipline:** editor unit = pure (prosemirror-model Schema from NodeSpecs); yjs unit extends auth.spec; tRPC real-DB fixture-scoped; E2E yjs-LESS (assert in-session; live cross-page propagation is unit/tRPC-covered, NOT E2E). Build-first-then-forced-sweep for the merge gate (the 9B cold-build-race lesson).

**Commits:** explicit paths, NEVER `git add -A`.

---

## Task 1: Tabs block

**Files:** Create `packages/editor/src/extensions/{tabs.schema.ts,tabs.tsx,tabs.test.ts}`; Modify `packages/editor/src/extensions/{index.ts,server.ts}`, `packages/editor/src/slash-items.ts`, `apps/web/src/server/page-export/server-extensions.ts` (register the tabs schema for export).

- [ ] **Step 1 (TDD pure):** `tabs.schema.ts` — `tabs` (group block, content 'tab+', defining, attr activeTab default 0), `tab` (content 'block+', isolating, attr label default 'Вкладка'); parseHTML/renderHTML (server export = ALL tabs stacked with `<strong>{label}</strong>` headers). Pure tests: schema round-trip, the activeTab-clamp reducer (clamp to [0, tabCount-1] on add/remove), the dissolve rule (0 tabs ⇒ remove the block; the column-layout.dissolve precedent), add-tab/remove-tab transforms.
- [ ] **Step 2:** `tabs.tsx` NodeView — tab strip (role=tab buttons, label-edit on active, +add, delete-tab→dissolve-on-last), active tab content shown / others display:none (in THIS render; content is shared), arrow-key nav (role=tablist/tab/tabpanel, aria-selected); the appendTransaction plugin (clamp activeTab + dissolve). Register in index.ts + server.ts + server-extensions.ts. Slash `/tabs` («Вкладки») → insert with 2 starter tabs.
- [ ] **Step 3:** `pnpm --filter @repo/editor test && check-types && lint` + (env sourced, FOREGROUND) `pnpm --filter web build`. **Step 4 — commit:**
```bash
git add packages/editor/src apps/web/src/server/page-export/server-extensions.ts
git commit -m "feat(editor): tabs block — labeled sections, keyboard nav, dissolve"
```

---

## Task 2: SyncedBlock schema + the syncedBlock Yjs document type

**Files:** Modify `packages/db/prisma/schema.prisma` (SyncedBlock model + Workspace back-relation), `apps/yjs/src/{index.ts,auth.ts,persistence.ts}` + `apps/yjs/src/auth.spec.ts`; Create the migration.

- [ ] **Step 1:** schema (SyncedBlock per spec §3 — uuid(7), workspaceId cascade, originPageId SetNull, content Json?/contentYjs Bytes?, createdById scalar, unsyncedAt/deletedAt) + Workspace.syncedBlocks back-relation; migration via the shared-DB flow; verify `\d synced_blocks`.
- [ ] **Step 2 (TDD):** `canAccessSyncedBlock(prisma, userId, blockId)` in auth.ts — resolve the block (deletedAt null), then reuse the page member/grant arms against originPageId (EXTRACT the shared arm from canAccessPage so they don't drift — a `canAccessPageRow`/inline helper; orphan [originPageId null] or deleted ⇒ deny). Returns the same {access, role/readOnly} shape canAccessPage returns (so index.ts maps readOnly identically). Extend auth.spec.ts: member-ok, no-origin-access-denied, orphan-denied, deleted-denied, grant-on-origin-ok, blocked-denied, VIEWER-origin⇒readOnly.
- [ ] **Step 3:** `index.ts onAuthenticate` — branch on `documentName.startsWith('syncedBlock:')` → extract blockId → canAccessSyncedBlock (the workspace JWT arm; the share-token arm does NOT apply to synced docs — anonymous/share viewers never connect to a `syncedBlock:` doc [they get the snapshot]; reject share-token on a syncedBlock: name). `persistence.ts` — loadSyncedBlockDocument(blockId) / storeSyncedBlockDocument (write SyncedBlock.contentYjs + the TiptapTransformer JSON snapshot to .content, mirroring pages); onLoadDocument/onStoreDocument branch on the prefix. EXTRACT the prefix-parse into a tested helper (`parseDocumentName(name) → {kind:'page'|'syncedBlock', id}`).
- [ ] **Step 4:** `pnpm --filter yjs test && pnpm --filter yjs check-types && pnpm --filter @repo/db check-types && pnpm check-types`. **Step 5 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/* apps/yjs/src
git commit -m "feat(yjs): synced-block document type — prefix-routed auth, load, store, access check"
```

---

## Task 3: tRPC `syncedBlock.*` router + the copy transform

**Files:** Create `packages/trpc/src/routers/synced-block.ts`, `packages/trpc/test/synced-block-router.test.ts`; Modify `packages/trpc/src/index.ts`, `packages/domain/src/share-copy/services/sanitize-copied-content.ts` (+ its test); possibly a domain synced-block read helper.

- [ ] **Step 1 (TDD):** the router — `create {workspaceId, originPageId, initialContent?}` (assertPageAccess EDIT on originPageId; create the SyncedBlock with content seeded + an empty contentYjs the nested editor will fill; returns {blockId}); `getById {blockId}` (resolve originPageId → assertPageAccess; returns a TYPED result {status:'ok'|'no_access'|'deleted'|'unsynced', content?, originPageId?} — 'no_access' on the access throw [catch it], never leak content; deletedAt⇒'deleted', unsyncedAt⇒'unsynced' WITH content [so the instance can inline-detach]); `list {workspaceId}` (the workspace's synced blocks the caller can access — per-block originPageId access filter, capped); `unsyncAll {blockId}` + `delete {blockId}` (origin-page EDIT-gated → set unsyncedAt/deletedAt). Mount syncedBlock: in index.ts.
- [ ] **Step 2 (TDD):** extend `sanitizeCopiedContent` — handle `type:'syncedBlock'`: same-workspace copy KEEPS the node (reference preserved); cross-workspace copy (the copy target workspace ≠ the block's workspace — the sanitize context has the target workspaceId? check what context it gets; if not, the transform needs the source/target workspace — thread it) DETACHES (replace the node with the resolved canonical content inlined, OR the existing placeholder-paragraph if content unavailable). Document the contentYjs-bytes caveat (the JSON snapshot is sanitized; bytes copy verbatim; runtime access check is the backstop).
- [ ] **Step 3 (tests, fixture-scoped):** create page-edit-gated (a non-editor ⇒ FORBIDDEN); getById matrix (ok / a foreign-PERSONAL-origin block ⇒ no_access [never content] / deleted / unsynced-with-content); list access-filtered; unsyncAll/delete origin-edit-gated; the sanitize transform (same-ws keep, cross-ws detach).
- [ ] **Step 4:** `pnpm --filter @repo/trpc test && pnpm --filter @repo/domain test && check-types && lint`. **Step 5 — commit:**
```bash
git add packages/trpc/src/routers/synced-block.ts packages/trpc/src/index.ts packages/trpc/test/synced-block-router.test.ts packages/domain/src/share-copy packages/domain/test
git commit -m "feat(trpc): synced-block router — create, access-checked getById, list, unsync, delete, copy transform"
```

---

## Task 4: The synced-block editor node + nested editor + app wiring

**Files:** Create `packages/editor/src/extensions/{synced-block.schema.ts,synced-block.tsx,synced-block.test.ts}`, `apps/web/src/components/page/synced-block-embed.tsx`; Modify `packages/editor/src/extensions/{index.ts,server.ts}`, `packages/editor/src/{slash-items.ts,anynote-editor.tsx,types.ts}`, `apps/web/src/components/page/page-renderer.tsx`, `apps/web/src/server/page-export/server-extensions.ts`.

- [ ] **Step 1:** `synced-block.schema.ts` (atom block, attr {blockId}, draggable; renderHTML = placeholder div with data-block-id) + server registration; `synced-block.tsx` NodeView calling the injected `renderSyncedBlock({blockId, editable})` (the embedded-database injection — addOptions renderEmbed null, fallback placeholder); a visual boundary (left accent + «синхронизированный блок» chip). Pure tests: schema round-trip, attrs.
- [ ] **Step 2:** `apps/web/src/components/page/synced-block-embed.tsx` — runs `syncedBlock.getById`; 'no_access'/'deleted'/orphan ⇒ the right placeholder («недоступен»/«удалён»); 'unsynced' ⇒ auto-inline the content + detach the node (the lazy unsync-all); 'ok' + editable ⇒ mount a nested collaborative editor bound to `HocuspocusProvider({name:`syncedBlock:${blockId}`, token via the same /api/yjs/token mint — VERIFY the token mints for a syncedBlock name or needs a variant: the token is page-keyed today? check apps/web/src/app/api/yjs/token + how anynote-editor gets its token; the nested doc needs a token whose access the yjs onAuthenticate accepts — likely the SAME workspace JWT works since canAccessSyncedBlock re-checks; confirm the token isn't pageId-bound}); 'ok' + not editable ⇒ the read-only snapshot (render the `content` JSON statically — a server/static renderer, NO live connection). The block-move.ts second-provider is the proof this works in-editor.
- [ ] **Step 3:** wiring — page-renderer passes `renderSyncedBlock` + the slash handlers (openSyncedBlockPicker: «создать новый» → syncedBlock.create + insert; «вставить существующий» → syncedBlock.list picker → insert) into buildExtensions; the node toolbar «Открыть оригинал» / «Отсоединить эту копию» (getById content → inline + delete node, this instance) / (unsync-all + delete live in settings/the canonical's toolbar — MVP: «Отсоединить эту копию» on every instance + «Отсоединить все»/«Удалить» on the instance whose page IS the origin, or always-available calling the router). Slash `/synced` → the picker.
- [ ] **Step 4:** `pnpm --filter @repo/editor test && check-types && lint` + `pnpm --filter web lint && check-types` + (env sourced, FOREGROUND) `pnpm --filter web build`; a LIVE dev-server smoke: create a synced block, see the nested editor mount, type in it. **Step 5 — commit:**
```bash
git add packages/editor/src apps/web/src/components/page apps/web/src/server/page-export/server-extensions.ts
git commit -m "feat(editor): synced-block node — nested collaborative editor, access placeholders, detach"
```

---

## Task 5: E2E + changelog

**Files:** Create `apps/e2e/tabs-synced.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (yjs-LESS — assert in-session; the live cross-page propagation is unit/tRPC-covered, NOT here): Tabs — /tabs → two starter tabs → click «Вкладка 2» → tab-2 panel visible + tab-1 hidden; add a tab; arrow-key moves the active tab. Synced — /synced → «создать новый» → the boundary chip + nested editor mount (assert the chip + an editable nested surface in-session); the «недоступен» placeholder (seed a SyncedBlock whose originPageId is a SECOND user's PERSONAL page via prisma, insert a syncedBlock node referencing it on the first user's page via... the editor insert needs the blockId — create the block as the second user, then the first user's /synced «вставить существующий» won't list it [no access] — so instead: the access placeholder is best asserted at the tRPC/unit layer; for E2E, assert «Отсоединить эту копию» inlines content in-session on an OWN synced block). Keep the E2E honest about what's assertable; the cross-user placeholder is a tRPC test.
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Вкладки и синхронизированные блоки**

- Раскладывайте содержимое по вкладкам прямо на странице.
- Синхронизированные блоки: один и тот же блок на нескольких страницах редактируется вживую и обновляется везде; доступ наследуется от страницы-оригинала, отсоединить копию можно в любой момент.
```
- [ ] **Step 3:** run (FOREGROUND, retries, 3100 free, .next wipe if a build preceded; the picker-tab-state + drag-overlay-click lessons from 9A/9B). **Step 4 — commits:**
```bash
git add apps/e2e/tabs-synced.spec.ts && git commit -m "test(e2e): tabs block, synced-block create + detach"
git add docs/changelog.md && git commit -m "docs(changelog): tabs and synced blocks"
```

---

## Completion

Group reviews: Tasks 1–3 (tabs + yjs infra + router) then 4–5 (node + E2E). Final whole-branch review foci: (1) the synced-block access chain end-to-end — getById 'no_access' is leak-free AND the nested yjs doc's onAuthenticate runs the SAME origin-page check (a workspace member who can't see a PERSONAL origin page gets the placeholder at BOTH layers; a forged syncedBlock: documentName rejected); (2) the document-type routing — page docs unaffected (the prefix branch doesn't change pageId handling; parseDocumentName total), store writes the right table; (3) copy safety — cross-workspace detaches, the contentYjs-bytes-verbatim caveat backstopped by the runtime check (pinned); (4) unsync/delete origin-edit-gated, delete orphans (no synchronous remote deletion); (5) regression — the existing collab/editor-mount/page-render flows untouched, the second-provider doesn't leak connections (cleanup on unmount — the block-move precedent + the 9B isDestroyed lesson), tabs content round-trips through export. Then build-first + full gates + the forced uncached sweep + the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T2 (model); §4→T2 (yjs doc type); §5→T4 (node+nested); §6→T3 (router+copy) + T4 (wiring); §7→T4 (detach); §8 invariants pinned across T2-T4 + final; §9→per-task + T5.
- Type consistency: parseDocumentName (T2) used by index.ts+persistence.ts; canAccessSyncedBlock (T2) shape == canAccessPage (so index.ts readOnly mapping is shared); getById typed result (T3) consumed by synced-block-embed (T4); renderSyncedBlock injection (T4) the embedded-database pattern; the sanitize transform (T3) consumed by the copy flows.
- Known risks named in-task: the yjs token minting for a syncedBlock name (T4.2 — verify the workspace JWT works, not pageId-bound), the sanitize context's workspace awareness (T3.2 — thread target ws if absent), the nested-editor cleanup/leak (T4 + final review), the cross-user-placeholder un-E2E-ability (T5 — tRPC-covered).
