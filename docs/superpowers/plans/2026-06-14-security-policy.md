# Security Policy + Admin Content Search Implementation Plan (Phase 8C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkspaceSecurityPolicy with server-side enforcement at every chokepoint, the guest-invite request workflow, and the OWNER-only audited admin content search — per `docs/superpowers/specs/2026-06-14-security-policy-design.md` (THE SPEC; normative).

**Architecture:** New `packages/domain/src/security/` module (the people/identity pattern) owning policy + requests + admin search; enforcement threaded through the existing chokepoints (people.createGuestInvite, page-share procedures, ShareAccessService, export routes, copyToWorkspace); `security.*` tRPC router; «Безопасность» settings section; share-dialog request flow.

**Template files:** `packages/domain/src/identity/**` (newest module shape + audit/error catalogs), `packages/domain/src/share-access/**` (the resolver to extend), `packages/trpc/src/routers/{identity,people,page-share,job,search}.ts`, `packages/trpc/src/services/page-search.ts` (the FTS SQL to fork), `packages/notifications/src/{catalog,helpers,emit}.ts` + the REMINDER_DUE enum-migration precedent (`git log --oneline --all -- packages/db/prisma/migrations | grep -i remind` → read that migration), settings sections from 8B, `apps/e2e/{identity,people}.spec.ts`.

**Shared-dev-DB migration rule (Task 1):** the established diff→psql→resolve flow. NOTE: `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block in older PG — check how the REMINDER_DUE migration handled it (separate statement/file); apply accordingly (psql without --single-transaction for that statement if needed).

**Test discipline:** fixture-scoped asserts ONLY (8A rule); suites run alone; real-DNS-free.

**Commits:** explicit paths, NEVER `git add -A`.

---

## Task 1: Schema + notification event + migration

**Files:** Modify `packages/db/prisma/schema.prisma`, `packages/notifications/src/{catalog.ts,helpers.ts,types.ts?}`, `packages/notifications/src/templates/in-app.ts`; Create the migration.

- [ ] **Step 1:** spec §2 models (WorkspaceSecurityPolicy with workspaceId @id; PageGuestInviteRequest + enum + partial unique via raw SQL) + Workspace back-relations (`securityPolicy`, `guestInviteRequests`) + Page back-relation (`guestInviteRequests`) + `GUEST_INVITE_REQUESTED` in the NotificationEventType enum.
- [ ] **Step 2:** migration via the shared-DB flow (mind the ALTER TYPE transaction caveat — verify against the REMINDER_DUE precedent); hand-append the partial unique (`page_guest_invite_requests_one_pending ON (page_id, email) WHERE status = 'PENDING'`); apply+resolve+generate; verify `\d`.
- [ ] **Step 3:** notifications: catalog descriptor (COLLABORATION, IN_APP default+locked), `notify.guestInviteRequested(prisma, {userId, workspaceId, actorId, requesterName, pageTitle, workspaceName, link})` helper per the workspaceInvite shape, in-app template case (Russian: «N. запрашивает гостевой доступ к странице «T»»), tests in the notifications package if a test suite exists there (check; else covered via trpc tests).
- [ ] **Step 4:** `pnpm --filter @repo/db check-types && pnpm --filter @repo/notifications test 2>/dev/null; pnpm check-types`. **Step 5 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/* packages/notifications/src
git commit -m "feat(db): security policy + guest invite request models, guest-request notification event"
```

---

## Task 2: Domain security module — policy + enforcement helpers + guest requests

**Files:** Create `packages/domain/src/security/{dto/security.dto.ts,repositories/security.repository.ts,services/security.service.ts,index.ts,security.module.ts,security.tokens.ts}` + container/barrel registration; Modify `packages/domain/src/people/services/people.service.ts` (the policy check in createGuestInvite + the bypass for approvals); Create `packages/domain/test/security/security.service.test.ts`.

