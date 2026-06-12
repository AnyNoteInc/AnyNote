# Identity Governance Implementation Plan (Phase 8B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allowed email domains with prompt-based auto-join, DNS domain verification, real per-workspace OIDC SSO via `@better-auth/sso`, honestly-reserved SAML/SCIM, and the instance-level sign-up restriction — per `docs/superpowers/specs/2026-06-13-identity-governance-design.md` (THE SPEC; normative).

**Architecture:** New `packages/domain/src/identity/` module (the people-module pattern: dto/repo/service, UoW tx, audit-in-tx, real-DB tests) + `identity.*` tRPC router (OWNER-only) + better-auth SSO plugin integration + «Домены и вход» settings section + join-prompt surfaces + the sign-up restriction hook.

**Template files:** `packages/domain/src/people/**` (module shape, error/audit catalogs, joinViaLink as THE join template, invite-token generator), `packages/trpc/src/routers/people.ts` + `test/people-router.test.ts`, `packages/trpc/src/routers/ai-provider.ts` (stripCreds + encryptSecret), `packages/webhooks/src/ssrf.ts` (injectable LookupFn precedent for ResolveTxtFn), `packages/auth/src/auth.ts`, `apps/web/src/components/workspace/settings/{members-section,telegram-section}.tsx` + subcomponents, `apps/e2e/people.spec.ts` (fixture techniques).

**Shared-dev-DB migration rule (Task 2):** the established diff→psql→resolve flow (psql user `user`, db `anynote`, container `anynote-postgres-1`; Prisma 7.7 `--from-schema/--to-schema`). NEVER migrate dev/reset.

**Test discipline:** all real-DB asserts FIXTURE-SCOPED (the 8A lesson: no global counts, no global drains). Run suites alone, never concurrently with each other.

**Commits:** Conventional Commits, explicit paths, NEVER `git add -A`.

---

## Task 1: @better-auth/sso compatibility spike (DECIDES the OIDC path)

**Files:** Modify `packages/auth/package.json`, `packages/auth/src/auth.ts`; Create `packages/auth/src/sso.md` (the findings note).

