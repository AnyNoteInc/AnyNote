# People Management Implementation Plan (Phase 8A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pending member invitations, workspace join link, page-scoped guests, membership-admin role semantics, and workspace-level blocking with universal server-side denial — per `docs/superpowers/specs/2026-06-12-people-management-design.md` (THE SPEC; normative — read it fully before any task).

**Architecture:** New `packages/domain/src/people/` module (dto/repo/service split, the established domain pattern — see `packages/domain/src/pages/` for the layout and `packages/domain/src/billing/` for a small example) owns all write logic + the block-check helpers; a new `people:` tRPC router + extensions to `page-share.ts`; three public token pages; members-settings UI expansion; block enforcement threaded through trpc/domain/engines/yjs/web-lib chokepoints.

**Tech Stack:** Prisma 7 (shared-dev-DB migration flow), vitest real-DB suites, tRPC v11, Next 16 RSC, MUI v6, Playwright.

**Shared-dev-DB migration rule (Task 1):** generate SQL via schema-to-schema `prisma migrate diff --from-schema <(git show main:packages/db/prisma/schema.prisma) --to-schema prisma/schema.prisma --script`, hand-append the partial unique indexes, apply via `docker exec -i anynote-postgres-1 psql -U user -d anynote --single-transaction`, then `prisma migrate resolve --applied <name>`. NEVER `migrate dev`/`reset`. (`migrate status` exits 1 from pre-existing foreign drift — ignore.)

**Template files:**
- Domain module shape: `packages/domain/src/pages/{dto,repositories,services}/`, DI registration in `packages/domain/src/container.ts` (read how modules register), `mapDomain` in trpc.
- Token patterns: `packages/webhooks/src/secret.ts` (base62 generator) + `packages/telegram/src/secret.ts` (sha256 hash-at-rest).
- Partial unique index migrations: `git grep -n "WHERE" packages/db/prisma/migrations -- "*.sql" | grep -i unique` (the import-jobs pattern).
- Router/test patterns: `packages/trpc/src/routers/{workspace,telegram,page-share}.ts`, `packages/trpc/test/{webhook-router,telegram-router}.test.ts` (fixtures, dedicated plan).
- Settings UI: `apps/web/src/components/workspace/settings/{members-section,telegram-section}.tsx`.
- Public token page: there is no precedent for a no-session token page — use the `(about)` page shape + `getSession()` (nullable) directly; check `apps/web/src/app/` route groups first.
- E2E: `apps/e2e/helpers/auth.ts`, `apps/e2e/collab.spec.ts` (two-context pattern).

**Commits:** Conventional Commits, explicit paths, NEVER `git add -A`.

---

## Task 1: Schema + migration

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260613090000_people_management/migration.sql`.

- [ ] **Step 1:** Add the five models from spec §2 EXACTLY (WorkspaceInvitation, WorkspaceInviteLink, PageGuestInvite, WorkspaceBlockedUser, WorkspaceAuditLog) with snake_case @map/@@map names following the schema's conventions, back-relations on Workspace (`invitations`, `inviteLink`, `guestInvites`, `blockedUsers`, `auditLogs`), User (named relations where needed to disambiguate inviter/acceptedBy/etc. — give FKs NO back-relations where the schema convention allows scalar-only, check how TelegramConnection.createdById is handled [scalar only, no relation] and match), Page (`guestInvites`).
- [ ] **Step 2:** Generate the migration per the shared-DB rule; APPEND the two partial unique indexes by hand (spec §2 comments contain the exact SQL); apply + resolve + `prisma:generate`. Verify `\d workspace_invitations` shows the partial index.
- [ ] **Step 3:** `pnpm --filter @repo/db check-types && pnpm check-types`. **Step 4 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260613090000_people_management
git commit -m "feat(db): people management models — invitations, guest invites, blocks, audit log"
```

---

## Task 2: Domain people module — block helpers + audit + invitations core