- [ ] **Step 1 (TDD):** per spec §3: SECURITY_AUDIT_ACTIONS + SECURITY_ERROR_CODES catalogs; getPolicy (zero-value default), updatePolicy (lazy-create, changed-flags diff audit in-tx); the four assert helpers; guest requests (createGuestInviteRequest [policy-combo gate: POLICY_REQUESTS_DISABLED unless invites disabled AND requests allowed; refresh-PENDING; audit; returns ownerIds for notification], approveGuestInviteRequest [OWNER actor passed in; marks APPROVED in the same tx where people.createGuestInvite runs with the bypass — implement the bypass as an explicit `{ bypassPolicy: true }` option on createGuestInvite, default false, asserted in people tests], rejectGuestInviteRequest, listGuestInviteRequests, listMyRequestsForPage).
- [ ] **Step 2:** people.createGuestInvite gains the policy check (deny when disableGuestInvites && !bypassPolicy) — UPDATE the existing people tests that now need a policy fixture? No: default policy allows invites (all flags false) — existing tests unaffected; ADD the denial + bypass cases to the security suite.
- [ ] **Step 3 (TDD ladder, fixture-scoped):** policy CRUD + diff audit; each assert helper both ways; request lifecycle (policy-combo×3, refresh, approve→invite row + guest.invited audit + APPROVED + audit trio, reject, partial-unique, P2002 convergence on concurrent approve [the established race pattern]); the bypass flag honored + plain createGuestInvite denied under policy.
- [ ] **Step 4:** `pnpm --filter @repo/domain test` (alone) + check-types + check-architecture. **Step 5 — commit:**
```bash
git add packages/domain/src/security packages/domain/src/people packages/domain/src/container.ts packages/domain/src/index.ts packages/domain/test/security
git commit -m "feat(domain): security module — policy, enforcement helpers, guest invite requests"
```

---

## Task 3: Domain — admin content search

**Files:** Extend the security module (+ `packages/domain/test/security/security.search.test.ts`).

- [ ] **Step 1 (TDD):** `acknowledgeContentSearch` (sets ack fields + audit) and `adminContentSearch` per spec §3: ack gate (SEARCH_ACK_REQUIRED); fork the FTS SQL from `packages/trpc/src/services/page-search.ts` into the security repository (raw SQL via the uow client; same exclusions; query OPTIONAL — browse mode lists workspace pages by updatedAt desc), WITHOUT the visibility filter; the audience/access joins (collection kind+title, createdBy/updatedBy via scalar joins, PageShare state, member-grant vs guest-grant counts [grant-holder with no WorkspaceMember row = guest], active PageGuestInvite count); audienceState first-match logic per spec; excerpt via the existing first-matching-block helper (import or replicate — check where findFirstMatchingBlock lives and whether it's exportable; domain can't import trpc — REPLICATE it with a sync comment); keyset (updatedAt desc, id desc); `content_search.performed` audit in the same call (query, filters, resultCount).
- [ ] **Step 2 (tests):** ack gate; owner finds ANOTHER user's PERSONAL page (the privacy-critical case); audience matrix (private/internal/external/public fixtures — public via PUBLIC link AND via published SITE; external via a guest grant AND via a pending guest invite); creator/date filters; browse mode; excerpt non-empty on a content match; keyset stability; the audit row carries the query verbatim; resultCount correct.
- [ ] **Step 3:** suites + check-architecture. **Step 4 — commit:**
```bash
git add packages/domain/src/security packages/domain/test/security
git commit -m "feat(domain): admin content search — audited owner-only FTS with audience states"
```

---

## Task 4: Enforcement wiring (resolver, page-share, exports, copy)

**Files:** Modify `packages/domain/src/share-access/services/share-access.service.ts` (+ its repository if the policy load needs it + tests), `packages/trpc/src/routers/page-share.ts` (setAccess/updatePublicLinkSettings/publishSite/setExposesAt + addUser-nonmember + copyToWorkspace), `packages/trpc/src/routers/job.ts` (export.create), `apps/web/src/app/api/pages/[pageId]/export/[format]/route.ts`, `apps/web/src/app/api/pages/[pageId]/export/csv/route.ts`, the public-page UI state mapping (find where resolver reasons render: `git grep -rn "reason" apps/web/src --include=*.tsx | grep -i "share\|public" | head`), tests beside each.

