# Enterprise auth, identity governance, and per-seat billing

## Описание фазы

Эта фаза upgrades workspace administration for B2B use: Notion-aligned people
roles, pending member invitations, page-scoped guests, blocking, allowed email
domains, domain verification, enterprise SSO/provisioning path, security controls,
admin content search, and per-seat billing on top of existing YooKassa billing.

## Official Notion alignment anchors

Use these official docs as behavior anchors, but do not copy Notion's exact
commercial packaging unless AnyNote has the same plan flags:

- https://www.notion.com/help/whos-who-in-a-workspace
- https://www.notion.com/help/add-members-admins-guests-and-groups
- https://www.notion.com/help/billing
- https://www.notion.com/help/members-and-billing
- https://www.notion.com/help/domain-management
- https://www.notion.com/help/saml-sso-configuration
- https://www.notion.com/help/provision-users-and-groups-with-scim
- https://www.notion.com/help/managed-users-dashboard
- https://www.notion.com/en-gb/help/sharing-and-permissions
- https://www.notion.com/en-gb/help/admin-content-search
- https://www.notion.com/pricing

## Полный ожидаемый результат

- Pending member invitations work by email and optional invite link.
- Guests are first-class people in UI and permission checks, but they are
  page-scoped collaborators, not workspace-wide `WorkspaceMember` rows.
- Workspace roles align with Notion-like semantics:
  - workspace owner: manages workspace settings, security, billing, members, and guests;
  - membership admin: can add/remove members and groups, without workspace settings/security/billing access;
  - member: normal paid workspace seat;
  - restricted member: optional/reserved enterprise member with narrower default access, still billable if implemented;
  - temporary member: optional/reserved time-limited member, not a paid seat only if AnyNote explicitly implements that rule;
  - guest: external page-level collaborator, no workspace-wide access, no groups, no settings/billing, no member invites/connections;
  - organization owner / managed user concepts are reserved for verified-domain enterprise org controls.
- Admins can block/unblock users, and blocked users are denied server-side.
- Allowed email domains and SAML JIT auto-join create billable members, not guests.
- Domain verification is distinct from allowed email domains and is required before trusted SAML/SCIM/managed-user controls.
- SAML SSO, SCIM/provisioning, and managed-user controls are either implemented honestly or exposed as disabled enterprise request flows.
- Security settings can disable guest invites/requests, public links/sites/forms, exports, and cross-workspace move/duplicate flows where AnyNote has equivalents.
- Enterprise admin content search belongs in this phase: it may expose workspace content metadata/visibility to owners with audit and privacy warnings. It must not weaken ordinary Phase 1 personal collection access for regular members or guests.
- Per-seat billing counts paid member seats per workspace, excludes guests, previews member billing impact, handles proration for added seats, and keeps AnyNote's YooKassa/Russian invoice workflow.

## Scope и ограничения

Security is the priority: auth secrets must be encrypted/redacted, blocked users
must be denied server-side, billing must not charge guests, and enterprise
connectors must not pretend to work if only placeholders exist.

Notion alignment guardrails:

- A guest is invited to specific pages and sub-pages; do not model guest as a
  global workspace role with broad workspace access.
- SCIM manages members and groups, not guests.
- SAML login is for workspace members; page guests need another login path.
- Allowed email domains are convenient member auto-join rules. Do not treat them
  as proof of domain ownership; security-sensitive controls need domain verification.
- Paid seats are assigned to members in a workspace. Adding members is billable;
  removing members lowers billing at the next interval rather than creating a
  mid-cycle credit. AnyNote may choose different commercial terms only when
  explicitly backed by product requirements.
- Preserve existing YooKassa subscription/payment abstractions. Do not introduce
  Stripe-style assumptions.

## Рабочее задание фазы

Цель: довести workspace management до B2B уровня: pending member invitations,
page-scoped guests, allowed domains, domain verification, SAML/SCIM enterprise
identity, managed-user foundations, admin security controls, content search, and
per-seat billing.

Зависимости: лучше после Фазы 1. Billing часть зависит от existing subscription
infrastructure and YooKassa integration.

## Prompt 8.1 - members, page-scoped guests, invitations, blocking

