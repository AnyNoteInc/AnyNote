# People Management — Members, Guests, Invitations, Blocking (Phase 8A)

**Date:** 2026-06-12
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl8.md` Prompt 8.1 — sub-phase 1 of 4 (8A people → 8B identity → 8C security+search → 8D billing)

Notion-aligned people model: pending email invitations (registered or not), an
optional workspace join link, page-scoped guests that are first-class people but
never workspace members, membership-admin role semantics, and workspace-level
blocking with server-side denial on every surface. Security is the priority.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Role mapping | Reuse `RoleType`. OWNER = workspace owner (settings/security/billing + everything ADMIN can). **ADMIN becomes the membership admin**: gains invite/role-change/remove powers (never affecting OWNER rows or granting OWNER), keeps NO access to billing/security/workspace settings. EDITOR/COMMENTER/VIEWER = member seats. RESTRICTED_MEMBER reserved (UI mentions it as «скоро», no enum value). |
| Workspace GUEST role | Frozen legacy: removed from every invite/role UI and from role-change targets; existing GUEST members keep working (VIEWER-equivalent — they already sit in the VIEWER buckets of `scopesForRole` and role lists). New page-scoped guests are a DIFFERENT concept. |
| Guest UX | Full in-app: guests sign in normally; a workspace where they only have grants shows a «Доступные мне» sidebar section listing granted pages; guests appear in members settings as a separate «Гости» list and in the share dialog. No collections, no settings/groups/billing. |
| Blocking | `WorkspaceBlockedUser` table; the member row (seat) survives until explicit removal. A block denies access centrally (every membership/grant authority) including invite/guest/link (re-)acceptance. Audited. |

## 2. Data model (packages/db, one migration `*_people_management`)

```prisma
model WorkspaceInvitation {
  id             String    @id @default(uuid(7)) @db.Uuid
  workspaceId    String    @db.Uuid                     // cascade
  email          String    @db.VarChar(255)             // stored lowercase
  role           RoleType                                // router-constrained: ADMIN | EDITOR | COMMENTER | VIEWER
  tokenHash      String    @unique @db.VarChar(64)      // sha256 of a 32-char base62 token; plaintext only in the email link
  inviterId      String    @db.Uuid
  expiresAt      DateTime                                // now() + 7 days
  acceptedAt     DateTime?
  acceptedById   String?   @db.Uuid
  revokedAt      DateTime?
  revokedById    String?   @db.Uuid
  createdAt / updatedAt
  @@index([workspaceId, createdAt(sort: Desc)])
  @@index([email])
  // partial unique (raw SQL in the migration, job-infra pattern):
  // CREATE UNIQUE INDEX workspace_invitations_one_active ON workspace_invitations (workspace_id, email)
  //   WHERE accepted_at IS NULL AND revoked_at IS NULL;
}

model WorkspaceInviteLink {
  id          String   @id @default(uuid(7)) @db.Uuid
  workspaceId String   @unique @db.Uuid                  // cascade; one link per workspace
  tokenHash   String   @unique @db.VarChar(64)
  role        RoleType @default(EDITOR)                  // router-constrained: EDITOR | COMMENTER | VIEWER (not ADMIN)
  enabled     Boolean  @default(false)
  createdById String   @db.Uuid
  rotatedAt   DateTime?
  createdAt / updatedAt
}

model PageGuestInvite {
  id             String        @id @default(uuid(7)) @db.Uuid
  pageId         String        @db.Uuid                  // cascade
  workspaceId    String        @db.Uuid                  // denormalized for people-settings listing; cascade
  email          String        @db.VarChar(255)          // lowercase
  role           PageShareRole                            // READER | COMMENTER | EDITOR
  tokenHash      String        @unique @db.VarChar(64)
  inviterId      String        @db.Uuid
  expiresAt      DateTime                                 // now() + 7 days
  acceptedAt     DateTime?
  acceptedById   String?       @db.Uuid
  revokedAt      DateTime?
  revokedById    String?       @db.Uuid
  createdAt / updatedAt
  @@index([workspaceId])
  @@index([pageId])
  // partial unique on (page_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL
}

model WorkspaceBlockedUser {
  id          String   @id @default(uuid(7)) @db.Uuid
  workspaceId String   @db.Uuid                           // cascade
  userId      String   @db.Uuid                           // cascade
  blockedById String   @db.Uuid
  reason      String?  @db.VarChar(255)
  createdAt   DateTime @default(now())
  @@unique([workspaceId, userId])
  @@index([userId])
}