**Files:** Create `packages/domain/src/people/{dto/people.dto.ts,repositories/people.repository.ts,services/people.service.ts,index.ts}` + container registration; Create `packages/domain/test/people/people.service.test.ts` (real-DB vitest, mirror an existing domain test's fixture style).

- [ ] **Step 1 — dto:** audit action constants (spec §2 catalog) as `PEOPLE_AUDIT_ACTIONS`, DomainError codes from spec §3, types (InvitePreview = `{currentMembers, maxMembers, planSlug, isPaid, periodEnd}`).
- [ ] **Step 2 — repo+service (TDD, the spec §7 invariants drive the cases):**
  - `isWorkspaceBlocked(workspaceId, userId)` + `assertNotBlocked` (throws `USER_BLOCKED` httpStatus 403).
  - `writeAudit(tx, {workspaceId, actorId, action, targetUserId?, targetEmail?, metadata?})` — used by every mutation below IN THE SAME TX.
  - Member invitations: `createInvitation({workspaceId, actorId, email, role})` (lowercase email; reject OWNER/GUEST roles `FORBIDDEN_ROLE`; existing member ⇒ `ALREADY_MEMBER`; active invite ⇒ refresh token+expiresAt+role instead of duplicate; returns `{invitation, token}` — plaintext token returned ONCE for the mail), `revokeInvitation`, `acceptInvitation({token, userId, userEmail})` (hash lookup; expiry/revoked/accepted checks; email equality case-insensitive ⇒ `INVITE_EMAIL_MISMATCH`; `assertNotBlocked`; seat-limit re-check vs `WorkspaceLimit.maxMembers` (read how `inviteMember` does it in `packages/trpc/src/routers/workspace.ts:272-282`) ⇒ `SEAT_LIMIT_REACHED`; tx: create member + mark accepted + audit; double-accept by the same user ⇒ return `{alreadyMember: true}` success), `getInvitePreview(workspaceId)` (the billing-impact data; resolve plan via the billing repository's getWorkspaceFeatures chain).
  - `listInvitations(workspaceId)` (active first; computed state PENDING/EXPIRED).
- [ ] **Step 3:** seat-limit + LAST_OWNER + blocked + email-mismatch + refresh + double-accept tests green. **Step 4 — commit:**
```bash
git add packages/domain/src/people packages/domain/src/container.ts packages/domain/test/people
git commit -m "feat(domain): people module — invitations, block helpers, workspace audit log"
```

---

## Task 3: Domain people module — invite link, guests, conversion, roles, blocking

**Files:** Extend the Task 2 files + tests.

- [ ] **Step 1 (TDD):**
  - Invite link: `getInviteLink`, `enableInviteLink({workspaceId, actorId, role})` (role ∈ EDITOR/COMMENTER/VIEWER; creates-or-enables, fresh token, returns plaintext once), `disableInviteLink`, `rotateInviteLink` (plaintext once), `joinViaLink({token, userId})` (enabled check — disabled/unknown both ⇒ `INVITE_NOT_FOUND`; not blocked; not already member [⇒ alreadyMember success]; seat re-check; tx member+audit `invite_link.joined`).
  - Guest invites: `createGuestInvite({pageId, actorId, email, role})` (page exists + not deleted; derive workspaceId; active-invite refresh like member invites; returns token once), `revokeGuestInvite`, `acceptGuestInvite({token, userId, userEmail})` (email match; not blocked; if the user is a workspace MEMBER ⇒ accept becomes a no-op success with `alreadyMember: true` [members don't need grants]; else tx: `ensureShare`-equivalent (find how page-share router ensures the PageShare row — reuse/replicate via prisma) + upsert PageShareUser grant with the invite role + mark accepted + audit `guest.joined`).
  - `listGuests(workspaceId)` — users having ≥1 PageShareUser grant on pages of this workspace AND no WorkspaceMember row, with grant counts + pending invites merged (spec §4 shape).
  - `revokeGuestAccess({workspaceId, actorId, userId})` — delete all their grants on this workspace's pages + revoke pending guest invites + audit.
  - `convertGuestToMember({workspaceId, actorId, userId, role})` — not blocked; seat re-check; member create; audit `guest.converted_to_member` (grants kept — harmless for members).
  - Role/removal: `changeMemberRole({workspaceId, actorId, actorRole, userId, role})` — codify the OWNER-protection matrix (ADMIN cannot touch OWNER rows nor grant OWNER; OWNER cannot demote the LAST owner ⇒ `LAST_OWNER`); `removeMember` (same matrix + LAST_OWNER; grants survive — removal makes them a guest if grants exist); both audit.
  - `blockUser({workspaceId, actorId, actorRole, userId, reason?})` (cannot block OWNER `FORBIDDEN_ROLE`, cannot block self; idempotent-safe via unique; audit) / `unblockUser`.
- [ ] **Step 2:** full ladder green: `pnpm --filter @repo/domain test`. **Step 3 — commit:**
```bash
git add packages/domain/src/people packages/domain/test/people
git commit -m "feat(domain): invite link, page guests, conversion, role matrix, blocking"
```

---

## Task 4: Block enforcement chokepoints (trpc, engines, yjs, web libs)

**Files:** Modify `packages/trpc/src/helpers/workspace.ts` (+`trpc/src/routers/workspace.ts` assertRole), `packages/domain/src/workspace/...` (the existing assertMembership — find it: `git grep -n "assertMembership" packages/domain/src`), `apps/engines/src/apps/api/auth/membership.ts`, `apps/yjs/src/auth.ts`, `apps/web/src/lib/share-access.ts`, `apps/web/src/app/api/files/[id]/route.ts`, `apps/web/src/lib/agents-token.ts`; tests beside each (engines spec, yjs spec, trpc test additions).

- [ ] **Step 1 (TDD per surface — write a failing blocked-user test in the surface's existing test file first, then wire):**
  1. trpc `assertWorkspaceMember` + `assertRole`: after the member lookup, one `workspaceBlockedUser.findUnique` ⇒ FORBIDDEN «Доступ заблокирован администратором». EVERY workspace-scoped procedure inherits this (they all funnel through these two — verify with `git grep -n "assertWorkspaceMember\|assertRole" packages/trpc/src | wc -l` and spot-check stragglers doing raw `workspaceMember.findUnique` — fix stragglers to use the helpers).
  2. domain `assertMembership` (consumed by domain services): same check.
  3. engines `membership.ts assertMember`: same; ForbiddenException.
  4. yjs `canAccessPage`: membership arm gains `blockedUsers: { none: { userId } }` on the workspace relation (verify the relation name from Task 1) AND add the grant arm per spec §8 (grant role → readonly mapping; read how the current return value feeds connectionConfig.readOnly — extend the return to carry an `access: 'member' | 'guest'` + role so the caller maps EDITOR-grant⇒write, READER/COMMENTER⇒readonly).
  5. web `share-access.ts`: member fast-path AND grant fast-path check the block table (blocked ⇒ fall through to the PUBLIC path — a blocked user retains anonymous-level access to genuinely public links, which is correct).
  6. `/api/files/[id]`: membership arm blocked check.
  7. `agents-token.ts`: the membership lookup that feeds `scopesForRole` refuses blocked users (return null ⇒ 403 path; check the guard test `apps/web/test/agents-token.test.ts` and extend it).
- [ ] **Step 2:** run the touched suites: `pnpm --filter @repo/trpc test && pnpm --filter @repo/domain test && pnpm --filter yjs test && pnpm --filter engines test && pnpm --filter web test`. **Step 3 — commit:**
```bash
git add packages/trpc/src/helpers/workspace.ts packages/trpc/src/routers/workspace.ts packages/domain/src apps/engines/src/apps/api/auth/membership.ts apps/yjs/src/auth.ts apps/yjs/src/auth.spec.ts apps/web/src/lib/share-access.ts apps/web/src/app/api/files/\[id\]/route.ts apps/web/src/lib/agents-token.ts apps/web/test/agents-token.test.ts
git commit -m "feat(security): workspace-block denial across trpc, domain, engines, yjs, files, agents"
```
(Adjust to actual touched test files.)

---

## Task 5: tRPC `people.*` router + page-share guest entry + role-shift regressions

**Files:** Create `packages/trpc/src/routers/people.ts`, `packages/trpc/test/people-router.test.ts`; Modify `packages/trpc/src/index.ts` (mount `people:`), `packages/trpc/src/routers/workspace.ts` (inviteMember/updateMemberRole/removeMember: delegate to domain + widen to OWNER|ADMIN per spec — keep `inviteMember` as a thin alias or deprecate in favor of people.invite; prefer: workspace.inviteMember now calls the domain createInvitation [behavior change: no longer instant-add!] — NO: keep workspace.inviteMember UNTOUCHED for backward compat this phase and build the new flow in people.*; the UI switches to people.*), `packages/trpc/src/routers/page-share.ts` (+`inviteGuest`, `listGuestInvites`, `revokeGuestInvite` under assertCanManageShare).

- [ ] **Step 1 — router** (every managed proc gated OWNER|ADMIN via a local `assertPeopleManager` that uses assertRole(['OWNER','ADMIN']); the OWNER-only distinctions live in the domain role matrix): `invite` (sends the `invitation` mail via notify/`sendMailNow` — read how workspace.inviteMember emits WORKSPACE_INVITE and reuse: in-app notification ONLY when a registered user matches the email; the EMAIL goes to the address regardless — check @repo/mail invitation payload fields and the link `/invite/{token}`), `listInvitations`, `revokeInvitation`, `invitePreview`, `inviteLink.*` (get/enable/disable/rotate), `listGuests`, `convertGuestToMember`, `revokeGuestAccess`, `changeMemberRole`, `removeMember`, `block`, `unblock`, `auditLog {cursor}` (OWNER only, keyset 30).
  Public/member procs: `resolveInvite` (publicProcedure — safe metadata per spec §4: workspaceName, inviterName, role, masked email `a***@domain`, state), `acceptInvite`, `resolveJoinLink`, `joinViaLink`, `resolveGuestInvite`, `acceptGuestInvite` (protected).
- [ ] **Step 2 — tests (TDD, dedicated fixtures):** role matrix (ADMIN can invite/change/remove/block non-OWNERs; ADMIN ⇒ FORBIDDEN on: touching OWNER rows, granting OWNER, auditLog?, billing/security regressions — pin `subscription.cancel`-style OWNER-only procs stay OWNER-only for ADMIN... pick 2 representative OWNER-only procedures incl. workspace.delete/rename-equivalent and assert ADMIN FORBIDDEN), invite lifecycle incl. unregistered email, resolve safe-metadata (no oracle), acceptance email-mismatch/blocked/seat-limit, link join incl. disabled-uniform-404, guest invite→grant + member-noop, listGuests shape, conversion, blocked-user denial samples, audit rows per mutation.
- [ ] **Step 3:** `pnpm --filter @repo/trpc test && check-types && lint`. **Step 4 — commit:**
```bash
git add packages/trpc/src/routers/people.ts packages/trpc/src/routers/page-share.ts packages/trpc/src/index.ts packages/trpc/test/people-router.test.ts
git commit -m "feat(trpc): people router — invites, link join, guests, conversion, blocking, audit"
```

---

## Task 6: Guest read-path (member-OR-grant) + sidebar «Доступные мне» + workspace switcher

**Files:** Modify the page read authorization sites (find them: `git grep -n "assertWorkspaceMember" packages/trpc/src/routers/page.ts` + comment/page-share read paths), `packages/domain/src/pages/...` (add `assertPageReadable` or extend the page service read methods), the workspace-list query (where the switcher gets workspaces: `git grep -n "listMine\|workspace.list" packages/trpc/src/routers/workspace.ts`), `apps/web` sidebar components (find the sidebar sections component: `git grep -rn "Страницы" apps/web/src/components --include=*.tsx | head`), tests.

- [ ] **Step 1 — server:** page read procedures (page.getById, the tree/list for the guest workspace, comments read/write per grant role) accept member-OR-grant: implement `assertWorkspaceMemberOrPageGrant(ctx, workspaceId, pageId)` in trpc helpers (member ⇒ ok [with block check]; else PageShareUser grant on THIS page or an ancestor per the existing share-inheritance resolution — REUSE the share-access ancestor walk from `ShareAccessRepository.findPathToRoot`/the grant arm of `buildPageVisibilityWhere`: simplest correct form = grant on the page itself OR any ancestor page's share, mirroring how share-token access already inherits; blocked ⇒ FORBIDDEN). Apply it ONLY to read/comment surfaces (page.getById, comment list/create per role, page children listing for navigation). Writes stay member-only EXCEPT content editing for EDITOR-grant guests which already flows through yjs (Task 4.4) — tRPC page.update/rename stay member-only this phase (Notion guests with edit can edit content; structural ops stay restricted — document in code).
  Workspace list for the switcher: include workspaces where the user has ≥1 grant and no membership, flagged `accessKind: 'guest'`.
  New `people.myGrantedPages { workspaceId }` (protected; grant-holder): the «Доступные мне» list (id, title, icon, role).
- [ ] **Step 2 — web:** sidebar: when the active workspace has `accessKind: 'guest'`, render ONLY the «Доступные мне» section (flat page list from myGrantedPages); hide creation buttons/sections/settings entries. Workspace switcher shows guest workspaces with a «Гость» chip. Members-with-grants see no new section.
- [ ] **Step 3:** trpc tests (guest can getById granted page + ancestor-inherited child, cannot getById ungranted, cannot rename, comment per role; member unaffected; blocked guest denied) + web build/lint/check-types. **Step 4 — commit:**
```bash
git add packages/trpc packages/domain/src/pages apps/web/src/components
git commit -m "feat(people): guest read path — member-or-grant access, sidebar shared-with-me, switcher"
```
(Narrow the paths to reality.)

---

## Task 7: Token acceptance pages (web)

**Files:** Create `apps/web/src/app/(invite)/invite/[token]/page.tsx`, `(invite)/join/[token]/page.tsx`, `(invite)/guest-invite/[token]/page.tsx`, shared `apps/web/src/components/invite/invite-card.tsx` (+ small client accept button component); `apps/web/test/` route tests if a precedent fits, else covered by E2E.

- [ ] **Step 1:** a new `(invite)` route group: RSC pages, `getSession()` nullable (NO requireSession); server-side resolve via `getServerTRPC()` caller (resolveInvite/resolveJoinLink/resolveGuestInvite — they're public). States per spec §5: valid+signed-in-matching → card with «Принять приглашение» (client button calling accept then redirecting to the workspace/page); valid+signed-out → «Войти» / «Зарегистрироваться» linking to /sign-in & /sign-up with `callbackURL=/invite/{token}` (VERIFY better-auth's redirect plumbing passes it: read how sign-in/up forms consume callbackURL search param — `git grep -n callbackURL apps/web/src packages/trpc/src/routers/auth.ts`; if sign-up's hardcoded `/verify-email?status=success` callback can't carry it, store the token in a cookie server-side on the invite page and consume it post-auth — choose the working mechanism, verify by running it); valid+wrong-email session → mismatch card + «Сменить аккаунт» (sign-out link); expired/revoked/unknown → uniform honest card. RSC gotchas: no function props to client components; Link wrapping per CLAUDE.md.
- [ ] **Step 2:** verify in dev (curl + click-through with a real invite). **Step 3 — commit:**
```bash
git add apps/web/src/app/\(invite\) apps/web/src/components/invite
git commit -m "feat(web): invitation acceptance pages — member, join link, guest"
```

---

## Task 8: Members settings UI expansion

**Files:** Modify `apps/web/src/components/workspace/settings/members-section.tsx` (likely split into subcomponents: `invitations-list.tsx`, `invite-link-card.tsx`, `guests-list.tsx`, `people-audit-log.tsx` in the same folder), `workspace-settings-dialog.tsx` (members section visibility for ADMIN; billing/security sections stay hidden from ADMIN — check current `show:` conditions), `apps/web/src/components/page/share-dialog.tsx` (guest email invite + pending list).

- [ ] **Step 1:** per spec §5: invite form switches to `people.invite` (works for unregistered emails; shows the seat line «Занято X из Y мест тарифа Z» from `people.invitePreview`; role select WITHOUT OWNER/GUEST); members table: role Select (locked for OWNER rows when actor is ADMIN; self-demote guarded), «Заблокировать»/«Разблокировать» + «Удалить» with confirms; «Приглашения» list (status chips Ожидает/Просрочено, revoke, re-send=invite again); «Ссылка-приглашение» card (enable toggle + role select + copy + rotate + warning); «Гости» list (per-guest page count, «Сделать участником» → billing-preview confirm dialog, «Отозвать доступ»); «Журнал действий» (OWNER only, keyset «Показать ещё», Russian action labels map). testids: `people-invite-email`, `people-invite-submit`, `people-invitation-row`, `people-invite-link-toggle`, `people-guest-row`, `people-block-button`, `people-audit`.
- [ ] **Step 2:** share dialog: «Пригласить по email» field + role select calling `pageShare.inviteGuest`; pending guest invites list with revoke. testid `share-guest-invite-email`.
- [ ] **Step 3:** `pnpm --filter web lint && check-types && (env sourced) build`. **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace/settings apps/web/src/components/page/share-dialog.tsx
git commit -m "feat(web): members settings — invitations, invite link, guests, blocking, audit log"
```

---

## Task 9: E2E + changelog

**Files:** Create `apps/e2e/people.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (two-context, `signUpAndAuthAs` ×2; the invite flows run against the paid-plan flag? CHECK: people.invite requires a paid plan? The spec keeps the existing assertPaidPlan semantics from inviteMember — YES, keep gating consistent: flip `membersSettingsEnabled`+plan paid-ness the established way: the personal plan's `membersSettingsEnabled` — read how members-section `locked` is derived and what flag E2E must flip; use the 7A/7B beforeAll capture-restore pattern):
  1. Owner (user A) opens members settings → invites `userB-email` (unregistered) with role EDITOR → invitation row «Ожидает».
  2. Extract the invite token server-side via prisma (tokenHash can't give the token back — instead capture the LINK from the invitation mail? mail is disabled in E2E. So: the people.invite response or the invitations list does NOT carry the token. SOLUTION: create the invite, then in the spec generate the accept URL by reading... the token is unrecoverable by design. Approach: user B signs up FIRST (signUpAndAuthAs in context B), THEN owner invites B's email, B (already signed in) opens the in-app path — the WORKSPACE_INVITE in-app notification carries the link? The notification link field — check what `notify.workspaceInvite` link contains; simplest robust E2E: stub the token — insert a WorkspaceInvitation row directly via prisma with a KNOWN token hash (hash a known plaintext with sha256 in the spec), then have B open `/invite/{plaintext}` → accept → assert B sees the workspace and A's members table shows B. This tests acceptance end-to-end honestly; creation UI is asserted separately in step 1.)
  3. Guest flow: insert a PageGuestInvite for user C (same known-token technique) on a page in a TEAM collection → C accepts via `/guest-invite/{token}` → C's sidebar shows «Доступные мне» with the page, settings menu absent → C opens the page (renders).
  4. Block flow: A blocks B (people-block-button) → B reloads the workspace → denial state (workspace gone from switcher or access-denied page — assert the actual behavior).
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Участники, гости и приглашения**

- Приглашайте участников по email (включая ещё не зарегистрированных) и по секретной ссылке, управляйте ролями и ожидающими приглашениями.
- Гости — полноценные люди в настройках, но видят только страницы, к которым им явно дали доступ. Блокировка закрывает доступ мгновенно на всех уровнях, каждое действие — в журнале аудита.
```
- [ ] **Step 3:** run the spec (`--retries=2`, env sourced, port 3100 free; poisoned-`.next` recovery if first navigation aborts). **Step 4 — commits:**
```bash
git add apps/e2e/people.spec.ts && git commit -m "test(e2e): people management — invite acceptance, guest scope, blocking"
git add docs/changelog.md && git commit -m "docs(changelog): people management"
```

---

## Completion

Group reviews: Tasks 1–4 (domain+enforcement) then 5–9 (API/UI/E2E), spec+quality each, fixes between. Final whole-branch review focus: (1) blocked-user denial completeness — enumerate every surface from spec §3 and adversarially hunt an unguarded path (incl. acceptance flows, share fast-paths, agents/yjs/files); (2) guest containment — a guest must not reach members/settings/billing/groups procedures, ungranted pages, or seat billing surfaces; (3) token hygiene — hashes at rest, no oracles (registered-email, link-enabled), plaintext única exposure; (4) ADMIN matrix — cannot touch OWNER/billing/security anywhere (grep OWNER-only procedures and pin); (5) regression — workspace.inviteMember legacy path, existing share/collab flows, GUEST-role members unaffected. Then full `pnpm gates` (env sourced, NOT concurrent with subagent test runs) and the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T2/T3 (domain) + T4 (chokepoints); §4→T5; §5→T7/T8; §6→T5 (mail wiring); §7 invariants distributed as TDD cases in T2–T6 + final review; §8→T4; §9→T9 + per-task tests.
- Type consistency: PEOPLE_AUDIT_ACTIONS (T2) used by T3/T5; assertNotBlocked (T2) used by T4; InvitePreview (T2) consumed by T5 invitePreview + T8 UI; myGrantedPages (T6) consumed by the sidebar (T6 step 2).
- Known risks named in-task: callbackURL plumbing (T7 — verify-or-cookie fallback), E2E token recovery (T9 — known-hash insertion), straggler raw membership lookups (T4.1 grep), guest read-path scope (T6 — reads only, writes via yjs grant role).
