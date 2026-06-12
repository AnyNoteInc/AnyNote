# @better-auth/sso — Phase 8B Task 1 compatibility spike findings

**Verdict: PROCEED-LIVE.** `@better-auth/sso@1.6.2` (exact pin) has peer
`better-auth: ^1.6.2` — matches our installed `better-auth@1.6.2` with **zero
version bump** of better-auth. All transitive peers (`@better-auth/core@1.6.2`,
`@better-auth/utils@0.4.0`, `@better-fetch/fetch@1.1.21`, `better-call@1.3.5`)
were already in the lockfile at exactly the required versions. Do NOT float the
range: newer sso versions (≥1.6.3) peer-require matching newer better-auth.

Proof: `packages/auth/test/sso-flow.test.ts` completes a full OIDC
authorization-code flow (PKCE + state + signed state cookie) against a local
mock IdP, through the **production** `auth` instance and the real Prisma table.

## Plugin registration (what we configured and why)

`packages/auth/src/auth.ts`:

```ts
sso({
  providersLimit: 0, // hard-disables POST /sso/register for EVERYONE
  domainVerification: { enabled: true }, // sign-in requires row.domainVerified === true
})
```

`apps/web/src/lib/auth-client.ts`: `ssoClient({ domainVerification: { enabled: true } })`
(`@better-auth/sso` is a direct dependency of **both** `packages/auth` and
`apps/web` — pnpm strict resolution).

- `providersLimit: 0` makes the plugin's session-gated `/sso/register` endpoint
  throw FORBIDDEN unconditionally (verified by test). Without it, **any**
  signed-in user could register up to 10 providers via HTTP — unacceptable.
  Consequence: `auth.api.registerSSOProvider` is also disabled; we register
  providers by **direct table writes** (below) — sanctioned by the spec
  ("or direct table writes if that's the plugin's contract").
- `domainVerification.enabled` maps OUR workspace DNS verification onto the
  plugin's trust flag: sign-in and callback both reject providers with
  `domainVerified=false` (verified by test), and a verified provider whose
  domain matches the e-mail makes better-auth treat it as a _trusted provider_
  — required for implicit account-linking of EXISTING users (see JIT below).
  We never use the plugin's own `/sso/request-domain-verification` /
  `/sso/verify-domain` TXT flow; we set the flag ourselves at activation
  (those endpoints remain mounted but are ownership-gated and can only set the
  flag after a real DNS check — harmless).

## Provider storage

The plugin defines model `ssoProvider` → our Prisma model `SsoProvider`
(`sso_providers` table, migration
`packages/db/prisma/migrations/20260613100000_sso_provider_plugin/` —
**applied to the shared dev DB via the diff→psql→resolve flow and included in
this commit**). Columns (plugin contract):

| field            | type                   | notes                                                                                          |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| `id`             | uuid                   | Prisma-side `uuid(7)` default (`generateId: false`)                                            |
| `issuer`         | varchar(500)           | IdP issuer URL                                                                                 |
| `domain`         | varchar(255)           | e-mail domain(s); **comma-separated list supported**, subdomain suffix match (`domainMatches`) |
| `oidcConfig`     | text                   | JSON string — see Secrets below                                                                |
| `samlConfig`     | text                   | unused by us (SAML stays reserved)                                                             |
| `userId`         | uuid FK→users, Cascade | "registrant"; we set the activating OWNER                                                      |
| `providerId`     | varchar(64) unique     | the plugin's lookup key; we generate it and store it in `WorkspaceAuthProvider.ssoProviderId`  |
| `organizationId` | varchar(255) null      | better-auth organization plugin only — we always leave NULL                                    |
| `domainVerified` | boolean default false  | the sign-in gate                                                                               |

`WorkspaceAuthProvider` (Task 2) stays OUR source of truth (workspace scoping,
domain gate, AES-encrypted secret, audit); the `sso_providers` row is derived
and recreatable, written/updated/deleted in lock-step.

## Runtime register/update/remove API (the contract Task 4's port implements)

Direct Prisma writes — no plugin API call needed or possible
(`providersLimit: 0`); the sign-in path only _reads_ the table via the adapter:

- **register** (on `activateProvider`): `prisma.ssoProvider.create({ data: {
issuer, domain, oidcConfig: JSON.stringify(hydrated), userId: actorOwnerId,
providerId, domainVerified: true } })`.
- **update**: `prisma.ssoProvider.update({ where: { providerId }, data })`.
- **remove** (on `disableProvider`/`deleteProvider`): `prisma.ssoProvider.delete({ where: { providerId } })`.