```text
Цель: улучшить people management до Notion-like модели members vs guests.

Ориентиры по коду и текущей реализации:
- packages/db/prisma/schema.prisma WorkspaceMember
- packages/trpc/src/routers/workspace.ts
- apps/web/src/components/workspace/settings/members-section.tsx
- packages/domain permissions helpers
- auth package/Better Auth integration

Сделай:
1. Add/adjust member invitation model:
   - email;
   - memberRole: WORKSPACE_OWNER | MEMBERSHIP_ADMIN | MEMBER | RESTRICTED_MEMBER_RESERVED;
   - tokenHash;
   - inviterId;
   - expiresAt;
   - acceptedAt;
   - revokedAt / revokedById if existing patterns support it.
2. Update member invite flow:
   - invite unregistered email;
   - optional secret invite link that joins as paid member only when enabled;
   - send email if mail package supports it;
   - accept after registration/login;
   - show billing-impact preview before invite acceptance creates/activates a paid seat.
3. Make guests first-class without making them workspace members:
   - create page-scoped guest invite/access model or reuse page permission model with explicit guest identity;
   - guest invite has pageId, email, page permission level, tokenHash, inviterId, expiresAt, acceptedAt;
   - guest access inherits through sub-pages according to existing page permission rules;
   - guests appear in people settings and page share UI, but cannot be added to groups or workspace-wide access;
   - converting guest -> member must be explicit and show billing impact.
4. Add role semantics:
   - workspace owner can manage settings, security, billing, members, guests;
   - membership admin can add/remove members/groups but cannot change security/billing/workspace settings;
   - member is normal workspace seat;
   - restricted member remains reserved unless the phase implements scoped default access across teamspaces/pages.
5. Add block/unblock:
   - membership status and/or WorkspaceBlockedUser model;
   - blocked users cannot access workspace, pages, guest links, public-private routes, tRPC procedures, engines, or stale collaboration sessions;
   - decide billing semantics explicitly: blocking denies access immediately, but seat count should change only through the member removal/deactivation billing event chosen in Prompt 8.5;
   - audit block/unblock actions.
6. Tests:
   - pending member invite created;
   - accept invite creates/activates membership;
   - guest invite grants page access without workspace-wide membership;
   - guest cannot access workspace settings/groups/billing;
   - guest -> member conversion is explicit and billable;
   - membership admin can manage members but cannot change billing/security settings;
   - blocked user denied server-side across workspace and page guest paths.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Admins can manage members, guests, pending invites, and blocked users without confusing guest collaboration with paid workspace membership.
```

## Prompt 8.2 - allowed domains, domain verification, custom auth providers

```text
Цель: добавить workspace-level identity policy without conflating convenience domains with verified enterprise identity.

Ориентиры по коду и текущей реализации:
- auth package
- Better Auth config
- packages/db/prisma/schema.prisma
- workspace settings routes
- billing preview services from Prompt 8.5 if already available

Сделай:
1. Add models:
   - AllowedEmailDomain: workspace owner convenience rule for automatic member join;
   - VerifiedEmailDomain: DNS/token-based proof of domain ownership, status, verifiedAt, expiresAt for verification token;
   - WorkspaceAuthProvider with type OIDC | OAUTH | SAML_RESERVED and encrypted secrets/metadata;
   - ExternalIdentityLink.
2. Add settings UI:
   - AllowedEmailDomainsSettings with clear warning: users who join through these domains become billable members;
   - DomainVerificationSettings with DNS verification status and retry/expire states;
   - WorkspaceAuthProvidersPage;
   - OidcProviderForm;
   - YandexIdProviderPreset if it matches existing AnyNote product direction.
3. Add login policy:
   - if allowed domains are configured, users with matching email can request/accept automatic workspace membership;
   - do not use allowed domains as a hard security guarantee for SAML/SCIM;
   - optional AnyNote-only "restrict sign-up to configured domains" must be a separate policy flag, named separately from Notion-style allowed domains;
   - provider scoped to workspace;
   - clear user-facing errors for unverified domain, disallowed provider, blocked user, and billable member join.
4. Security:
   - encrypt client secrets and SAML/OIDC private material;
   - never return secrets to client;
   - audit provider/domain changes;
   - domain verification tokens expire and can be rotated.
5. Tests:
   - allowed-domain auto-join creates billable member path, not guest;
   - unverified domain cannot enable trusted SAML/SCIM controls;
   - provider config validation;
   - secrets redacted;
   - blocked user cannot rejoin through allowed domain/provider.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Workspace can express convenience auto-join domains, verified enterprise domains, and custom auth providers with honest security boundaries.
```