- [ ] **Step 1 (TDD per chokepoint — failing policy test first in each surface's existing test home):**
  1. ShareAccessService.resolve: load the workspace policy (one query via the share's page.workspaceId — extend the repository select); `disablePublicLinksSitesForms` ⇒ `{status:'unavailable', reason:'policy_disabled'}` BEFORE mode checks. Extend the resolver test suite (find it: `git grep -ln "ShareAccessService" packages/domain/test packages/trpc/test`) for LINK + SITE; verify the share-token route and publicTree inherit (they all call resolve — confirm by reading, add one integration pin each if cheap).
  2. page-share tRPC: the four link procedures call `domain.security.assertPublicSharingAllowed` (only when making MORE public: setAccess to PUBLIC, publish, exposesAt set; setting RESTRICTED/unpublish stay allowed — owners must be able to close things down); addUser denies for non-member targets under disableGuestInvites (members were already rejected — the remaining targets are guests by definition); copyToWorkspace calls assertCrossWorkspaceCopyAllowed on the SOURCE workspace.
  3. Exports: job.export.create + both GET routes call assertExportAllowed (update the portability comment); artifact download untouched (document why in a comment).
- [ ] **Step 2:** the public page maps `policy_disabled` to «Доступ по ссылке отключён администратором пространства» (find the existing unavailable-state component).
- [ ] **Step 3:** suites: domain + trpc + web tests (sequential) + web build. **Step 4 — commit:**
```bash
git add packages/domain/src/share-access packages/trpc/src/routers/page-share.ts packages/trpc/src/routers/job.ts apps/web/src/app/api/pages apps/web/src packages/domain/test packages/trpc/test apps/web/test
git commit -m "feat(security): policy enforcement — resolver kill-switch, sharing, exports, cross-workspace copy"
```
(Narrow to reality.)

---

## Task 5: tRPC `security.*` router + request notifications

**Files:** Create `packages/trpc/src/routers/security.ts`, `packages/trpc/test/security-router.test.ts`; Modify `packages/trpc/src/index.ts`, `packages/trpc/src/routers/page-share.ts` (requester surface if it lives there — prefer security.requestGuestInvite per the spec §5).

- [ ] **Step 1:** per spec §5: OWNER-only getPolicy/updatePolicy/acknowledgeContentSearch/contentSearch/listGuestRequests/approveGuestRequest/rejectGuestRequest (approve emits nothing extra; the people-side invite mail fires inside the domain approve path — verify the mail call site: people.createGuestInvite does NOT send mail [the router did] — so the approve path must ALSO send the guest-invitation mail: do it in the security router's approve procedure mirroring pageShare.inviteGuest's sendMailNow block); member-level requestGuestInvite (page edit access via the existing helpers + the policy combo; emits notify.guestInviteRequested to every OWNER [listOwners query]; returns the request) + myGuestRequests.
- [ ] **Step 2 (tests):** OWNER matrix (ADMIN FORBIDDEN on all 7 — pinned); contentSearch end-to-end through the router (ack flow); requestGuestInvite (edit-access required, viewer denied; policy-combo; notification rows created for ALL owners; refresh); approve (guest invite created + mail mock called + request APPROVED), reject; normal-search regression (a member's search.search results over a fixture with a foreign private page are IDENTICAL before/after — i.e. private page absent).
- [ ] **Step 3:** `pnpm --filter @repo/trpc test` (alone) + lint/check-types. **Step 4 — commit:**
```bash
git add packages/trpc/src/routers/security.ts packages/trpc/src/index.ts packages/trpc/test/security-router.test.ts packages/trpc/src/routers/page-share.ts
git commit -m "feat(trpc): security router — policy, guest requests, audited admin content search"
```

---

## Task 6: Web UI — settings section + share-dialog requests + public-page state

**Files:** Create `apps/web/src/components/workspace/settings/{security-section.tsx,security-policy-card.tsx,guest-requests-card.tsx,content-search-panel.tsx}`; Modify `workspace-settings-dialog.tsx` (slug `security` after `identity`; show: `isOwner` — NOT plan-gated), `apps/web/src/components/page/share-dialog.tsx` (the request flow), the public-page unavailable component (if not done in Task 4), members-section badge (pending count — cheap query or reuse listGuestRequests).

- [ ] **Step 1:** per spec §6: the policy card (switches with honest helper texts; the links switch warning; requests toggle nested), the requests queue card (approve/reject + confirm; empty state), the content-search panel (warning gate with the legal text + «Подтвердить» [acknowledgeContentSearch] → search input + filters [creator Select from listMembers, date range, audience Select] → result table [title link, excerpt, location, audience chip, creator, lastEditor, who-can-access summary] → per-row actions [открыть; снять публикацию → pageShare.unpublishSite; закрыть доступ → setAccess RESTRICTED; отозвать гостевой доступ → people.revokeGuestAccess targeting the page's guests? — NO: revoke the page's guest GRANTS via pageShare.removeUser per grant — keep actions to: открыть / снять публикацию / закрыть доступ; guests are managed from the members section — document]). testids per spec §6.
- [ ] **Step 2:** share dialog: when policy disables invites — request form (email+role+«Запросить») with the requester's pending/decided states via myGuestRequests; when requests disabled too — the honest note.
- [ ] **Step 3:** web lint/check-types/build (env sourced, foreground). **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace/settings apps/web/src/components/page/share-dialog.tsx apps/web/src/components/workspace
git commit -m "feat(web): security settings — policy, guest request queue, admin content search"
```

---

## Task 7: E2E + changelog

**Files:** Create `apps/e2e/security.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (paid fixture NOT needed — security is not plan-gated; but the workspace needs an OWNER + a member + pages: the people.spec two-context technique):
  1. Public-link kill: owner creates a page, makes it PUBLIC (share dialog), opens the public URL anonymously (context 3 or logged-out page) → renders; owner enables the links policy → the public URL shows «отключён администратором»; disables → works again.
  2. Export block: policy on → the export UI/action errors honestly (assert the actual UI state — find the export affordance).
  3. Guest request: policy disables invites (requests allowed); member (user B with edit access on a TEAM page... member already has access — the requester is a MEMBER asking to invite an EXTERNAL email) opens the share dialog → request form → submits for external email → owner sees the queue row + the in-app notification (check the notifications bell if testable, else the queue) → approve → the pending guest invite row appears in the share dialog/guests list.
  4. Admin search: seed a PERSONAL-collection page for member B via prisma (title with a unique marker); owner opens Безопасность → Поиск: warning gate → acknowledge → search the marker → the private page found with audience «приватная»; people-audit shows content_search.performed (via the audit UI or prisma assert).
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Безопасность пространства и поиск для владельца**

- Политики безопасности: отключайте гостевые приглашения (с очередью запросов на одобрение), публичные ссылки и сайты (включая уже созданные), экспорт и копирование в другие пространства — всё применяется на сервере.
- Аудируемый поиск по содержимому для владельца: находите приватные и публичные страницы, видите кто имеет доступ, и закрывайте лишний доступ в один клик. Каждый запрос фиксируется в журнале.
```
- [ ] **Step 3:** run (foreground, retries, 3100 free, .next wipe if needed). **Step 4 — commits:**
```bash
git add apps/e2e/security.spec.ts && git commit -m "test(e2e): security policies, guest requests, admin content search"
git add docs/changelog.md && git commit -m "docs(changelog): security policy and admin search"
```

---

## Completion

Group reviews: Tasks 1–3 (domain) then 4–7 (enforcement/API/UI/E2E). Final whole-branch review foci: (1) the privacy guardrail — admin search is the ONLY new visibility path, OWNER-only, ack-gated, query-audited; normal search/read paths byte-identical (regression-pinned); (2) enforcement completeness — adversarially hunt an ungated path per flag (link-creation variants, export variants incl. database CSV, the yjs share-token mint under policy, addUser edge cases); (3) the bypass discipline — approveGuestInviteRequest is the only disableGuestInvites bypass, OWNER-only, audited; (4) honest UX (policy states never silent-404 for legitimate viewers; switches warn); (5) regression — default policy (no row) changes NOTHING (the all-false zero value; suites prove). Then full `pnpm gates` (alone) + the forced uncached sweep + the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T1; §3→T2/T3; §4→T4; §5→T5; §6→T6; §7 guardrails as pinned tests across T2-T5 + final review; §8→per-task + T7.
- Type consistency: SECURITY_* catalogs (T2) used by T3/T5; the bypassPolicy option (T2) consumed by the approve path (T2) and pinned in people tests; policy_disabled reason (T4) consumed by the web state (T4/T6); audienceState values (T3) consumed by the UI chips (T6) and E2E asserts (T7).
- Known risks named in-task: ALTER TYPE transaction caveat (T1), findFirstMatchingBlock replication (T3), the approve-path mail responsibility (T5), per-flag adversarial hunt (final review).
