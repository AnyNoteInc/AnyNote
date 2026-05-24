# Inline page comments — Design Spec

**Date:** 2026-05-24
**Status:** Draft, awaiting user review
**Branch:** `feat/page-comments`

## Summary

Add **inline, anchored comments** to TEXT pages (Notion / Google-Docs style): select text → start a **thread** anchored to that range; reply in the thread; **resolve / reopen** it. This is **spec #2 of 2** — it lights up the **COMMENTER** role that page sharing (spec #1) reserved as read-only-for-content.

This is the feature the codebase was pre-wired for: the notification system already ships unused `COMMENT_CREATED` and `PAGE_MENTION` types with a wired `notify.commentCreated(...)` helper and UI formatting; `filterMentionItems` + `workspace.listMembers` power @mentions; the kanban `TaskComment` + `kanbanBus` give a storage/realtime precedent; the editor has a custom-Mark pattern and a decoration-plugin pattern (`drop-placement.ts`).

**The defining constraint comes from spec #1:** a COMMENTER's Yjs connection is **read-only** (server-enforced via `connectionConfig.readOnly`). Therefore comment anchors **cannot be Tiptap marks in the document** (a commenter could not write them). Instead:

- **Anchors** are encoded **Yjs `RelativePosition`s** stored in Postgres and rendered as **ProseMirror decorations** (view-only, never written to the doc) — so read-only commenters and anonymous viewers can both anchor and see comments.
- **Threads + messages** live in **Postgres** (`PageCommentThread` + `PageComment`), served by a tRPC router, kept separate from page content (enables per-comment authorization, moderation, notifications, and counts).

**Anonymous commenting is allowed** on a public COMMENTER/EDITOR link (user decision): comments cannot assume a logged-in author, so the author model is nullable + a display name + an anon session id, and the comment API is a **`publicProcedure`** authorized by session **or** `shareId` (anonymous users have no tRPC session — same situation as the share-token route).

---

## 1. Goals & Non-goals

### Goals

- Select text in a TEXT page → **«Комментировать»** in the floating toolbar → create a thread anchored to the range.
- A thread is a list of comments; **reply**, **edit/delete own**, **resolve/reopen**. Resolved threads drop their highlight (visible only in the panel).
- **Inline highlight** on commented ranges (decoration) + a **thread popover** on click, plus a toggleable right-hand **«Комментарии»** panel (Active / Resolved filter; click a thread → scroll to + flash the anchor).
- Works for every viewer class the sharing model produces: workspace members (COMMENTER/EDITOR/OWNER), named grants, public-link users, and **anonymous** public-link commenters. READER can view threads but not write.
- **@mentions** in comments (reusing `filterMentionItems`) + **notifications**: `COMMENT_CREATED` to thread participants + page author; `PAGE_MENTION` to mentioned users (both already in the notification catalog).
- Anchors survive concurrent edits (Yjs `RelativePosition`); deleted-anchor threads become **orphaned** (shown by `quotedText`, auto-detached from the doc).
- Realtime: live for workspace members (in-memory bus + tRPC subscription, like kanban); refetch-on-focus for public/anonymous viewers.

### Non-goals

- **No comments on non-TEXT page types** (Excalidraw/Mermaid/etc.) in v1 — anchoring is ProseMirror/Tiptap-specific. The model is page-generic; other types are a follow-up.
- **No suggestions / track-changes** (this is comments only).
- **No cross-server realtime fan-out** — the bus is in-memory (same as kanban). Anonymous viewers poll/refetch rather than subscribe.
- **No rich text inside a comment** beyond plain text + @mentions in v1 (no images/attachments in comments).
- **No comment reactions / emoji** in v1.
- **No robust anonymous identity** — an anon author is a client-held `anonId` (uuid in localStorage); same-session edit/delete only. Owners/editors moderate (delete any).

---

## 2. Architecture overview