## Prompt 8.3 - SAML SSO, SCIM provisioning, managed-user enterprise path

```text
Цель: определить безопасный enterprise path for SAML SSO, SCIM, and managed users.

Ориентиры по коду и текущей реализации:
- результаты задачи 8.2 в этой фазе (auth provider/domain models)
- existing auth architecture
- packages/domain role/permission helpers
- packages/trpc workspace/admin routers

Сделай:
1. SAML SSO:
   - if feasible with current auth stack, implement SAML 2.0 metadata config for verified domains;
   - workspace owner configures SAML;
   - support "require SAML authorization for workspace access" only after lockout-safe checks;
   - SAML applies to members, not page guests;
   - SAML JIT provisioning creates/activates a member and must surface billing impact;
   - if not feasible now, expose reserved provider type + disabled enterprise request UI + docs explaining unsupported live connector.
2. SCIM provisioning:
   - implement only if feasible as a real SCIM API; otherwise reserve/disable honestly;
   - scope to Enterprise/verified-domain org concepts, not ordinary workspaces;
   - SCIM can create/remove/retrieve members and groups;
   - SCIM cannot manage guests;
   - role mapping should be explicit: owner | membership_admin | member; restricted_member only if implemented;
   - profile/email updates require verified domain ownership;
   - SCIM token creation/viewing should be limited to org/workspace owners according to AnyNote's final org model.
3. Managed users:
   - add model/placeholder for managed users under verified domains;
   - reserve controls for external workspace access, session duration, force logout, password reset, and managed profile edits;
   - do not implement invasive account takeover or personal workspace controls unless explicit product requirements exist.
4. LDAP/ActiveDirectory:
   - treat direct LDAP as an AnyNote extension, not a Notion analogue;
   - do not ship a fake live connector;
   - prefer SAML/SCIM through the customer's IdP unless a later product decision requires LDAP.
5. Tests:
   - reserved provider types don't break UI/API;
   - disabled enterprise UI doesn't expose fake working connector;
   - SAML requires verified domain when enabled;
   - guests cannot use SAML/SCIM paths;
   - SCIM role mapping rejects guests and unknown roles;
   - JIT/member provisioning emits billing preview/event.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Product messaging is honest; architecture leaves clean paths to real SAML/SCIM/managed-user enterprise controls.
```

## Prompt 8.4 - enterprise security settings and admin content search

```text
Цель: add Notion-like enterprise security controls and keep Phase 1 personal privacy semantics intact.

Ориентиры по коду и текущей реализации:
- packages/domain permission helpers from Phase 1
- packages/trpc workspace/page/share routers
- apps/web workspace settings/security UI
- page sharing/public link/export code paths
- engines/search indexing permissions

Сделай:
1. Add WorkspaceSecurityPolicy model/settings:
   - disableGuestInvites;
   - allowGuestInviteRequests;
   - disablePublicLinksSitesForms or equivalent flags for existing AnyNote publish/share features;
   - disableExport;
   - disableMoveDuplicateOutsideWorkspace if AnyNote has cross-workspace move/duplicate;
   - configuredById, updatedAt.
2. Enforce settings server-side:
   - page guest invites;
   - guest invite requests/approvals;
   - public link creation and existing public link visibility changes;
   - exports;
   - move/duplicate across workspaces;
   - engines/collaboration paths where security state matters.
3. Add guest request workflow if guest invites are disabled for members:
   - members with full page access can request page guest invite;
   - workspace owners approve/reject;
   - request stores pageId, email, permission level, requesterId, decision, decidedById.
4. Add AdminContentSearchService:
   - workspace owners can search by page ID/title/content and filter by creator/date/audience;
   - results show location, private/shared-internally/shared-externally/public state, creator, createdAt, lastEditor, lastEditedAt, and who can access;
   - owners can unpublish/revoke/change permissions from this flow;
   - every search/export/permission override is audited.
5. Privacy guardrail:
   - this is the only admin override path for content visibility;
   - ordinary members, membership admins, guests, and normal page search must still respect Phase 1 personal collection/page permissions;
   - UI must show a privacy/legal warning before enabling or using admin content search;
   - avoid surfacing private content snippets broadly unless the owner explicitly opens the audited content-search flow.
6. Tests:
   - disabled public links blocks new public share and can revoke existing links;
   - disable export blocks export endpoints;
   - disable guests blocks direct member guest invite but allows owner-approved request if enabled;
   - admin content search can find private/shared/public pages for workspace owner only;
   - membership admin cannot use content search unless product explicitly grants it;
   - regular personal collection access remains unchanged outside this audited admin path;
   - audit events emitted for policy changes and content permission overrides.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter engines test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Enterprise owners can secure and inspect workspace sharing safely, while normal personal/private access remains permission-bound.
```

