# Tabs + Synced Blocks (Phase 9C)

**Date:** 2026-06-17
**Status:** approved design (brainstorm decisions locked with the user) — this IS the roadmap-sanctioned synced-block design doc (cl9 line 166)
**Roadmap source:** `cl9.md` Prompt 9.2 sub-steps 5,6 — sub-phase 3 of 6.

Two editor additions: a tabs container block (light, clones the column-layout
shape) and full LIVE synced blocks — canonical content with its own Yjs
document, embeddable across pages, edits propagating in real time to every
instance, with origin-page access enforcement and safe copy/unsync/delete.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Tabs | A `tabs` container (parent `content: 'tab+'`, child `tab` `isolating content: 'block+'` with a `label` attr; `activeTab` on the parent). Tab strip NodeView + keyboard nav. Dual schema/server registration. One slash item. No models, no yjs change. |
| Synced blocks — liveness | **Live**: each block = a `SyncedBlock` entity with its OWN `syncedBlock:{id}` Hocuspocus document (a NEW document type in apps/yjs, prefix-routed). Host pages embed a `syncedBlock` atom node whose NodeView mounts a nested collaborative editor bound to that doc — edits on any page propagate live to all instances. |
| Unsync/delete | «Unsync this copy» inlines the canonical content as normal blocks in place of the node (this instance only). «Unsync all» marks the SyncedBlock `unsyncedAt`; instances detach lazily on next render. Delete = orphan (a `deletedAt`/origin-null) → instances show «удалён» placeholder. The cl9 safe rule: no synchronous remote deletion. |
| Access | The embedded-database precedent: `syncedBlock.getById` resolves originPageId → `assertPageAccess`; no access ⇒ a «Синхронизированный блок недоступен» placeholder, never content. The nested yjs doc's onAuthenticate runs the SAME origin-page check server-side. |

## 2. Tabs block (`packages/editor/src/extensions/`)

- `tabs.schema.ts` (+ register in server.ts): `tabs` node `group:'block' content:'tab+' defining:true` attr `{activeTab: number default 0}`; `tab` node `content:'block+' isolating:true` attr `{label: string default 'Вкладка'}`. renderHTML: server export renders ALL tabs stacked with `<strong>label</strong>` headers (PDF/HTML can't be interactive — show every tab's content labeled).
- `tabs.tsx`: ReactNodeViewRenderer — a tab strip (buttons per child tab, label-editable on the active tab; +add tab; reorder via the existing drag patterns optional; delete tab with the column-layout dissolve precedent — removing the last tab dissolves the block), the active tab's content visible (others `display:none` via the NodeView, NOT decoration — tab content IS shared doc content, the inactive ones just hidden in THIS render but present for all). Keyboard: arrow keys move between tab buttons (`role=tab`/`role=tabpanel`/`aria-selected`).
- An `appendTransaction` plugin (column-layout precedent): clamp `activeTab` to a valid index when tabs are added/removed; dissolve a tabs block with 0 tabs.
- Slash `/tabs` («Вкладки», a base/layout group) → insert a tabs block with two starter tabs.
- Pure tests: the activeTab-clamp reducer, the dissolve rule, the schema round-trip, the add/remove-tab transforms.

## 3. Synced blocks — data model

```prisma
model SyncedBlock {
  id           String    @id @default(uuid(7)) @db.Uuid
  workspaceId  String    @db.Uuid                 // cascade; workspace-scoped
  originPageId String?   @db.Uuid                 // SetNull on page delete — orphan-tolerant (the safe rule)
  content      Json?                              // JSON snapshot (export/preview/sanitize)
  contentYjs   Bytes?                             // authoritative — the `syncedBlock:{id}` doc bytes
  createdById  String?   @db.Uuid                 // scalar
  unsyncedAt   DateTime?                          // «unsync all» marker; instances detach lazily
  deletedAt    DateTime?                          // canonical deletion; instances show «удалён»
  createdAt / updatedAt
  @@index([workspaceId])
  // Workspace back-relation: syncedBlocks
}
```

No per-instance table (instances live only as `syncedBlock` nodes in host page
docs). `content`/`contentYjs` mirror `Page.content`/`Page.contentYjs` exactly.
The migration adds the model + the Workspace back-relation.

## 4. The `syncedBlock:{id}` Yjs document type (apps/yjs)

The core new infra. Today apps/yjs assumes `documentName === pageId` everywhere
(loadPageDocument, canAccessPage, loadPageMeta all `page.findUnique({id:
documentName})`). 9C makes `documentName` polymorphic via a `syncedBlock:`
prefix:

- `apps/yjs/src/index.ts onAuthenticate`: if `documentName.startsWith('syncedBlock:')` → extract blockId → `canAccessSyncedBlock(userId, blockId)` (resolve the block's originPageId, deletedAt null, then reuse the existing `canAccessPage` member/grant arms against originPageId; orphaned/deleted ⇒ deny). The share-token arm: synced blocks are NOT directly share-tokenable (a share-token is page-scoped); a public-share VIEWER of a host page sees the synced block content via the SERVER snapshot (the node's render-prop tRPC, read-only) — the nested LIVE doc is members/grant-only. Document this: anonymous public viewers get the read-only snapshot, not a live nested-doc connection.
- `apps/yjs/src/persistence.ts`: `loadSyncedBlockDocument(blockId)` (apply `SyncedBlock.contentYjs`) + `storeSyncedBlockDocument` (encode + write `SyncedBlock.contentYjs` AND the `TiptapTransformer.fromYdoc(doc,'default')` JSON snapshot to `SyncedBlock.content` — same as pages, so the render-prop/export read the snapshot). The Hocuspocus `onLoadDocument`/`onStoreDocument` branch on the prefix.
- `canAccessSyncedBlock` in `apps/yjs/src/auth.ts` — resolve originPageId, reuse the page member/grant logic (extract the shared arm so page + synced-block checks don't drift).
- Read-only mapping: a member with only VIEWER/COMMENTER access to the origin page connects read-only to the synced-block doc (the connectionConfig.readOnly precedent).

## 5. Synced block — editor node + nested editor (`packages/editor/src/`)

- `synced-block.schema.ts` (+ server.ts): `syncedBlock` atom node `group:'block' atom:true draggable:true` attr `{blockId}`. renderHTML = a static placeholder div with `data-block-id` (SSR/export fallback; the server export path uses the render-prop/snapshot, see §6).
- `synced-block.tsx`: ReactNodeViewRenderer — the NodeView calls an injected `renderSyncedBlock({blockId, editable})` (the embedded-database injection pattern); falls back to a placeholder when unwired. The app's renderer (apps/web) mounts a component that: (a) runs `syncedBlock.getById` (access-checked) → on NOT_FOUND/orphan/deleted ⇒ the «недоступен»/«удалён» placeholder; (b) on access + editable ⇒ mounts a NESTED `AnyNoteEditor`-equivalent bound to a `HocuspocusProvider({name:`syncedBlock:${blockId}`, token})` (the block-move cross-doc-provider precedent — a second provider is already proven to work in-editor); (c) on access + NOT editable (public share / VIEWER) ⇒ renders the read-only SNAPSHOT (the `content` JSON via a static renderer, no live connection). A visual boundary (a left accent border + a «синхронизированный блок» chip) marks instances.
- Insertion: `/synced-block`? NO — the canonical flow is «turn this content into a synced block» + «paste a synced block». MVP slash `/synced` («Синхронизированный блок») → a picker «создать новый» (creates an empty SyncedBlock + inserts a node) OR «вставить существующий» (a picker of the workspace's synced blocks the user can access). The node-toolbar «Скопировать ссылку на блок» yields a token the paste flow recognizes? KEEP IT SIMPLE: the slash picker + a «вставить как синхронизированный» action; cross-page insertion = the picker on page B selects the block created on page A.
- Node toolbar: «Открыть оригинал» (navigate to originPageId), «Скопировать как несинхронизированный» / «Отсоединить эту копию» (unsync this — see §7), «Перейти к управлению» (not MVP). The boundary chip shows instance count if cheap (a `syncedBlock.instanceCount`? deferred — counting requires scanning page docs; skip).

## 6. tRPC `syncedBlock.*` + copy/unsync

- `create {workspaceId, originPageId, initialContent?}` (member of the workspace + page edit access on originPageId) → creates the SyncedBlock (content seeded), returns {blockId}.
- `getById {blockId}` (the access-checked read): resolve originPageId → assertPageAccess; deletedAt/orphan ⇒ a typed «unavailable» result (NOT a throw that the node can't distinguish — return {status:'ok'|'no_access'|'deleted', content?, originPageId?} so the NodeView renders the right placeholder; access failure = 'no_access', never leak content).
- `list {workspaceId}` (the picker — synced blocks the caller can access, via per-block originPageId access; cap + simple).
- `unsyncAll {blockId}` (origin-page edit access) → set unsyncedAt; `delete {blockId}` (origin-page edit access) → set deletedAt. Both audited? (the WorkspaceAuditLog pattern — a small SYNCED_BLOCK action catalog, OR skip audit for MVP — DECIDE: skip, it's content not security; note).
- **Copy** (page duplicate / copy-to-workspace): extend `sanitizeCopiedContent` (the share-copy precedent) to handle `type:'syncedBlock'` — the JSON snapshot path. The decision: a copy KEEPS the synced reference (points at the same canonical) UNLESS cross-workspace (copy-to-workspace into a DIFFERENT workspace ⇒ the synced block isn't accessible there ⇒ DETACH: inline the canonical content as normal blocks, the sanitize-placeholder-becomes-inlined-content path). Same-workspace duplicate keeps the reference. Pin both. NOTE the contentYjs-bytes caveat: duplicatePageTx/copyTree copy bytes verbatim (can't cheaply rewrite Yjs) — so the JSON snapshot is sanitized but the bytes still carry the node; the runtime render-prop access check is the backstop (a cross-workspace viewer hits 'no_access' → placeholder). Document this honestly.

## 7. Unsync this copy (per-instance detach)

- Node toolbar «Отсоединить эту копию» → `syncedBlock.getById` to fetch the current `content` → the client replaces the `syncedBlock` node with that content inlined as normal blocks (deleteRange + insertContent) in THIS editor only. The canonical and other instances are untouched. Pure client + one tRPC read.
- «Unsync all» = the server `unsyncedAt` mark; each OTHER instance, on its next render, sees `getById` return `{status:'unsynced', content}` and auto-inlines+detaches locally (lazy, per-viewer-session — honest, since remote Y.Docs aren't synchronously reachable). The node, once detached, is gone from that page's doc on the next collab save.

## 8. Security invariants (test-pinned)

1. A synced block NEVER shows content to a viewer without origin-page access: `getById` returns 'no_access' (assertPageAccess-gated) and the nested yjs doc's onAuthenticate runs `canAccessSyncedBlock` (the SAME origin-page member/grant check) — a member of the workspace who can't see the origin PERSONAL-collection page gets the placeholder, NOT the content. Pinned at both the tRPC and the yjs-auth layers.
2. The nested yjs document is access-gated identically to pages (read-only for VIEWER/COMMENTER origin access; denied for no-access/orphan/deleted); a forged `syncedBlock:` documentName with a block the user can't reach ⇒ onAuthenticate rejects.
3. Copy safety: cross-workspace copy DETACHES (inlines content, no dangling cross-workspace reference); the runtime access check is the backstop for the un-rewritable contentYjs bytes (a cross-workspace viewer ⇒ 'no_access' placeholder, never leak). Same-workspace duplicate keeps the live reference. Pinned.
4. Delete/unsync are origin-page-edit-gated; delete orphans (no synchronous remote deletion — the safe rule); instances degrade to placeholders.
5. Tabs: content per tab is real shared doc content (round-trips through serialize; export renders all tabs labeled) — NOT per-viewer state (contrast collapsible-headings).

## 9. Testing

- Editor unit: tabs (clamp/dissolve/round-trip/add-remove); synced-block schema round-trip + the node attrs; the sanitizeCopiedContent synced-block transform (keep-reference vs detach-inline).
- yjs unit (apps/yjs): the documentName prefix routing (page vs syncedBlock), `canAccessSyncedBlock` (member ok / no-origin-access denied / orphan denied / deleted denied / grant-on-origin ok / blocked denied), loadSyncedBlockDocument/store round-trip — extend the existing auth.spec.
- tRPC: syncedBlock.create (page-edit-gated), getById (the access matrix — ok/no_access/deleted/unsynced shapes; a foreign PERSONAL-origin block ⇒ no_access), list (access-filtered), unsyncAll/delete (origin-edit-gated), the copy transform (cross-workspace detach via the sanitize path).
- E2E (`tabs-synced.spec.ts`, the yjs-LESS caveat — assert in-session only): tabs — /tabs → two tabs → click tab 2 → tab-2 content visible, tab-1 hidden; add a tab; the keyboard nav (arrow). Synced blocks — the LIVE cross-page propagation is UN-E2E-able without a yjs server (documented; covered by unit/tРПС); so the E2E asserts: /synced → create → the boundary chip renders; the «недоступен» placeholder path (seed a synced block whose origin is a SECOND user's PERSONAL page via prisma → the first user's node shows the placeholder); «отсоединить эту копию» inlines content in-session.
- Full gates (build-first then forced sweep — the 9B cold-build-race lesson) + changelog «Вкладки и синхронизированные блоки».

## 10. Non-goals

- Synced-block instance counting / a management dashboard (scanning page docs is expensive — deferred).
- Live unsync-all (it's lazy-per-instance by decision — instant global rewrite needs a server-side Yjs job, no precedent).
- Public-share LIVE nested-doc connections (anonymous viewers get the read-only snapshot; members/grants get live).
- Synced blocks inside synced blocks (nesting — guard against / disallow at insert).
- Tab drag-reorder polish / tab icons (labels only); tabs inside tabs (allowed structurally but no special UX).
- Converting a tabs block ↔ columns; synced-block ↔ tabs interplay beyond containment.