**The oidcConfig JSON MUST be fully hydrated** (all of `authorizationEndpoint`,
`tokenEndpoint`, `jwksEndpoint` present), because:

- the plugin's own register-time discovery validates the IdP origin against
  better-auth `trustedOrigins`, which is **computed once at startup** — a
  runtime-registered IdP origin would always be untrusted
  (`discovery_untrusted_origin`);
- `needsRuntimeDiscovery()` short-circuits when those three endpoints exist, so
  a hydrated row needs **no** trustedOrigins entry at sign-in/callback either
  (proven by test — the mock IdP origin was never in trustedOrigins).

So the Task 4/5 register port must itself fetch
`<issuer>/.well-known/openid-configuration` server-side (reuse the
`@repo/webhooks` SSRF guard pattern for the fetch) and persist the hydrated
shape:

```json
{
  "issuer": "...", "clientId": "...", "clientSecret": "...",
  "authorizationEndpoint": "...", "tokenEndpoint": "...",
  "tokenEndpointAuthentication": "client_secret_basic" | "client_secret_post",
  "jwksEndpoint": "...", "userInfoEndpoint": "...?",
  "discoveryEndpoint": "...", "scopes": ["openid","email","profile"], "pkce": true
}
```

If `userInfoEndpoint` is present the callback uses it (Bearer access token);
otherwise it validates the `id_token` against `jwksEndpoint`. Optional
`mapping` ({id,email,emailVerified,name,image,extraFields}) renames claims —
note extraFields do NOT reach the created user (see JIT).

### Crash windows + idempotent port writes (REQUIRED Task 5 behavior)

The identity service runs every port call BEFORE its DB transaction, so a port
failure always leaves the DB untouched — but the reverse window exists: the
port write is not transactional with our tables.

- `activateProvider`: `port.register` success → tx crash ⇒ an **orphan
  `sso_providers` row** while `WorkspaceAuthProvider` stays DISABLED with
  `ssoProviderId = null`, and the retry calls `register` again. The Task 5
  port MUST therefore implement `register` as an **upsert keyed on the
  deterministic `providerId`** (the `sso_providers.provider_id` unique;
  derive it from `SsoRegistrationData.providerId` — the stable
  `WorkspaceAuthProvider.id`) so a retry converges on the same plugin row
  instead of failing or duplicating.
- `removeVerifiedDomain` / `disableProvider` / `deleteProvider`:
  `port.unregister` success → tx crash ⇒ plugin row gone, our row still
  ACTIVE. `unregister` MUST be **delete-if-exists** (tolerate an
  already-missing `providerId`) so the retry converges too.

### Domain-verification TXT values are case-sensitive

The DNS verification token is base62, so the TXT match in
`IdentityService.checkDomainVerification` is case-sensitive — and some DNS
panels lowercase TXT values on save, which makes verification fail forever.
Task 7's TXT instructions card must tell the user «скопируйте точно как
показано» (spec §6 wording).

## Sign-in flow

1. Client: `authClient.signIn.sso({ email, callbackURL, errorCallbackURL?,
newUserCallbackURL? })` → `POST /api/auth/sign-in/sso` (public, no session).
   Provider resolution: by `providerId` if given, else by e-mail **domain**
   (exact column match first, then comma-list/subdomain scan). Response
   `{ url, redirect: true }` — the IdP authorization URL (PKCE S256 +
   `state` persisted in `verification_tokens` + a signed `state` cookie).
2. Browser redirects to the IdP, authenticates, returns to the callback.
3. **Callback URL shape (for provider-setup docs in the UI):**
   `https://<app-host>/api/auth/sso/callback/<providerId>` — GET with
   `code` + `state`. The signed state cookie from step 1 is required
   (CSRF binding) — flows must start at step 1; you cannot deep-link the
   callback.
4. Plugin exchanges the code (basic or post client auth per
   `tokenEndpointAuthentication`), loads userinfo/id_token, links-or-creates
   the user, sets the session cookie, 302-redirects to `callbackURL`
   (`newUserCallbackURL` for first-time users — useful for the JIT landing).

## JIT user creation + firstName/lastName