## Prompt 8.5 - per-seat billing and invoice workflow

```text
Цель: добавить billing model by paid member seats with Notion-aligned member/guest boundaries and AnyNote/YooKassa invoice workflow.

Ориентиры по коду и текущей реализации:
- packages/trpc/src/services/billing.ts
- packages/trpc/src/routers/subscription.ts
- apps/web/src/components/billing/**
- apps/engines/src/apps/billing/**
- packages/db/prisma/schema.prisma Plan/Subscription
- packages/yookassa
- Prompt 8.1 invite/member/guest models
- Prompt 8.2 allowed-domain/SAML JIT paths

Сделай:
1. Add models:
   - WorkspaceSeatSnapshot;
   - SeatBillingEvent;
   - InvoiceRequest;
   - ProrationLineItem if persisted;
   - optional OpenSeat/CreditLedger only if needed to model removals until next billing interval.
2. Add SeatCounterService:
   - one paid seat per active workspace member;
   - count workspace owners, membership admins, members, and restricted members if implemented;
   - exclude guests/page guests;
   - exclude temporary members only if AnyNote explicitly implements temporary-member no-seat semantics;
   - removed/deactivated members lower billable count at the next billing interval unless AnyNote product requirements say otherwise;
   - blocked users are denied immediately, but seat billing changes only when the membership is removed/deactivated through a billing event.
3. Add ProrationService:
   - prorate added paid members for the remainder of the current billing interval;
   - do not create mid-cycle credits for removals by default;
   - support monthly and annual intervals using existing AnyNote plan/subscription data;
   - keep formulas deterministic and covered by tests.
4. Integrate billable membership paths:
   - member invite acceptance;
   - member invite link join;
   - guest -> member conversion;
   - allowed-domain auto-join;
   - SAML JIT provisioning if implemented;
   - block or warn when plan/payment requires action before a paid member can join.
5. Keep guests free:
   - page guest invite never creates seat billing event;
   - SCIM cannot convert/manage guests;
   - UI copy must make guest vs member billing boundary explicit before invite/convert.
6. Add invoice/legal entity request:
   - form;
   - status;
   - admin notification/email if mail package supports it;
   - YooKassa payment/invoice handoff stays product-specific;
   - invoice lines reference seat snapshots, member additions, proration, and Russian legal entity fields where existing billing supports them.
7. Tests:
   - guest excluded;
   - workspace owner/member/membership admin counted as paid member seats;
   - new paid member creates billing event;
   - guest -> member conversion creates billing preview/event;
   - allowed-domain/SAML JIT join creates billing preview/event;
   - removal lowers count at next interval, not as immediate mid-cycle credit;
   - proration calculation for added member;
   - invoice request created;
   - YooKassa integration paths remain compatible.

Проверки:
- pnpm --filter @repo/trpc test
- pnpm --filter engines test
- pnpm --filter web lint
- pnpm check-types

Критерий готовности:
- Team billing scales by paid member seats without charging guests or surprising admins, and it preserves AnyNote's YooKassa/legal-entity workflow.
```
