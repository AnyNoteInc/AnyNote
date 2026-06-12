# Identity Governance — Allowed Domains, Domain Verification, SSO (Phase 8B)

**Date:** 2026-06-13
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl8.md` Prompts 8.2 + 8.3 — sub-phase 2 of 4 (8A people ✓ → **8B identity** → 8C security+search → 8D billing)

Workspace-level identity policy without conflating convenience domains with
verified enterprise identity: allowed email domains (auto-join convenience),
DNS-verified domains (proof of ownership), real per-workspace OIDC SSO via
`@better-auth/sso`, honestly-reserved SAML/SCIM/managed-user paths, and an
instance-level sign-up restriction flag. Builds on 8A: `WorkspaceAuditLog`,
the join ladder (`joinViaLink` template), block/seat checks.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Provider depth | **Real OIDC** via the official `@better-auth/sso` plugin (runtime per-workspace providers). OAUTH type covered by the same plugin's non-discovery config. **SAML_RESERVED + SCIM + managed users: honestly disabled** (truthful UI + enterprise request, no fake connectors) — cl8 8.3's sanctioned path. |
| Auto-join UX | **Prompt-based accept**: matching users see «Доступны по домену» surfaces and join with one explicit click; never silent membership. SSO JIT lands on the same prompt path. |
| Domain verification | On-demand TXT check (`anynote-verification=<token>`, token TTL 7 days, rotatable), injectable `ResolveTxtFn`; VERIFIED is durable (no re-check cron this phase). |
| Sign-up restriction | Instance-level `RESTRICT_SIGNUP_EMAIL_DOMAINS` env (comma list) enforced in better-auth `databaseHooks.user.create.before` — covers password AND social sign-ups; named/documented separately from workspace allowed domains. |

## 2. Data model (packages/db, one migration `*_identity_governance`)

```prisma
enum DomainVerificationStatus { PENDING VERIFIED EXPIRED }
enum AuthProviderType { OIDC OAUTH SAML_RESERVED }
enum AuthProviderStatus { ACTIVE DISABLED }

model AllowedEmailDomain {
  id          String   @id @default(uuid(7)) @db.Uuid
  workspaceId String   @db.Uuid            // cascade
  domain      String   @db.VarChar(255)    // lowercase, no '@'; public providers rejected at the router
  addedById   String   @db.Uuid
  createdAt   DateTime @default(now())
  @@unique([workspaceId, domain])
  @@index([domain])                         // the join-prompt lookup arm
}

model VerifiedEmailDomain {
  id             String                   @id @default(uuid(7)) @db.Uuid
  workspaceId    String                   @db.Uuid   // cascade
  domain         String                   @db.VarChar(255)
  status         DomainVerificationStatus @default(PENDING)
  verificationToken String                @db.VarChar(64)   // NOT secret (published in public DNS); plaintext at rest
  tokenExpiresAt DateTime                                    // now() + 7d; rotation regenerates
  verifiedAt     DateTime?
  lastCheckedAt  DateTime?
  lastCheckError String?                  @db.VarChar(255)
  addedById      String                   @db.Uuid
  createdAt / updatedAt
  @@unique([workspaceId, domain])
  @@index([domain])
}

model WorkspaceAuthProvider {
  id              String             @id @default(uuid(7)) @db.Uuid
  workspaceId     String             @db.Uuid              // cascade
  type            AuthProviderType
  name            String             @db.VarChar(100)      // display: «Okta», «Yandex ID»…
  status          AuthProviderStatus @default(DISABLED)
  domainId        String?            @db.Uuid              // FK VerifiedEmailDomain; REQUIRED VERIFIED to activate
  issuerUrl       String?            @db.VarChar(500)      // OIDC discovery base
  clientId        String?            @db.VarChar(255)
  clientSecretEnc Json?                                     // EncryptedPayload; never returned
  ssoProviderId   String?            @unique @db.VarChar(64) // the @better-auth/sso registration id
  metadata        Json?                                      // future SAML metadata etc.; never secrets
  createdById     String             @db.Uuid
  createdAt / updatedAt
  @@index([workspaceId])
}