The callback passes ONLY `{ id, email, name, image, emailVerified }` into user
creation (`createOAuthUser`) — **mapped `extraFields` are dropped**, and there
is no `mapProfileToUser` hook in this plugin. Our `firstName`/`lastName` are
REQUIRED additionalFields and NOT NULL in Postgres, so raw JIT inserts would
fail. **Workaround (implemented, tested):** `databaseHooks.user.create.before`
→ exported pure `withDerivedNameParts()` in `auth.ts` splits `name` exactly
like the Google `mapProfileToUser` fallback; it is a no-op whenever
firstName/lastName are explicitly provided (email/password + Google paths
unchanged). The existing `user.create.after` hook (personal subscription +
preferences) runs for JIT users too — same code path Google OAuth already
exercises (subscription row asserted in the test).

- `emailVerified`: created as **false** (we do not set `trustEmailVerified` —
  it is deprecated and account-takeover-prone); better-auth then fires our
  `sendVerificationEmail` (sendOnSignUp) for the JIT user. The user is still
  signed in immediately (session cookie set by the callback).
- **Existing users** (password/Google) signing in via SSO: implicit account
  linking happens ONLY because `domainVerification` is on and the provider row
  is `domainVerified=true` with a matching e-mail domain (better-auth's
  `isTrustedProvider`). Otherwise they'd get `?error=account not linked`.
- JIT consent rows: SSO-created users have NO `user_consents` rows → the
  `(protected)` consent gate routes them to `/onboarding/consents` on first
  visit. Correct behavior; no action needed.

## Workspace membership (the no-silent-membership invariant)

**The plugin does NOT touch `WorkspaceMember` — verified two ways:**

1. Code: its "organization provisioning" after-hook is double-gated on
   `ctx.context.hasPlugin("organization")` (we don't use better-auth's
   organization plugin) AND `ssoProvider.organizationId` (we always write
   NULL). It targets better-auth's own `member` model regardless — a table we
   don't even have.
2. Test: after the full JIT flow, `workspaceMember` count for the new user is
   asserted `0`.

SSO JIT users land with a session and no membership; the Phase 8B domain-join
prompt surfaces (Task 7 banner) are the only membership path.

## Secrets — PLAINTEXT EXPOSURE (for the final review)

**Yes: the plugin stores `clientSecret` in PLAINTEXT** inside the
`sso_providers.oidc_config` JSON string. The sign-in/callback handlers
`JSON.parse` that column directly to build the token-exchange request — there
is no encryption hook in `SSOOptions@1.6.2`, so this cannot be avoided while
keeping the plugin's flow. Mitigations (Tasks 2/4/5):

- `WorkspaceAuthProvider.clientSecretEnc` keeps the AES-encrypted copy as the
  source of truth; the plaintext plugin row exists ONLY while the provider is
  ACTIVE (deleted on disable/delete) — exposure window = activation lifetime.
- The row is never returned by any of our APIs (`providers.list` reads
  `WorkspaceAuthProvider` with stripCreds; the plugin's own read endpoints
  sanitize to `clientIdLastFour` and are session+ownership-gated, and
  registration endpoints are disabled).
- DB-at-rest exposure is equivalent to `Account.accessToken`/`idToken`
  (better-auth core), which we already store plaintext in the same database.

Judgement: acceptable, documented; revisit if the plugin grows a
secret-storage hook.

## Proven vs assumed

**PROVEN** (sso-flow.test.ts, production `auth` instance, real DB, local mock
IdP on 127.0.0.1):

- peer-compat install at better-auth 1.6.2, no version bump;
- direct-table-write registration is honored by `/sign-in/sso`;
- authorization redirect generation (correct authorize URL, client_id, PKCE
  challenge, state, `redirect_uri = <baseURL>/api/auth/sso/callback/<providerId>`);
- full code flow: state-cookie CSRF binding, token exchange (basic auth with
  the stored secret + code_verifier), userinfo fetch, 302 to callbackURL with
  a session cookie;
- JIT creation with firstName/lastName derived by the before-hook; account row
  linked to our providerId; after-hook subscription created; emailVerified
  false; zero WorkspaceMember rows;
- `domainVerified=false` ⇒ sign-in UNAUTHORIZED;
- `/sso/register` publicly disabled.

**ASSUMED** (not exercised in the spike):

- a real IdP's discovery document hydrates cleanly through our own
  server-side fetch (the mock's config was hand-hydrated; the discovery
  _fetch_ itself lands in the Task 4/5 register port);
- `client_secret_post` token auth (mock used `client_secret_basic`);
- the id_token/JWKS validation branch (mock exposed `userInfoEndpoint`, which
  takes precedence) — Yandex ID exposes userinfo, so the proven branch is the
  production-relevant one;
- behavior against provider-initiated errors (`?error=...` on the callback)
  beyond code inspection (redirects to `errorCallbackURL ?? callbackURL`).