model WorkspaceAuditLog {
  id           String   @id @default(uuid(7)) @db.Uuid
  workspaceId  String   @db.Uuid                          // cascade
  actorId      String?  @db.Uuid                          // null = system
  action       String   @db.VarChar(64)                   // see catalog below
  targetUserId String?  @db.Uuid
  targetEmail  String?  @db.VarChar(255)
  metadata     Json?
  createdAt    DateTime @default(now())
  @@index([workspaceId, createdAt(sort: Desc)])
}
```

Audit action catalog (string constants in `@repo/domain` people module):
`member.invited`, `invite.revoked`, `invite.accepted`, `invite_link.enabled`,
`invite_link.disabled`, `invite_link.rotated`, `invite_link.joined`,
`member.role_changed`, `member.removed`, `guest.invited`, `guest.invite_revoked`,
`guest.joined`, `guest.access_revoked`, `guest.converted_to_member`,
`user.blocked`, `user.unblocked`. 8B/8C append their own actions.

Token pattern: 32-char base62 plaintext (the `@repo/webhooks` generator pattern),
sha256 hex at rest; links `/invite/{token}` (member), `/join/{token}` (link),
`/guest-invite/{token}` (guest). Plaintext appears only in the email/clipboard.

## 3. Domain module `packages/domain/src/people/` (dto/repo/service split, established pattern)

The write logic lives in the domain (consumed by tRPC; engines/yjs consume the
read helpers). Key services:

- **`PeopleService`** — invitations (create/revoke/accept), invite link
  (enable/disable/rotate/join), guest invites (create/revoke/accept), guest
  access revocation, guest→member conversion, role changes, member removal,
  block/unblock. EVERY mutation writes its `WorkspaceAuditLog` row in the same
  transaction. `DomainError` codes: `INVITE_NOT_FOUND`, `INVITE_EXPIRED`,
  `INVITE_REVOKED`, `INVITE_EMAIL_MISMATCH`, `ALREADY_MEMBER`, `SEAT_LIMIT_REACHED`,
  `USER_BLOCKED`, `LAST_OWNER`, `FORBIDDEN_ROLE`.
- **`assertNotBlocked(prisma, workspaceId, userId)`** — exported helper; also a
  combined **`assertActiveMembership`** (member row exists AND no block row) that
  replaces direct `workspaceMember.findUnique` assertion logic in:
  - `packages/domain` workspace assertMembership (the existing helper),
  - `packages/trpc` `assertWorkspaceMember` + `assertRole` (delegate to domain),
  - `apps/engines` `membership.ts assertMember`,
  - `apps/yjs` `canAccessPage` (membership arm),
  - `apps/web/src/lib/share-access.ts` (member fast-path AND grant fast-path —
    a blocked user's PageShareUser grant is dead too),
  - `apps/web /api/files/[id]` membership arm,
  - `apps/web/src/lib/agents-token.ts` (refuse to mint for blocked users),
  - invite/link/guest acceptance paths.
  Implementation note: each surface already queries the member row; the cheapest
  uniform shape is one extra indexed `workspaceBlockedUser.findUnique` (or a
  `NOT EXISTS` join where SQL is hand-written in yjs). Keep it ONE helper per
  runtime, all named `assertActiveMembership`/`isWorkspaceBlocked`, so 8B/8C
  inherit the single chokepoints.
- **Guest read-path**: page READ access for signed-in users becomes
  member-OR-grant: a new `assertPageReadable(prisma, userId, pageId)` used by the
  page read routes (getById/tree-adjacent reads) — membership keeps full
  semantics; a `PageShareUser` grant (not blocked) grants the page + its
  sub-pages per the existing share inheritance rules (`buildPageVisibilityWhere`
  already carries the grant arm; the blocker is the per-route
  `assertWorkspaceMember` calls, which become `assertWorkspaceMemberOrPageGrant`
  ONLY on page read/comment surfaces — writes stay member-only except where the
  grant role is EDITOR, matching the existing share-token semantics).

## 4. tRPC surface

Extend `workspace.*` (or a new `people.*` router — implementer follows the
existing router-size conventions; prefer a new `people.ts` router mounting
`people:`):

Member management (OWNER **or ADMIN** — the new semantics; ADMIN additionally
can never: target an OWNER row, grant OWNER, block an OWNER):
- `invite { workspaceId, email, role }` — works for unregistered emails; creates
  `WorkspaceInvitation` (re-invite of an active invite refreshes token+expiry);
  if the email belongs to an existing member → `ALREADY_MEMBER`; seat-limit
  pre-check (count members + pending invites? NO — pending invites don't hold
  seats; the limit re-checks at acceptance); sends the `invitation` mail with
  `/invite/{token}`; emits the in-app WORKSPACE_INVITE notification only when
  the email maps to a registered user. Returns the billing-impact preview
  (`{currentMembers, maxMembers, planSlug, isPaid, periodEnd}`).
- `listInvitations`, `revokeInvitation { id }`.
- `updateMemberRole`, `removeMember` — moved/extended to OWNER|ADMIN with the
  OWNER-protection rules; `removeMember` also deletes the user's PageShareUser
  grants? NO — removal keeps grants (they'd become a guest); explicit design:
  removing a member who still has page grants moves them to the «Гости» list,
  and the UI says so.
- `block { workspaceId, userId, reason? }` / `unblock` (OWNER|ADMIN; cannot
  block OWNER; cannot block self).
- `inviteLink.get/enable/disable/rotate` (OWNER|ADMIN) — returns the plaintext
  link only from enable/rotate.
- `listGuests { workspaceId }` — users with ≥1 PageShareUser grant on the
  workspace's pages AND no member row, plus pending PageGuestInvites; includes
  per-guest page count.
- `convertGuestToMember { workspaceId, userId, role }` (OWNER|ADMIN) — creates
  the member row (seat-limit + block checks, billing preview in UI first),
  audits `guest.converted_to_member`.
- `revokeGuestAccess { workspaceId, userId }` — deletes all the guest's grants
  on this workspace's pages + revokes their pending invites.

Acceptance (any authenticated user; public token-resolution endpoints return
only safe metadata):
- `resolveInvite { token }` (public) — `{workspaceName, inviterName, role, email-masked, state}`.
- `acceptInvite { token }` — session email must equal invite email
  (case-insensitive) else `INVITE_EMAIL_MISMATCH`; checks expiry/revocation,
  block list, seat limit; creates member + personal collection (existing
  ensure-personal-collection helper), marks accepted, audits.
- `resolveJoinLink { token }` / `joinViaLink { token }` — same checks; role from
  the link; disabled link ⇒ `INVITE_NOT_FOUND` (no enable-state oracle).
- `resolveGuestInvite { token }` / `acceptGuestInvite { token }` — creates the
  `PageShareUser` grant (ensure PageShare row exists — the existing `ensureShare`),
  marks accepted, audits `guest.joined`.

Guest sharing entry point: `pageShare.inviteGuest { pageId, email, role }`
(manage-rights holders, per the existing `assertCanManageShare`) — creates
`PageGuestInvite` + sends mail. The existing `addUser` (userId-based) stays for
workspace members→grants? It currently REJECTS members; it remains the path for
adding an EXISTING registered non-member user by search; `inviteGuest` is the
email path. Share dialog shows pending guest invites with revoke.

## 5. Web UI

- **`/invite/[token]`, `/join/[token]`, `/guest-invite/[token]`** — public RSC
  pages (in `(protected)`? NO: a dedicated `(invite)` segment that does NOT
  require a session): show the resolve-state card; CTA «Принять» when signed in
  (matching email) else «Войти»/«Зарегистрироваться» buttons that pass
  `callbackURL=/invite/{token}` through better-auth so acceptance resumes after
  sign-up/sign-in. Mismatched session email → explanatory state + «Сменить
  аккаунт». Expired/revoked → honest states.
- **Members settings section** (`members-section.tsx`, extended): members table
  gains role-change Select (OWNER|ADMIN actors; OWNER rows locked for ADMIN) and
  Block/Unblock + Remove actions with confirm; «Приглашения» list (email, role,
  status chip Ожидает/Просрочено, revoke, re-send); «Ссылка-приглашение» card
  (toggle, role select, copy, rotate; warning «Любой со ссылкой станет
  участником»); «Гости» list (user, granted-pages count, convert-to-member
  button with the billing-preview confirm dialog, revoke-access); the
  billing-impact line shown in the invite form («Занято X из Y мест тарифа Z»).
  ADMIN sees the members section now (today the dialog gates sections by
  OWNER-ish flags — section becomes visible to ADMIN with billing/security
  sections still hidden).
- **Audit subsection** («Журнал действий», OWNER only, keyset 30/page) in the
  members section — renders WorkspaceAuditLog rows in Russian.
- **Sidebar «Доступные мне»**: in a workspace where the user is a guest (no
  member row), the sidebar shows ONLY this section (granted pages, flat list);
  for members with extra grants it's absent (grants on team pages are invisible
  noise). Workspace switcher includes guest workspaces (the workspace list
  query gains the grant arm). All settings/creation affordances hidden for
  guests; server-side every member-gated procedure already denies them.
- **Share dialog**: email invite field (sends `inviteGuest`), pending invites
  list with revoke; existing user-search flow unchanged.

## 6. Mail & notifications

- `invitation` MailKind is reused for member invites (link = `/invite/{token}`).
  Add two templates to `@repo/mail`: `guest-invitation` (page title NOT included
  — metadata-only discipline: «N. пригласил вас к странице в пространстве W»;
  title leaks pre-acceptance are avoided) and reuse for the join link? No mail
  for links. WORKSPACE_INVITE in-app notification fires only for registered
  invitees (lookup by email at invite time).
- Block/unblock: no email (silent denial), audit only.

## 7. Security invariants (test-pinned)

1. A blocked user is denied on EVERY surface: tRPC member procedures, page
   reads (member and grant paths), yjs collaboration token AND live socket
   (the yjs check runs at connect; existing sockets die at the next auth-bearing
   reconnect — document, don't build force-disconnect), engines REST/MCP,
   `/api/files`, agents-token minting, share-access fast-paths, and all three
   acceptance flows. Blocking is workspace-scoped: other workspaces unaffected.
2. Tokens at rest are hashes; resolve endpoints never reveal whether an email is
   registered; disabled/revoked/expired states are uniform where an oracle would
   matter (join link: disabled == not-found).
3. ADMIN cannot: touch OWNER rows, grant OWNER, block OWNER/self, see or change
   billing/security/workspace-settings (existing OWNER-only procedures get
   regression tests pinning ADMIN ⇒ FORBIDDEN).
4. Guests can never: list members beyond what share UI shows them, access
   settings sections/procedures, appear as seat-billable (8D will consume
   `listGuests` semantics), create pages, or see pages beyond their grants
   (sub-page inheritance follows the existing share rules).
5. Seat limit (`WorkspaceLimit.maxMembers`) is enforced at invite-create
   (pre-check, friendly error) AND at every acceptance/conversion/join
   (authoritative re-check in the domain tx).
6. Acceptance is idempotent-safe: double-accept returns ALREADY_MEMBER-style
   success state, the partial unique index prevents duplicate active invites,
   token re-use after acceptance/revocation fails.
7. Every people mutation writes exactly one WorkspaceAuditLog row in-tx.

## 8. Engines / yjs / agents touchpoints

- engines `membership.ts assertMember` gains the block check (one query).
- yjs `canAccessPage`: membership arm gains `workspace: { blockedUsers: { none: { userId } } }`-style condition; ALSO gains the grant arm
  (`share: { users: { some: { userId } } }`) so guests can collaborate on
  granted pages with their grant role (readonly mapping per existing
  connectionConfig.readOnly rules: READER→readonly, COMMENTER→readonly,
  EDITOR→write).
- agents-token: `getMembershipForToken` refuses blocked users (no scopes).
- No outbox/webhook changes (people events are NOT in the 7A catalog; the
  audit log is the record).

## 9. Testing

- Domain vitest (real DB): PeopleService full ladder — invite lifecycle
  (create/refresh/revoke/expire/accept incl. email-mismatch + blocked + seat
  limit), link join lifecycle, guest invite→grant, conversion, block/unblock +
  audit rows asserted for every mutation, LAST_OWNER protection, removal-keeps-
  grants (member→guest transition).
- tRPC tests: role matrix (ADMIN powers + ADMIN restrictions incl. billing/
  security FORBIDDEN regressions; OWNER protections), guest listing shape,
  resolve endpoints' safe metadata, acceptance flows, blocked-user denial on a
  sample of member procedures + page read + files-adjacent path.
- yjs unit: blocked member denied, guest grant admitted with role mapping.
- engines: assertMember blocked test.
- E2E (two-user, `signUpAndAuthAs` ×2 with separate contexts): owner invites
  userB by email → B signs up via the invite link flow → member appears;
  owner guest-invites C to one page → C sees only «Доступные мне» with that
  page and cannot open settings; owner blocks B → B's workspace access dies
  (page open → denial state).
- Full `pnpm gates`; changelog block «Участники, гости и приглашения».

## 10. Non-goals (this phase)

- Per-seat billing math, proration, seat events (8D — but `listGuests`,
  conversion, and the preview shape are built to feed it).
- Allowed domains / domain verification / SSO / SCIM (8B), security policy +
  admin content search (8C).
- Groups; restricted/temporary member semantics (reserved copy only).
- Guest invite requests workflow (8C's `allowGuestInviteRequests`).
- Force-disconnect of live yjs sockets on block.