- [ ] **Step 1:** `pnpm --filter @repo/auth add @better-auth/sso` — check the resolved version's peer range against better-auth 1.6.2 (if it demands newer better-auth, evaluate bumping better-auth WITHIN 1.6.x/1.7.x only if zero breaking config changes — read its changelog; otherwise STOP and take the spec's pre-approved fallback: OIDC ships reserved, skip Tasks 6's live parts, report).
- [ ] **Step 2:** Register the plugin in `auth.ts` (and the client plugin in `apps/web/src/lib/auth-client.ts` if one exists). Determine and DOCUMENT in `sso.md`: (a) where the plugin stores providers (own table? requires a Prisma model? run `pnpm --filter @repo/db exec prisma migrate diff` against the plugin's expected schema — better-auth plugins usually need schema additions: check the plugin docs/dist types for the model and ADD it to schema.prisma via the shared-DB flow in Task 2); (b) the server-side API to register/update/remove a provider at runtime (function signatures); (c) how the sign-in flow starts (client `authClient.signIn.sso(...)`? route?); (d) the callback/redirect URL shape (needed for provider setup docs in the UI); (e) JIT user-creation behavior + how firstName/lastName map (the additionalFields requirement — the Google mapProfileToUser precedent).
- [ ] **Step 3:** Prove it END-TO-END against a LOCAL mock OIDC IdP: write a throwaway node script or vitest spinning a minimal OIDC discovery+token endpoint on localhost (static JWKS, one user) — registering a provider pointing at it and completing a code flow in dev. If full-flow proof is impractical inside the spike, prove registration + sign-in REDIRECT generation and document what remains assumed. THE GATE: do not proceed to Task 6's live UI claiming "working SSO" without the redirect at minimum.
- [ ] **Step 4:** `pnpm check-types && pnpm --filter @repo/auth test 2>/dev/null; pnpm --filter @repo/trpc test` (auth has no tests — the trpc suite smoke-checks the auth import). **Step 5 — commit:**
```bash
git add packages/auth/package.json packages/auth/src/auth.ts packages/auth/src/sso.md apps/web/src/lib/auth-client.ts pnpm-lock.yaml
git commit -m "feat(auth): better-auth sso plugin — runtime oidc providers (compatibility spike)"
```
(+ schema/migration files if the plugin needed tables — or defer those to Task 2 and say so.)

---

## Task 2: Schema + migration

**Files:** Modify `packages/db/prisma/schema.prisma`; Create `packages/db/prisma/migrations/20260614090000_identity_governance/migration.sql`.

- [ ] **Step 1:** Spec §2 models verbatim (3 enums + 4 models) + any plugin table from Task 1; conventions per the people/telegram models (uuid(7), snake_case maps, scalar-only actor FKs, relations only where queried: Workspace back-relations `allowedDomains`/`verifiedDomains`/`authProviders`; `WorkspaceAuthProvider.domain` relation to VerifiedEmailDomain (SetNull on delete? NO — the spec says removing a verified domain DISABLES providers: keep `onDelete: SetNull` + the service handles the disable+audit); `ExternalIdentityLink` relations to provider (Cascade) + User (Cascade)).
- [ ] **Step 2:** migration via the shared-DB flow; verify `\d allowed_email_domains` etc. **Step 3:** `pnpm --filter @repo/db check-types && pnpm check-types`. **Step 4 — commit:**
```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260614090000_identity_governance
git commit -m "feat(db): identity governance models — domains, verification, auth providers, identity links"
```

---

## Task 3: Domain identity module — domains + verification + auto-join

**Files:** Create `packages/domain/src/identity/{dto/identity.dto.ts,repositories/identity.repository.ts,services/identity.service.ts,index.ts,identity.module.ts,identity.tokens.ts}` + container registration + root barrel; Create `packages/domain/test/identity/identity.service.test.ts`.

- [ ] **Step 1 (TDD):** per spec §3: allowed domains (normalize, PUBLIC_EMAIL_DOMAIN list — define `PUBLIC_EMAIL_DOMAINS` in the dto with the spec's 10 entries, malformed rejection via a hostname regex), verification lifecycle (`startDomainVerification`/`rotateVerificationToken`/`checkDomainVerification` with injectable `ResolveTxtFn` defaulting to `node:dns/promises` resolveTxt — type `(domain: string) => Promise<string[][]>`; match `anynote-verification=<token>` across flattened records; EXPIRED handling; `removeVerifiedDomain` disabling bound providers in the same tx + both audits), auto-join (`listDomainJoinableWorkspaces` excluding members+blocked+seatless? include seat info, exclude member/blocked; `joinViaDomain` mirroring joinViaLink EXACTLY: re-check domain match, assertNotBlocked, alreadyMember audit parity, in-tx seat re-check, role EDITOR, P2002 convergence, audit `domain.joined`). IDENTITY_AUDIT_ACTIONS + IDENTITY_ERROR_CODES catalogs per spec §2/§3.
- [ ] **Step 2:** the test ladder (fixture-scoped!): public-domain rejection ×3, normalization, verification full lifecycle with fake resolvers (match among multiple TXT, no match, expired token, rotation invalidates old), join ladder (match, no-match ⇒ error, blocked, seat limit in-tx, alreadyMember, double-join race 3-round), provider-disable-on-domain-removal (stub provider rows directly), audit per mutation.
- [ ] **Step 3:** `pnpm --filter @repo/domain test` (alone) + check-types + `pnpm check-architecture`. **Step 4 — commit:**
```bash
git add packages/domain/src/identity packages/domain/src/container.ts packages/domain/src/index.ts packages/domain/test/identity
git commit -m "feat(domain): identity module — allowed domains, dns verification, domain auto-join"
```

---

## Task 4: Domain identity module — providers + SSO resolution + enterprise requests

**Files:** Extend Task 3 files (+ `packages/domain/test/identity/identity.providers.test.ts`).

- [ ] **Step 1 (TDD):** `createProvider` (OIDC/OAUTH validation: issuerUrl https + clientId + secret required, secret → `encryptSecret` [domain already imports nothing from @repo/auth — CHECK: people uses local crypto; secret-encryption lives in @repo/auth... domain CANNOT depend on @repo/auth (tier rules: domain deps = @repo/db + zod). RESOLUTION: the ROUTER encrypts (the ai-provider precedent — encryption at the trpc layer) and the domain stores/returns the opaque Json. Read ai-provider.ts to confirm and mirror; document in the dto types (`clientSecretEnc: unknown`)]; SAML_RESERVED: name only, status locked DISABLED, activate ⇒ FEATURE_RESERVED error), `updateProvider` (secret optional-keep), `activateProvider` (domainId required → VERIFIED check of same workspace ⇒ DOMAIN_NOT_VERIFIED; the SSO registration CALLBACK is injected: the domain service takes a `registerSsoProvider`/`unregisterSsoProvider` port [function props on the service or a small injected adapter — the established Ports decision from the domain initiative: direct-import vs ports → use an injected port here since the implementation lives in @repo/auth land] and stores ssoProviderId), `disableProvider`/`deleteProvider` (deregister via the port; tolerate port failure with audit note? NO — port failure ⇒ throw, state unchanged), `resolveSsoProviderForEmail` (uniform null), `requestEnterpriseFeature` (audit + the owner notification via... domain emits nothing per the architecture — return data for the router to notify; audit in-tx).
- [ ] **Step 2:** tests: validation matrix, the domain gate, activate/disable round-trip with a fake port capturing calls, secret never appears in any returned shape/audit metadata (assert deep), resolve uniform-null cases (no domain/unverified/disabled/no provider), reserved-type honesty.
- [ ] **Step 3:** suites + check-architecture. **Step 4 — commit:**
```bash
git add packages/domain/src/identity packages/domain/test/identity
git commit -m "feat(domain): auth providers — lifecycle, domain gate, sso resolution, enterprise requests"
```

---

## Task 5: tRPC `identity.*` router + sign-up restriction hook

**Files:** Create `packages/trpc/src/routers/identity.ts`, `packages/trpc/test/identity-router.test.ts`; Modify `packages/trpc/src/index.ts`; Modify `packages/auth/src/auth.ts` (the user.create.before hook), `.env.example`, `turbo.json`.

- [ ] **Step 1 — router** (spec §4): ALL managed procs `assertRole(ctx, workspaceId, ['OWNER'])` (identity is security-adjacent — NOT membership-admin work); the SSO port wiring: the router builds the register/unregister functions from the Task 1 plugin API + `encryptSecret`/`decryptSecret` at this layer (ai-provider pattern) and passes them into the domain calls needing them; `providers.list` stripCreds; `requestEnterprise` → domain + `notify` the workspace owner (pick the closest notification helper or sendMailNow? — in-app via notify.* if a suitable event exists, else skip mail and return ok with the audit as the record — decide from the notifications catalog and report); member-level `domainJoin.listAvailable`/`domainJoin.join` (protectedProcedure; join returns the workspace for redirect).
- [ ] **Step 2 — sign-up restriction:** `databaseHooks.user.create.before` in auth.ts: when `RESTRICT_SIGNUP_EMAIL_DOMAINS` is set (comma list, lowercase), reject creation for non-matching email domains with APIError (Russian message «Регистрация ограничена доменами организации»); env documented in `.env.example` (instance-level note, distinct from workspace domains) + `turbo.json` globalEnv. Unit-test the hook predicate as an exported pure function (`isSignupEmailAllowed(email, envValue)`) + wire test if feasible.
- [ ] **Step 3 — tests:** OWNER/ADMIN matrix on every managed proc (ADMIN FORBIDDEN — pinned), stripCreds (deep shape asserts incl. update-keep-secret), domain-gate activate error, listAvailable correctness (member excluded, blocked excluded, public-domain workspaces NOT listed [can't exist — guarded at add]), join end-to-end incl. billable-member assertion (member row role EDITOR; NOT a guest/grant), uniform-null resolve via the router? (resolve is not exposed via tRPC — sign-in uses the api route in Task 6; skip), no-oracle of resolveInvite-style endpoints n/a.
- [ ] **Step 4:** `pnpm --filter @repo/trpc test` (alone) + lint/check-types. **Step 5 — commit:**
```bash
git add packages/trpc/src/routers/identity.ts packages/trpc/src/index.ts packages/trpc/test/identity-router.test.ts packages/auth/src/auth.ts .env.example turbo.json
git commit -m "feat(trpc): identity router — domains, verification, providers, domain join + signup restriction"
```

---

## Task 6: Sign-in SSO entry + /api/sso/resolve + JIT landing

**Files:** Create `apps/web/src/app/api/sso/resolve/route.ts`; Modify `packages/ui/src/widgets/auth/login-form.tsx` (the `onSso` slot per the onGoogle pattern), `apps/web/src/app/(auth)/sign-in/sign-in-form.tsx`; possibly `apps/web/src/lib/auth-client.ts` (sso client call from Task 1 findings).

- [ ] **Step 1:** `POST /api/sso/resolve {email}` — rate-consideration: cheap single query via the domain resolve (build a server-side caller or direct domain access like other routes — match the invite-accept route's pattern); returns ONLY `{available: boolean}` (+ optionally an opaque providerId the client passes to the better-auth sso sign-in — per Task 1's flow shape). UI: «Войти через SSO» под Google → email input → resolve → start flow or honest «SSO не настроен для этого домена». RSC/client split per the existing form.
- [ ] **Step 2:** the JIT landing surface comes in Task 7 (the domain-join banner covers SSO-JIT users too — verify the flow lands them on `(protected)` where the banner shows).
- [ ] **Step 3:** web lint/check-types/build + a live dev-server click-through against the Task 1 mock IdP IF the spike proved the full flow (else verify the resolve route + UI states only — report which). **Step 4 — commit:**
```bash
git add apps/web/src/app/api/sso packages/ui/src/widgets/auth/login-form.tsx apps/web/src/app/\(auth\)/sign-in/sign-in-form.tsx apps/web/src/lib/auth-client.ts
git commit -m "feat(web): sso sign-in entry — email resolve + provider flow start"
```

---

## Task 7: Settings UI «Домены и вход» + join-prompt surfaces

**Files:** Create `apps/web/src/components/workspace/settings/{identity-section.tsx,allowed-domains-card.tsx,verified-domains-card.tsx,auth-providers-card.tsx,enterprise-card.tsx}`, `apps/web/src/components/workspace/domain-join-banner.tsx`; Modify `workspace-settings-dialog.tsx` (slug `identity` after members; OWNER-only show + locked `!features.isPaid`), the workspace landing/layout (banner placement — find where the 8A guest/active layout renders) + workspace switcher («По домену» entries).

- [ ] **Step 1:** the four cards per spec §6 (TXT instructions block with copy button showing `anynote-verification=<token>` + host guidance; provider dialog with write-only secret field + Yandex ID preset [discovery `https://login.yandex.ru/.well-known/openid-configuration` — VERIFY this URL resolves in a quick curl; if not, use the documented Yandex OAuth endpoints from Task 1 research]; activate dialog with VERIFIED-domain select; enterprise card honest copy). testids per spec §6.
- [ ] **Step 2:** join surfaces: `domain-join-banner.tsx` on the protected landing (listAvailable non-empty ⇒ banner with workspace name + «Присоединиться (платное место)» → confirm dialog with the preview line → join → setActive + refresh); switcher entries with «По домену» chip (reuse the 8A accessKind pattern — a third kind `domainAvailable` rendered as join-on-click). testid `domain-join-banner`.
- [ ] **Step 3:** web lint/check-types/build (env sourced). **Step 4 — commit:**
```bash
git add apps/web/src/components/workspace apps/web/src/components/workspace/settings apps/web/src/app
git commit -m "feat(web): identity settings — domains, verification, providers, enterprise; domain-join surfaces"
```
(Narrow paths to reality.)

---

## Task 8: E2E + changelog

**Files:** Create `apps/e2e/identity.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** (paid fixture per people.spec.ts's subscription+WorkspaceLimit technique; capture-restore): (1) settings: add allowed domain (public domain rejected with the error; corp domain added), start verification → TXT instructions + token visible → «Проверить» fails honestly (real DNS for a nonexistent domain — use `<random>.invalid`); (2) provider: create OIDC (fake discovery URL) → activate blocked with «Сначала подтвердите домен»; enterprise SAML request → success toast; (3) domain-join: seed AllowedEmailDomain matching a SECOND user's email domain via prisma → user B sees `domain-join-banner` → joins via the confirm → workspace in B's switcher, B is a member (prisma assert role EDITOR); cleanup all fixtures.
- [ ] **Step 2 — changelog** («Готовится»):
```md
**Домены и корпоративный вход**

- Разрешённые домены почты: коллеги присоединяются к пространству в один клик (как платные участники). Подтверждение владения доменом через DNS — основа для корпоративных функций.
- Вход через корпоративный OIDC-провайдер для подтверждённых доменов; SAML и SCIM — честно «скоро» с заявкой на ранний доступ.
```
- [ ] **Step 3:** run the spec (foreground, retries, port 3100 free, rm -rf apps/web/.next if a build preceded). **Step 4 — commits:**
```bash
git add apps/e2e/identity.spec.ts && git commit -m "test(e2e): identity — domains, verification honesty, provider gate, domain join"
git add docs/changelog.md && git commit -m "docs(changelog): identity governance"
```

---

## Completion

Group reviews: Tasks 1–4 (auth spike + domain) then 5–8 (API/UI/E2E). Final whole-branch review foci: (1) secret hygiene end-to-end (clientSecret encrypt/decrypt sites, stripCreds, audit metadata, the sso plugin's own storage — does IT store the secret plaintext in its table? Task 1 must answer; if yes, judge and document); (2) the no-silent-membership invariant (every member-creating path is explicit + seat/block-checked: joinViaDomain, SSO JIT [must NOT auto-create membership — verify the plugin doesn't], legacy paths untouched); (3) no workspace enumeration via domains (resolve + join surfaces); (4) OWNER-only matrix; (5) regression (sign-in/sign-up flows for password+Google unaffected; the restriction hook OFF by default; 8A invite flows untouched). Then full `pnpm gates` (alone) and the merge checkpoint.

## Self-review (at plan-writing time)

- Spec §2→T2; §3→T3/T4; §4→T5; §5→T1 (plugin) + T5 (hook) + T6 (UI); §6→T7; §7 invariants distributed + final review; §8→per-task + T8.
- Type consistency: ResolveTxtFn (T3) injected in tests; the SSO port defined in T4's dto consumed by T5's router wiring; IDENTITY_AUDIT_ACTIONS (T3) used by T4/T5; listAvailable shape (T3) consumed by T7 banner.
- Known risks named in-task: plugin compatibility + storage (T1 — with the pre-approved fallback), encryption layering (T4 resolution: router encrypts, ai-provider precedent), Yandex discovery URL (T7 verify), JIT-no-auto-membership (final review focus 2).
