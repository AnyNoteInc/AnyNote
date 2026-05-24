# Page sharing — Design Spec

**Date:** 2026-05-24
**Status:** Draft, awaiting user review
**Branch:** `feat/page-sharing`

## Summary

Add **page sharing** to the workspace editor. From the page header (breadcrumbs toolbar) the owner opens a **«Общий доступ»** dialog that can:

1. **Grant access to specific platform users** who are **not** members of the page's workspace (they must be authenticated to view).
2. **Create a public share link** `/s/{shareId}` (where `shareId` is a 64-character, 256-bit random token) with one of two link-access modes — **«Доступ ограничен»** (only granted users) or **«Всем, у кого есть ссылка»** (anyone on the internet) — and, for the public mode, a link role of **Читатель / Комментатор / Редактор**.

All shared access — for both named users and public link visitors — flows through a single new **public route `/s/{shareId}`** that renders the page through the existing `PageRenderer`. Read/write is enforced **server-side in `apps/yjs`** via a Hocuspocus read-only connection, driven by a short-lived **share token** minted by `apps/web`. This makes sharing work uniformly **for every page type** (they already render through Yjs) and supports **anonymous editing** (the share token carries an ephemeral identity).

**Scope note:** This is the **sharing** spec. The **Комментатор** role is wired into the data model and UI now, but until a separate **inline-comments spec (#2)** lands it grants **read-only access to page content** (Hocuspocus `readOnly`). Inline anchored comments (Notion/Google-Docs style, attached to a text range) are a follow-up feature with their own spec.

---

## 1. Goals & Non-goals

### Goals

- A **primary «Поделиться»** button (`ScreenShareIcon`) in the page breadcrumbs toolbar, **left of the favorite star**, visible only to users who may manage sharing.
- A **«Общий доступ»** dialog matching the requested layout: internal-user search, "users with access" list (author shown as **«Владелец»**), and a general-access block (lock/public icon, restricted-vs-public select, per-mode helper text, and a link-role select when public), with **«Копировать ссылку»** and **«Готово»** controls.
- A new `PageShare` + `PageShareUser` data model; a stable 64-char `shareId`.
- A **public `/s/{shareId}` route** (outside `(protected)`) that renders the page for named users (authenticated) and public visitors (incl. anonymous), with the correct edit/read permission.
- **Sharing works for all page types** (TEXT, EXCALIDRAW, GENOGRAM, MERMAID, PLANTUML, LIKEC4, DRAWIO, DATABASE, KANBAN, FORM) through the existing `PageRenderer`.
- **Anonymous editing** for a public **Редактор** link: a visitor with no account can edit; their identity is an ephemeral `anon:<uuid>` carried in the share token and shown in presence.
- **Server-enforced read-only** via Hocuspocus `readOnly` for **Читатель** (and **Комментатор** until comments ship), so data integrity does not depend on UI affordances.
- A unified `resolvePageAccess` used by both the route and the token endpoint.

### Non-goals

- **No inline comment feature in this spec.** `COMMENTER` behaves as read-only-for-content until comments spec #2. The role/enum/UI exist now to avoid re-modelling later.
- **No "Доступные мне" (Shared with me) surface.** Named users reach a shared page via the `/s/{shareId}` link (the owner sends it). Members keep using the normal in-app route. A "shared with me" list is a documented follow-up.
- **No instant revocation of live connections.** Switching `PUBLIC → RESTRICTED` (or removing a grant) is enforced on **reconnect / token expiry** (~10 min), not by force-dropping currently-open sockets. Immediate disconnect is backlog.
- **No new workspace-membership semantics.** Existing member access and roles are unchanged; sharing is additive.
- **No email notification** to named users in v1 (they get the link out-of-band). Notification is a follow-up.
- **No password-protected or expiring links** in v1 (possible follow-up; the model leaves room).

---

## 2. Architecture overview

```
Visitor (anonymous "guest" OR signed-in user)
  └─ GET /s/{shareId}                         ← NEW public route, outside (protected)
       ├─ resolveShareAccess(shareId, session?) → { page, role } | denied | notFound
       │       role priority:  workspace-member ▸ named-grant ▸ link-role(PUBLIC) ▸ deny
       ├─ denied + anonymous → "Войдите / нет доступа" screen
       ├─ notFound           → not-found
       └─ granted → minimal chrome (title, «Общий доступ» badge, sign-in CTA for guests)
              └─ PageRenderer (next/dynamic ssr:false)
                    editable = role ∈ {EDITOR, OWNER}     // READER/COMMENTER → read-only UI
                    yjsToken = () ⇒ POST /api/yjs/share-token { shareId }   ← NEW, no session gate
                          └─ resolveShareAccess again → mint short-lived JWT
                                { typ:"share", pageId, shareId, role, sub:userId|"anon:<uuid>", name }
                                signed HS256 with YJS_SHARE_TOKEN_SECRET, exp ~10m
                                └─ ws name=pageId → apps/yjs onAuthenticate
                                      ├─ token.typ==="share" → verify secret (else existing JWKS path)
                                      ├─ documentName === token.pageId
                                      ├─ re-validate grant in DB  (revocation on reconnect)
                                      └─ return { readOnly: role ∈ {READER, COMMENTER} }
                                            → Hocuspocus rejects writes from this connection

Owner / workspace OWNER|ADMIN (in normal app)
  └─ breadcrumbs «Поделиться» button → ShareDialog
        └─ page.share.* (tRPC, protected, assertCanManageShare)
             get / setAccess / addUser / updateUser / removeUser
             user.search (add people not in the workspace)
```

Two token paths coexist in `apps/yjs`: the **existing** workspace-member path (better-auth JWT verified via JWKS, checks workspace membership) is untouched; the **new** share-token path is selected by `typ:"share"` and verified with a shared secret.

---

## 3. Data model (Prisma)

`packages/db/prisma/schema.prisma`:

```prisma
enum PageShareAccess { RESTRICTED  PUBLIC }        // «Доступ ограничен» | «Всем, у кого есть ссылка»
enum PageShareRole   { READER  COMMENTER  EDITOR } // «Читатель» | «Комментатор» | «Редактор»

model PageShare {
  id          String          @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  pageId      String          @unique @map("page_id") @db.Uuid
  shareId     String          @unique @map("share_id")    // 64 hex chars (crypto.randomBytes(32))
  access      PageShareAccess @default(RESTRICTED)
  linkRole    PageShareRole   @default(READER) @map("link_role")
  createdById String          @map("created_by_id") @db.Uuid
  createdAt   DateTime        @default(now()) @map("created_at")
  updatedAt   DateTime        @updatedAt @map("updated_at")
  page        Page            @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdBy   User            @relation("PageShareCreatedBy", fields: [createdById], references: [id])
  users       PageShareUser[]

  @@index([shareId])
  @@map("page_shares")
}

model PageShareUser {
  id          String        @id @default(dbgenerated("uuid_generate_v7()")) @db.Uuid
  pageShareId String        @map("page_share_id") @db.Uuid
  userId      String        @map("user_id") @db.Uuid
  role        PageShareRole @default(READER)
  createdAt   DateTime      @default(now()) @map("created_at")
  pageShare   PageShare     @relation(fields: [pageShareId], references: [id], onDelete: Cascade)
  user        User          @relation("PageShareGrant", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([pageShareId, userId])
  @@map("page_share_users")
}
```

Back-relations: `Page.share PageShare?` and the two `User` relations (`PageShareCreatedBy`, `PageShareGrant`).

- **One `PageShare` per page.** Created **lazily** the first time the dialog opens / a link is copied; `shareId` is stable thereafter.
- **Owner is implicit** — `Page.createdById`. It is **not** stored as a `PageShareUser`. In the dialog the owner is shown with status **«Владелец»**, no role select, no remove.
- `shareId` = `crypto.randomBytes(32).toString("hex")` → 64 hex chars, 256-bit entropy.
- Migration via `pnpm --filter @repo/db exec prisma migrate dev --name page_sharing`.

---

## 4. Access resolution (single source of truth)

`packages/trpc/src/helpers/share-access.ts`:

```ts
type EffectiveRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'READER' | null

// Used by the /s route + token endpoint. session may be null (anonymous).
resolveShareAccess(prisma, shareId, session): Promise<{ page; role: EffectiveRole }>
// and a pageId-keyed variant for in-app checks:
resolvePageAccess(prisma, pageId, session): Promise<EffectiveRole>
```

Priority (first match wins):

| # | Condition | Result |
|---|-----------|--------|
| 1 | signed-in **and** workspace member of `page.workspaceId` | mapped from member role (OWNER → `OWNER`; ADMIN/EDITOR → `EDITOR`; COMMENTER → `COMMENTER`; VIEWER/GUEST → `READER`) |
| 2 | signed-in **and** has a `PageShareUser` grant | the grant's role |
| 3 | `share.access === PUBLIC` (even anonymous) | `share.linkRole` |
| 4 | otherwise | `null` (deny) |

- Anonymous visitors only ever match #3. On a `RESTRICTED` page an anonymous visitor gets the **«Войдите / нет доступа»** screen (they may be a named user who needs to sign in).
- Anonymous `EDITOR` is allowed (per decision) — writable connection, ephemeral identity.
- `editable` in the UI is `role ∈ {EDITOR, OWNER}`. `READER`/`COMMENTER` → read-only; server enforces it regardless of UI.

**Managing sharing** — `assertCanManageShare(ctx, pageId)`: allowed for the **page author (`createdById`)** or workspace **OWNER/ADMIN**. The **«Поделиться»** button is rendered only for these users; every `page.share.*` mutation re-checks server-side. (Confirmed with user.)

---

## 5. tRPC API + user search

New router `page.share.*` (`packages/trpc/src/routers/page-share.ts`, mounted under the existing `page` router):

```
page.share.get({ pageId })                          → { shareId, access, linkRole,
                                                        users: [{ user, role }], owner, canManage }
                                                        // creates the PageShare row lazily, returns shareId
page.share.setAccess({ pageId, access, linkRole })  → updated share
page.share.addUser({ pageId, userId, role })        → grant (idempotent on (pageShareId,userId))
page.share.updateUser({ pageId, userId, role })     → grant
page.share.removeUser({ pageId, userId })           → void
```

- All mutations call `assertCanManageShare`. `get` requires manage rights too (the dialog is owner-only).
- `addUser` rejects users who are **already workspace members** (they already have access) and the page author (already owner) with a friendly error, to keep the list meaningful.

User search (`packages/trpc/src/routers/user.ts`, `user.search`):

```
user.search({ query })  → [{ id, firstName, lastName, email, image }]   (max 8)
```

- Needed because we add people **not in** the workspace. **Anti-enumeration:** require `query.length >= 3`, match email/name by prefix (case-insensitive), cap at 8 rows, return only display fields, and apply basic rate-limiting. (Confirmed acceptable with user.)

The public route + token endpoint use the **server helper** `resolveShareAccess` directly (not a protected procedure), since `/s/` lives outside the authenticated tRPC subtree.

---

## 6. Share token + `apps/yjs` changes

**New endpoint** `apps/web/src/app/api/yjs/share-token/route.ts` (`runtime = "nodejs"`, **no session gate**):

- `POST { shareId }`; reads the optional session.
- `resolveShareAccess(prisma, shareId, session)`; on `null` → `403`.
- Mints a short-lived JWT (HS256, `YJS_SHARE_TOKEN_SECRET`):
  `{ typ: "share", pageId, shareId, role, sub: userId | "anon:<uuid>", name, exp: now+10m }`.
- Anonymous: `sub = "anon:<uuid>"`, `name = "Гость · <animal>"`, plus a deterministic presence color.

**`apps/yjs` (`@repo/yjs-server`):**

- `auth.ts` — branch on the token. If it decodes with `typ:"share"`, verify with `YJS_SHARE_TOKEN_SECRET` and return `{ kind:"share", userId: sub, pageId, shareId, role, name }`. Otherwise the **existing** JWKS workspace-member path runs unchanged.
- `index.ts` `onAuthenticate` — for a share token:
  - assert `documentName === token.pageId`;
  - load page meta (`pageType`, `workspaceId`) for persistence — **the signed token is the authority for its ~10-min TTL; the yjs server does not re-query the `PageShare`/grant.** Revocation-on-reconnect is achieved upstream: the browser re-mints the token on each (re)connect via `/api/yjs/share-token`, which re-runs `resolveShareAccess` against current DB state and denies a revoked viewer. Only an already-open live connection survives until it drops (≤ token TTL) — see the "no instant revocation" non-goal.
  - set `connectionConfig.readOnly = true` for `READER`/`COMMENTER` (Hocuspocus v3.4.4 exposes `connectionConfig`, not `connection`, in the `onAuthenticate` payload); `EDITOR` stays writable. Hocuspocus then rejects document writes from read-only connections server-side, regardless of any client `editable` flag.
- **Persistence must tolerate anonymous editors.** `storePageDocument` (and any handler writing `updatedById`) must **not** set `updatedById` for an `anon:*` subject (no matching `User` row → FK violation). For anonymous edits, leave `updatedById` unchanged / null.

**Env:** add `YJS_SHARE_TOKEN_SECRET` to `.env.example`, `turbo.json` `globalEnv`, and the `apps/yjs` env loader (shared secret between `apps/web` and `apps/yjs`).

---

## 7. Public route `/s/{shareId}`

- New route group `apps/web/src/app/(share)/` with `layout.tsx` (minimal: fonts/theme + `UiProvider`, **no** `requireSession`, **no** workspace chrome) and `s/[shareId]/page.tsx` (Server Component).
- `page.tsx`:
  - `getSession()` (optional); `resolveShareAccess(prisma, shareId, session)`.
  - `notFound` if no `PageShare`; **«Войдите / нет доступа»** screen if `role === null` (with a sign-in CTA for anonymous visitors).
  - On a granted role: render minimal chrome — page title + icon, a **«Общий доступ»** badge, and (for guests) a small **«Войти»** CTA — and mount the page body.
- **`SharePageClient`** (client, `ssr:false`) wraps `PageRenderer` with:
  - `pageId` (resolved from the share),
  - `editable = role === 'EDITOR' || role === 'OWNER'`,
  - `yjsToken = () => fetch('/api/yjs/share-token', { method:'POST', body:{ shareId } })`.
- **`PageRenderer` light refactor:** today it derives `yjsToken`/`editable` from the in-app workspace context. Extract those as **optional props** (`yjsToken?`, `editable?`, `userIdentity?`) so the share route can inject them; in-app callers keep current behavior via defaults. The Yjs document name stays `pageId` (the share-token's `pageId` must match).
- Each page-type renderer must honor `editable=false` (read-only UI). Server `readOnly` is the safety net if a renderer misses an affordance.

---

## 8. UI

### 8.1 «Поделиться» button

In `apps/web/src/components/page/page-actions-toolbar.tsx`, **left of `FavoriteStar`**: a **primary contained** `Button` with `ScreenShareIcon` + label **«Поделиться»** (`size="small"`). Rendered only when the viewer may manage sharing (owner / workspace OWNER|ADMIN — gate via a `page.share.get`-provided `canManage` or a dedicated lightweight check). Clicking opens `ShareDialog`.

### 8.2 `ShareDialog` (`apps/web/src/components/page/share-dialog.tsx`)

Built on the existing `Dialog` pattern (cf. `page-export-dialog.tsx`), `maxWidth="sm"`, `fullWidth`:

- **Title:** «Общий доступ».
- **Internal-user search:** a search `TextField` (`PersonAddIcon` adornment) → debounced `user.search` → result list; selecting a user calls `page.share.addUser` with default role **«Читатель»**.
- **«Пользователи, имеющие доступ»** list:
  - First row: **author** — avatar (initials), name/email, status **«Владелец»**, no controls.
  - Each granted user: avatar, name/email, a role `Select` (**Читатель / Комментатор / Редактор** → `page.share.updateUser`), and a remove action (`page.share.removeUser`).
- **«Общий доступ»** block (horizontal):
  - Leading icon: `LockIcon` when `RESTRICTED`, `PublicIcon` when `PUBLIC`.
  - Row 1: `Select` — **«Доступ ограничен»** | **«Всем, у кого есть ссылка»** → `page.share.setAccess`.
  - Row 2 (helper text):
    - restricted → «Открывать контент по этой ссылке могут только пользователи, имеющие доступ».
    - public → «Просматривать могут все в интернете, у кого есть эта ссылка».
  - When `PUBLIC`: a second `Select` — link role **Читатель / Комментатор / Редактор** → `setAccess({ linkRole })`.
- **Footer (`DialogActions`, space-between):** left **«Копировать ссылку»** (`navigator.clipboard.writeText(\`${origin}/s/${shareId}\`)`, brief "скопировано" feedback); right **«Готово»** (close — changes already persisted per-action).

### 8.3 Icons / UI package

Add to `packages/ui/src/components/index.ts`: `ScreenShareIcon`, `LockIcon`, `PublicIcon`, `PersonAddIcon` (re-export from `@mui/icons-material`, matching existing pattern). If `Avatar`/`Autocomplete`/`InputAdornment` are needed and not yet re-exported, add explicit re-exports (no direct `@mui/material` imports from app code).

---

## 9. Security considerations

- **Unguessable links:** 256-bit `shareId`; never derived from `pageId`.
- **Public exposure is explicit:** the dialog clearly shows lock vs public state; default is `RESTRICTED`.
- **Email enumeration:** `user.search` min-length, prefix match, capped results, rate-limited, display-only fields.
- **Server-side read-only:** writes are rejected by Hocuspocus for `READER`/`COMMENTER` — UI is not the gate.
- **Revocation:** share token is short-lived (~10 min) and re-validated against the DB on every (re)connect; instant socket drop is out of scope (documented).
- **Anonymous-edit abuse:** opt-in per page; ephemeral identity; (rate-limiting/abuse controls are a follow-up).
- **Token secret:** `YJS_SHARE_TOKEN_SECRET` shared only between `apps/web` and `apps/yjs`; not exposed to the browser.

---

## 10. Testing

- **Unit** (`packages/trpc`): `resolvePageAccess`/`resolveShareAccess` matrix — {member, named-grant, public, anonymous} × {READER, COMMENTER, EDITOR} × {RESTRICTED, PUBLIC} → expected role/deny.
- **tRPC** (`packages/trpc`): `page.share.*` CRUD + `assertCanManageShare` (owner/admin allowed, others 403); `addUser` rejects existing members; `user.search` anti-enumeration limits.
- **`apps/yjs`**: share-token verification (valid/expired/wrong-secret/wrong-pageId), DB re-validation, `readOnly` flag per role, anonymous `updatedById` tolerance.
- **E2E** (`apps/e2e`, Playwright): owner shares a page, copies link; anonymous **reader** sees read-only `/s/`; anonymous **editor** edits and the change persists; named user (signed in) gets granted role; toggling `PUBLIC → RESTRICTED` blocks a fresh anonymous visit; the dialog flows (search/add/role-change/remove, copy link). Use `signUpAndAuthAs` for authenticated actors.

---

## 11. Implementation phases (for the plan)

1. **Model + access:** Prisma models/enums + migration; `resolveShareAccess`/`resolvePageAccess`; `assertCanManageShare`. Unit tests.
2. **API:** `page.share.*` router + `user.search` + tRPC tests.
3. **Dialog + button:** `ShareDialog`, «Поделиться» button, icons, copy-link. (Works end-to-end for config even before `/s/` exists.)
4. **Token + yjs:** `/api/yjs/share-token`; `apps/yjs` share-token path + `readOnly` + anonymous-persist tolerance; `YJS_SHARE_TOKEN_SECRET` wiring; `PageRenderer` prop refactor.
5. **Public route:** `(share)` group + `/s/[shareId]` + access/sign-in screens + anonymous identity.
6. **Read-only across page types:** thread `editable=false` into each renderer.
7. **E2E** + `pnpm gates`.

---

## 12. Open items / follow-ups

- **Inline comments (spec #2):** lights up `COMMENTER` (anchored-to-text comments, threads, resolve/reopen, panel). Until then `COMMENTER` = read-only content.
- **"Доступные мне" (Shared with me):** a list so named users find shared pages without the raw link.
- **Instant revocation:** force-drop live sockets on access downgrade.
- **Email notification** to named users; **expiring / password-protected** links.
- **Read-only polish** per page type (some renderers may need dedicated view modes beyond `editable=false`).