```
Author (member / grant / public-link / anonymous) selects text
  └─ FloatingToolbar «Комментировать»
       └─ comment-anchor.ts: absolutePositionToRelativePosition(from,to) + quotedText   (read op; works read-only)
            └─ comment.createThread { pageId, shareId?, anonId?, anchorStart, anchorEnd, quotedText, content }
                 │   tRPC publicProcedure → resolveCommentContext(session, pageId|shareId, anonId)
                 │     role: member ▸ named-grant ▸ public-link ; author: userId | {anonId,"Гость·X"}
                 │     write requires role ∈ {COMMENTER, EDITOR, OWNER}
                 ├─ insert PageCommentThread + first PageComment (Postgres)
                 ├─ notify.commentCreated → thread participants + page author (minus actor)
                 ├─ PAGE_MENTION → each content.mentions[] user
                 └─ pageCommentBus.emit(pageId, 'thread.upserted')

Every viewer (incl. READER + anonymous):
  comment.listThreads({ pageId | shareId }) → React feeds editor.commands.setCommentThreads(...)
    └─ comments ProseMirror plugin: resolve RelativePosition→absolute (y-prosemirror binding)
         → Decoration.inline(highlight, data-thread-id)   (never written to the doc)
         → click → onOpenThread(threadId) → thread popover (replies, Решить/Открыть)
  «Комментарии» side panel: all threads, Active/Resolved filter, click → scroll+flash anchor

Realtime: members → pageCommentBus + tRPC subscription (invalidate list); public/anon → refetch on focus + after own mutation
```

Two sources of truth, cleanly separated: the **Y.Doc** owns page content (unchanged); **Postgres** owns comment threads/messages and their anchors. The anchor is the only link between them, and it's resolved **client-side, read-only**.

---

## 3. Data model (Prisma)

`packages/db/prisma/schema.prisma`:

```prisma
model PageCommentThread {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  pageId       String    @map("page_id") @db.Uuid
  anchorStart  String    @map("anchor_start") @db.Text          // base64 Yjs RelativePosition
  anchorEnd    String    @map("anchor_end") @db.Text
  quotedText   String    @map("quoted_text") @db.Text           // anchored text snapshot (orphan display)
  resolvedAt   DateTime? @map("resolved_at") @db.Timestamptz(6)
  resolvedById String?   @map("resolved_by_id") @db.Uuid
  createdById  String?   @map("created_by_id") @db.Uuid          // null = anonymous
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)

  page        Page          @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdBy   User?         @relation("PageCommentThreadAuthor", fields: [createdById], references: [id], onDelete: SetNull)
  comments    PageComment[]

  @@index([pageId])
  @@map("page_comment_threads")
}

model PageComment {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  threadId     String    @map("thread_id") @db.Uuid
  authorId     String?   @map("author_id") @db.Uuid             // null = anonymous
  authorName   String    @map("author_name") @db.VarChar(255)   // display name at write time
  authorAnonId String?   @map("author_anon_id") @db.VarChar(64) // anon session id → own edit/delete
  content      Json                                              // { text: string, mentions: string[] }
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt    DateTime  @updatedAt @map("updated_at") @db.Timestamptz(6)
  deletedAt    DateTime? @map("deleted_at") @db.Timestamptz(6)   // soft delete

  thread      PageCommentThread @relation(fields: [threadId], references: [id], onDelete: Cascade)
  author      User?             @relation("PageCommentAuthor", fields: [authorId], references: [id], onDelete: SetNull)

  @@index([threadId, createdAt])
  @@map("page_comments")
}
```

Back-relations on `Page` (`commentThreads PageCommentThread[]`) and `User` (`pageCommentThreadsAuthored`, `pageCommentsAuthored`). Migration: `prisma migrate dev --name page_comments`.

- `authorId` nullable + `authorName` always stored + `authorAnonId` for anonymous same-session edit/delete; `onDelete: SetNull` (repo convention — comments survive author deletion, falling back to the stored `authorName`).
- `content` JSON = `{ text, mentions: string[] }` (mentioned userIds), parsed server-side for `PAGE_MENTION`.

---

## 4. Access & authorization

New tRPC helper `resolveCommentContext` (`packages/trpc/src/helpers/comment-access.ts`):

```ts
resolveCommentContext(ctx, input: { pageId?: string; shareId?: string; anonId?: string })
  → { pageId, workspaceId, role: EffectiveRole | null, author: { userId?: string; anonId?: string; name: string } }
```

Resolution (mirrors `resolveShareAccess` but keyed by pageId/shareId + `ctx.user` which may be null):
1. signed-in workspace member → mapped role; author = user.
2. signed-in named grant (`PageShareUser`) → grant role; author = user.
3. `shareId` present + `PageShare.access === PUBLIC` → `linkRole`; author = user (if signed-in) or `{ anonId, name: "Гость · <animal>" }`.
4. else → `role: null`.

| Action | Allowed |
|---|---|
| `listThreads` (view) | any non-null role (incl. READER) and anonymous-with-public-link |
| `createThread` / `addComment` | role ∈ `{COMMENTER, EDITOR, OWNER}` |
| `editComment` / `deleteComment` (own) | author: `authorId === user.id` **or** `authorAnonId === input.anonId` |
| `deleteComment` (any — moderation) | page author **or** workspace `OWNER`/`ADMIN`/`EDITOR` |
| `resolveThread` / `reopenThread` | role ∈ `{COMMENTER, EDITOR, OWNER}` (anyone who can comment) |