model ExternalIdentityLink {
  id              String   @id @default(uuid(7)) @db.Uuid
  providerId      String   @db.Uuid               // cascade → WorkspaceAuthProvider
  userId          String   @db.Uuid               // cascade → User
  externalSubject String   @db.VarChar(255)       // OIDC sub
  email           String?  @db.VarChar(255)
  linkedAt        DateTime @default(now())
  @@unique([providerId, externalSubject])
  @@index([userId])
}
```

Note on `@better-auth/sso`: the plugin manages its own `ssoProvider` storage.
`WorkspaceAuthProvider` is OUR source of truth (workspace scoping, domain gate,
encrypted secret, audit); the plugin row is created/updated/deleted in lock-step
(id recorded in `ssoProviderId`). Task 1 of the plan verifies the plugin's
storage shape & API against better-auth 1.6.2 and pins exact versions; if the
plugin's runtime registration proves incompatible, the FALLBACK (pre-approved):
OIDC type ships reserved like SAML and the rest of the phase is unaffected —
the spec's provider model and UI are identical either way.

Audit actions (extend the catalog — new `IDENTITY_AUDIT_ACTIONS` in the domain
identity module, same `WorkspaceAuditLog` table): `domain.allowed_added`,
`domain.allowed_removed`, `domain.verification_started`,
`domain.verification_token_rotated`, `domain.verified`,
`domain.verification_failed`, `domain.joined`, `provider.created`,
`provider.updated`, `provider.activated`, `provider.disabled`,
`provider.deleted`, `provider.enterprise_requested`, `sso.identity_linked`,
`sso.jit_joined`.

## 3. Domain module `packages/domain/src/identity/` (dto/repo/service)

- **Allowed domains**: `addAllowedDomain` (normalize lowercase; reject public
  email providers from a small built-in list — gmail.com, yandex.ru, mail.ru,
  outlook.com, yahoo.com, icloud.com, bk.ru, list.ru, inbox.ru, rambler.ru —
  `PUBLIC_EMAIL_DOMAIN` error; reject malformed), `removeAllowedDomain`,
  `listAllowedDomains`. Audited.
- **Verification**: `startDomainVerification` (creates-or-rotates PENDING row,
  fresh 32-char base62 token, TTL 7d), `rotateVerificationToken`,
  `checkDomainVerification` (injectable `resolveTxt`; looks for
  `anynote-verification=<token>` among TXT records of the exact domain; match ⇒
  VERIFIED + verifiedAt; no match ⇒ stays PENDING with lastCheckError; expired
  token ⇒ EXPIRED — restart required), `removeVerifiedDomain` (also disables
  providers bound to it — audit both). Status read by providers and (8C) trusted
  controls.
- **Auto-join**: `listDomainJoinableWorkspaces(userEmail)` — workspaces with a
  matching AllowedEmailDomain where the user is NOT a member and NOT blocked,
  with seat availability + workspace name; `joinViaDomain({workspaceId, userId,
  userEmail})` — mirrors `joinViaLink`: domain match re-check, `assertNotBlocked`,
  alreadyMember no-op (audited), in-tx seat re-check + member create (role
  EDITOR) + personal collection + audit `domain.joined`, P2002 convergence.
  **Members, never guests** (cl8 hard rule).
- **Providers**: `createProvider` (type OIDC/OAUTH require issuerUrl+clientId+
  secret; SAML_RESERVED stores name only, status locked DISABLED), `updateProvider`
  (secret optional = keep), `activateProvider` — REQUIRES `domainId` pointing at
  a VERIFIED VerifiedEmailDomain of the same workspace (`DOMAIN_NOT_VERIFIED`
  error with the honest message) — registers/updates the @better-auth/sso
  provider and stores `ssoProviderId`; `disableProvider` (deregisters),
  `deleteProvider`. Secrets via `encryptSecret`; decrypt only at (de)registration.
  `requestEnterpriseFeature({feature: 'SAML'|'SCIM'|'MANAGED_USERS'})` — audit
  row + notification to the owner (no fake connector).
- **SSO resolution**: `resolveSsoProviderForEmail(email)` — domain of the email
  → VERIFIED VerifiedEmailDomain → ACTIVE provider → `{ssoProviderId}` (used by
  the sign-in page; unknown ⇒ null, no oracle about which workspaces exist —
  return null uniformly for no-provider/unverified/disabled).
- **JIT/link**: post-SSO-login hook records `ExternalIdentityLink` (upsert on
  providerId+subject; audit `sso.identity_linked` once) and the landing surfaces
  the domain-join prompt (no silent membership; cl8: JIT "must surface billing
  impact" — the prompt carries the same preview line as invites).
- All error codes follow the people-module pattern (`IDENTITY_ERROR_CODES` with
  httpStatus + Russian messages).

## 4. tRPC `identity.*` router

Managed procedures (OWNER-only — domains/providers are security-adjacent, NOT
membership admin work; ADMIN ⇒ FORBIDDEN, pinned by tests):
- `allowedDomains.list/add/remove`
- `verifiedDomains.list/start/rotate/check/remove`
- `providers.list` (stripCreds — no clientSecretEnc/secret material ever),
  `providers.create/update/activate/disable/delete`,
  `providers.requestEnterprise`
Member-level: `domainJoin.listAvailable` (protected; own email), `domainJoin.join`
(protected). Public: none (SSO start goes through better-auth routes, not tRPC).

## 5. Auth integration

- **Plugin**: `@better-auth/sso` added to `packages/auth` (exact version pinned
  after the Task 1 compatibility check), registered in `auth.ts`. Provider
  registration/deregistration happens server-side in the domain service through
  the plugin's API (or direct table writes if that's the plugin's contract —
  Task 1 decides and documents).
- **Sign-in UI**: `/sign-in` gains «Войти через SSO» — expands an email field;
  on submit calls a small public route `POST /api/sso/resolve` (rate-limited by
  simplicity: it only ever returns `{available: boolean}` + starts the better-auth
  SSO flow via the client plugin when available; no workspace names leaked).
  LoginForm (packages/ui) gains an `onSso` slot following the `onGoogle` pattern.
- **JIT**: new SSO users get users created by better-auth (mapProfileToUser
  equivalent config for firstName/lastName per the Google precedent); the
  `(protected)` landing shows the «Доступны по домену» banner (the 8A
  invite-return pattern is NOT needed — the prompt surface is persistent).
- **Sign-up restriction**: `databaseHooks.user.create.before` rejects emails
  whose domain ∉ `RESTRICT_SIGNUP_EMAIL_DOMAINS` when the env is set (clear
  Russian error; covers social; documented in `.env.example` as instance-level,
  distinct from workspace domains). Env in `.env.example` + `turbo.json`.

## 6. Web UI

- **Workspace settings**: new section «Домены и вход» (slug `identity`, after
  `members`; show: `features.membersSettingsEnabled`, locked `!features.isPaid`,
  visible to OWNER ONLY — matches ai/mcp gating): Allowed-domains card (list,
  add with the «станут платными участниками» warning, remove); Verified-domains
  card (add → TXT instructions with copy button + token TTL note, «Проверить»,
  rotate, status chips Ожидает/Подтверждён/Истёк, remove); Providers card (list
  with status, OIDC create/edit dialog [name, discovery URL, client id, secret
  — write-only field], Yandex ID preset button prefilling the known discovery
  URL, activate [domain select of VERIFIED domains]/disable/delete); Enterprise
  card (SAML/SCIM/управляемые пользователи — honest «недоступно» copy +
  «Запросить» buttons → requestEnterprise + success toast). testids:
  `identity-allowed-add`, `identity-verified-row`, `identity-verify-check`,
  `identity-provider-create`, `identity-enterprise-request`.
- **Join prompt surfaces**: banner on the workspace landing when
  `domainJoin.listAvailable` is non-empty («Вам доступно пространство N по
  домену вашей почты — Присоединиться (платное место)») + entries in the
  workspace switcher with a «По домену» chip → confirm dialog with the billing
  preview line → join → workspace activates. testid `domain-join-banner`.
- **Sign-in**: «Войти через SSO» link under the Google button → email field →
  resolve → redirect into the SSO flow or honest «SSO не настроен для этого
  домена».

## 7. Security invariants (test-pinned)

1. Allowed domains NEVER auto-create membership without the user's explicit
   join action; joins are members (billable), never guests; seat/block checks
   in-tx; blocked users see no join surfaces and all join paths deny.
2. Unverified domain can NEVER activate a provider (`DOMAIN_NOT_VERIFIED`);
   removing/expiring a verified domain disables its providers (audited).
3. Secrets: clientSecret encrypted at rest, never in ANY read shape, log, or
   audit metadata; verification tokens are non-secret but rotate; provider
   deletion deregisters from better-auth.
4. ADMIN (membership admin) ⇒ FORBIDDEN on every identity.* managed procedure
   (OWNER-only; pinned regressions).
5. `resolveSsoProviderForEmail` and the join surfaces leak nothing about
   workspaces the caller can't join (uniform nulls; no workspace enumeration by
   probing domains).
6. SAML/SCIM surfaces never pretend to work: no live endpoints, UI copy is
   honest, request flow only audits+notifies.
7. Sign-up restriction rejects at user-creation (both auth paths) with a clear
   error; it does NOT affect existing users' sign-ins.
8. Every identity mutation writes exactly one WorkspaceAuditLog row in-tx.

## 8. Testing

- Domain vitest (real DB): the full identity service ladder (public-domain
  rejection, normalization, verification lifecycle incl. expiry/rotation with a
  fake `ResolveTxtFn` [exact-match, multiple TXT records, missing], join ladder
  [match/no-match/blocked/seat/alreadyMember/P2002], provider lifecycle incl.
  the domain gate + disable-on-domain-removal, audit per mutation).
- tRPC tests: OWNER/ADMIN matrix, stripCreds shapes, join surfaces' no-oracle,
  listAvailable correctness (member/blocked excluded).
- Auth-integration test for the sign-up restriction hook (unit on the hook fn
  with both paths if extractable, else the trpc signUp path + a documented
  manual-check note for social).
- E2E: settings flows (add allowed domain, start verification → TXT
  instructions visible, provider create → activate blocked by unverified domain
  with the honest error, enterprise request toast) + the domain-join banner
  (seed an AllowedEmailDomain matching the test user's email domain via prisma
  → banner appears → join → workspace in the switcher). SSO login flow itself:
  integration-tested with mocked fetch, NOT E2E (no live IdP).
- Full gates; changelog block «Домены и корпоративный вход».

## 9. Non-goals (this phase)

- Live SAML/SCIM/managed users (reserved; 8C/later when product demands).
- Re-validation cron for verified domains; multi-provider-per-domain.
- "Require SSO for workspace access" enforcement (needs lockout-safe checks —
  explicitly deferred per cl8 8.3.1).
- LDAP (cl8: prefer SAML/SCIM later; no fake connector).
- Per-seat billing math (8D; joins emit the same preview surface as 8A).