- The `comment.*` router is **`publicProcedure`** (anonymous has no session); every procedure calls `resolveCommentContext` first and rejects `READER` / no-access on writes.
- A signed-in user passes `pageId`; an anonymous user must pass `shareId` (+ `anonId`). Resolution prefers the session when present.

---

## 5. tRPC API

New router `comment.*` (`packages/trpc/src/routers/comment.ts`), mounted at the app-router root:

```
comment.listThreads({ pageId?, shareId? })
   → [{ id, anchorStart, anchorEnd, quotedText, resolvedAt, createdBy,
        comments: [{ id, author{id?,name}, content, createdAt, updatedAt, deletedAt }] }]
comment.createThread({ pageId?, shareId?, anonId?, anchorStart, anchorEnd, quotedText, content })  → thread
comment.addComment({ pageId?, shareId?, anonId?, threadId, content })                              → comment
comment.editComment({ pageId?, shareId?, anonId?, commentId, content })                            → comment
comment.deleteComment({ pageId?, shareId?, anonId?, commentId })                                    → { ok }
comment.resolveThread({ pageId?, shareId?, threadId })                                              → thread
comment.reopenThread({ pageId?, shareId?, threadId })                                               → thread
comment.events.subscribe({ pageId })   // members only; yields { kind: 'thread.upserted'|'thread.deleted', threadId }
```

- `content` input = `{ text: string (1..5000), mentions: string[] (uuid[]) }`.
- `createThread`/`addComment` fan out notifications (§6) and `pageCommentBus.emit`.
- `editComment`/`deleteComment` enforce author/moderation rules (§4); delete is soft (`deletedAt`); a thread whose comments are all deleted is itself soft-removed (no dangling highlight).
- Mention userIds are validated to be workspace members before notifying (drop unknown ids).

---

## 6. Notifications & mentions (reuse existing infra)

- On `createThread`/`addComment`: `notify.commentCreated(prisma, { userId, workspaceId, pageId, commentId, actorId?, actorName, snippet })` to **distinct thread participants + the page author**, excluding the actor. `actorId` is omitted for an anonymous actor; `actorName = "Гость · X"`. `COMMENT_CREATED` is already in the catalog (EMAIL+IN_APP, IN_APP locked) and formatted in `format-notification.tsx` — no new wiring beyond calling the helper.
- On `content.mentions[]`: `PAGE_MENTION` to each mentioned user (skip a user already receiving `COMMENT_CREATED` for this event to avoid double-notify). `resourceUrl` deep-links to `…/pages/{pageId}#comment-{commentId}`.
- Composer @-autocomplete reuses `filterMentionItems` + `workspace.listMembers` (so anonymous users can only mention workspace members). Stored mentions render as chips in the comment body.

---

## 7. Editor integration (`@repo/editor`)

- **`extensions/comments.ts`** — Tiptap extension + ProseMirror plugin. Plugin state holds the thread anchor list (fed from React via `editor.commands.setCommentThreads(threads)`); on every transaction it resolves each active thread's `anchorStart/End` (`RelativePosition`) → absolute range via the y-prosemirror binding (`ySyncPluginKey.getState(state).binding`, `relativePositionToAbsolutePosition`) and builds a `DecorationSet` of `Decoration.inline` highlights (class `comment-highlight`, `data-thread-id`). A click handler maps the click position to the topmost thread → `onOpenThread(threadId)`. Resolved threads are excluded (no highlight).
- **`comment-anchor.ts`** — pure-ish helpers: `selectionToAnchor(view)` → `{ anchorStart, anchorEnd, quotedText }` (encode `RelativePosition`s for the current selection via `absolutePositionToRelativePosition`); `anchorToRange(view, anchor)` → `{ from, to } | null` (null ⇒ orphaned). Isolated so the Yjs/y-prosemirror plumbing is testable on its own.
- **FloatingToolbar** — add a «Комментировать» button (guarded by `canComment`) that calls `props.onCreateComment(selectionToAnchor(view))`.
- **Composer** — lightweight input with @-mention autocomplete; emits `{ text, mentions }`.
- **New `AnyNoteEditorProps`:** `commentThreads`, `onCreateComment`, `onOpenThread`, `canComment` (optional; default `canComment=false` so existing call sites are unaffected). `PageRenderer` and `SharePageClient` thread these through.
- Thread popover + «Комментарии» side panel are app-level components (`apps/web/src/components/page/comments/`) driven by the tRPC data; the editor only owns highlights + the create/open callbacks.

---

## 8. UI

```
┌─ page ─────────────────────────────────────┬─ «Комментарии» panel (toggle) ─┐
│  …plain ▢▢▢ text with ░░highlight░░…        │  ● Активные (3)   ○ Решённые   │
│                         ▲ click → popover   │ ┌────────────────────────────┐ │
│                    ┌────┴───────────────┐   │ │ «…quoted…»                 │ │
│                    │ Гость·Лис    2 мин │   │ │ Гость·Лис: вопрос?         │ │
│                    │ вопрос?            │   │ │ Вы: ответ                  │ │
│                    │ [ответить…] [Решить]│  │ │                  [Решить]  │ │
└────────────────────┴────────────────────┴───┴────────────────────────────────┘
```

- Inline highlight (decoration) + click → **thread popover** (tippy-positioned, like slash/mention) with the comment list, a reply composer, and **Решить**.
- A toggleable right **«Комментарии»** panel (toggle lives in the page toolbar / actions menu) listing threads with an **Активные / Решённые** filter; clicking a thread scrolls to and flashes its anchor. Orphaned (deleted-anchor) threads appear under Resolved with their `quotedText`.
- On the `/s/{shareId}` share route the same UI renders; anonymous users get an `anonId` (localStorage) and a generated display name, and the composer is enabled when the link role is COMMENTER/EDITOR.

---

## 9. Realtime

- **`pageCommentBus`** (`packages/trpc/src/realtime/`) — in-memory pub/sub mirroring `kanbanBus`. `createThread`/`addComment`/`edit`/`delete`/`resolve` emit `{ kind, threadId }`.
- **Members:** `comment.events.subscribe({ pageId })` (authorized via workspace membership) → client invalidates `comment.listThreads` → highlights + panel update live.
- **Public / anonymous:** no subscription in v1 — refetch `listThreads` on window focus + immediately after the viewer's own mutation. (Anonymous subscriptions are a documented follow-up.)

---

## 10. Testing

- **Unit** (`packages/trpc`): `resolveCommentContext` matrix — {member, named-grant, public, anonymous} × {READER, COMMENTER, EDITOR, OWNER} → can-view / can-write / deny; notification fan-out (one `commentCreated` per distinct participant minus actor; `PAGE_MENTION` per mentioned user; no double-notify; anonymous actor → name-only).
- **tRPC** (`packages/trpc`): `comment.*` CRUD + authz — anonymous-via-`shareId` can create/reply; READER denied; author edits/deletes own (by `authorId` and by `authorAnonId`); moderation delete by owner/admin/editor; resolve/reopen; soft-delete + empty-thread removal.
- **Yjs-level** (node, no DOM): `comment-anchor` round-trip — encode an anchor, apply edits to the Y.Doc, confirm the anchor still resolves to the moved range; delete the anchored text → `anchorToRange` returns null (orphan).
- **E2E** (`apps/e2e`): a workspace member selects text → «Комментировать» → highlight appears → reply → **Решить** hides the highlight; the thread shows under Resolved. (Anonymous-via-link create is covered at the tRPC level; the e2e content/yjs caveat from spec #1 applies to live anchoring.)

---

## 11. Implementation phases (for the plan)

1. **Model + API (signed-in):** Prisma models + migration; `resolveCommentContext`; `comment.*` router (list/create/reply/edit/delete/resolve/reopen) for **signed-in** users; unit + tRPC tests.
2. **Editor:** `comment-anchor.ts` (+ yjs round-trip test); `comments.ts` extension (decorations); FloatingToolbar «Комментировать»; composer; thread popover + «Комментарии» panel; wire `PageRenderer` (fetch/create/reply/resolve).
3. **Mentions + notifications:** @-autocomplete in the composer; fan-out `commentCreated` + `PAGE_MENTION` from the mutations.
4. **Anonymous / public path:** `shareId`-authorized `publicProcedure` resolution + `anonId` identity + moderation rules; wire the `/s/{shareId}` route (anonId, canComment from link role).
5. **Realtime:** `pageCommentBus` + `comment.events.subscribe` for members; refetch-on-focus for public.
6. **E2E + `pnpm gates`.**

---

## 12. Open items / follow-ups

- Comments on non-TEXT page types (Excalidraw/Mermaid/…).
- Anonymous realtime (subscription authorized by `shareId`).
- Comment reactions, attachments, rich text.
- A page-level "has unresolved comments" indicator in the sidebar/tree.
- Robust anonymous identity / rate-limiting for public commenting (abuse controls).
