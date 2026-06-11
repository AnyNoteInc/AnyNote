# Public Developer Portal — Design (Notion-parity Phase 7C)

**Date:** 2026-06-12
**Status:** approved design (brainstorm decisions locked with the user)
**Roadmap source:** `cl7.md` Prompt 7.3 — closes cl7.

Public, anonymous documentation for AnyNote's developer platform: the REST API
(`/v1/*`, `ank_` API keys), outbound webhooks (Phase 7A), and the Telegram
integration (Phase 7B). Everything documented must match the implementation
exactly — drift is guarded by contract tests, not discipline.

## 1. Locked decisions

| Decision | Choice |
| --- | --- |
| Structure | Multi-page `/developers` section in the `(about)` route group with a docs-style sidebar nav |
| Content source | Markdown files in `docs/developers/*.md` imported via the `@docs` alias (the `/terms`/`/changelog` pattern) |
| Drift guard | Contract vitest importing real constants + asserting verbatim presence in the .md sources; plus E2E render/SEO checks |
| OpenAPI | Manual curated reference now; machine-readable OpenAPI listed as roadmap; self-hosted Swagger `/docs` mentioned |
| Language | Russian (site-wide convention); code samples/identifiers in English |

## 2. Routes & pages

All under `apps/web/src/app/(about)/developers/` — anonymous, static, pure RSC
(no tRPC/React Query — the `(about)` subtree stays clean). Shared
`DevelopersShell` layout component: the existing `(about)` header/footer wrap it
automatically; inside, a left sidebar nav (the five sections, MUI list,
`aria-current` on the active item, collapses to a top select/stack on mobile —
follow whatever `/terms` does for its index/nav) + a content column rendering
the imported MDX with the site's typography.

| Route | Source file | Content |
| --- | --- | --- |
| `/developers` | `docs/developers/overview.md` | What the platform offers (REST API, webhooks, Telegram), quick start: create a key in **Настройки → API-ключи** (`/settings/api`), first request (`curl` to `POST /v1/search/pages`), where to get the base URL, links to the other pages. Roadmap block: OAuth/marketplace/public-app review and link previews/connectors are NOT available — explicitly future; machine-readable OpenAPI export planned. |
| `/developers/api` | `docs/developers/api.md` | Authentication (`Authorization: Bearer ank_<24 base62>`; 401 for missing/invalid/revoked/expired; key TTLs `7d/30d/90d/1y/never`; revocation; `lastUsedAt` updated at most once per 60 s; the full key shown once at creation). Endpoint reference: every public endpoint (see §3) with method, path, request fields (name/type/required/constraints from the real DTOs), response shape, and one example. Shared examples section: `curl` + JS `fetch` incl. error handling; note that list endpoints use limit/offset (files: limit ≤ 200). Self-hosted note: Swagger UI at the engines `/docs` endpoint. |
| `/developers/webhooks` | `docs/developers/webhooks.md` | Event catalog: the 8 emitted types with hint shapes (`page.created` + `duplicatedFrom`, `page.moved` + `to`, rest `{}`), the 3 «скоро» types (`collection.created`, `collection.updated`, `database.row_changed`). Payload envelope v1 verbatim JSON shape (version/id/event/timestamp/workspaceId/actor/resource/hints) + the metadata-only contract (no titles/content ever; fetch details via the authenticated API). Delivery headers table: `X-AnyNote-Signature`, `X-AnyNote-Timestamp`, `X-AnyNote-Event`, `X-AnyNote-Delivery`, `X-AnyNote-Payload-Version`. Signature verification: base string `{timestamp}.{body}`, HMAC-SHA256, header `sha256=<64 hex>`, timing-safe compare, replay window guidance (reject stale timestamps) — with a complete Node.js sample. Verification challenge: POST `{type:'verification', challenge, subscriptionId}` with the same headers (`X-AnyNote-Event: verification`); respond 2xx and echo the challenge within the first 4096 chars; redirects are NOT followed (3xx = failure). Retries: backoff 60 s · 2^n capped at 30 min, auto-disable after 10 consecutive failures, re-enable via «Проверить»/«Возобновить». Ordering caveat: at-least-once, no ordering guarantee, dedupe by `id`. Security: HTTPS-only, private/loopback/link-local/metadata ranges blocked, secrets `whsec_` + 32 base62 shown once, ≤ 20 subscriptions per workspace, TEAM-section content only. |
| `/developers/telegram` | `docs/developers/telegram.md` | Admin guide: create a bot via @BotFather, paste the token (`digits:30+ chars`) in **Настройки пространства → Телеграм** (requires OWNER/ADMIN + developer-space plan), connect/verify handshake, add the bot to chats, subscribe TEAM collections to chats with event filters (≤ 50), delivery + audit logs. User guide: link identity via `/settings/integrations` → code (8 chars, 15 min, single-use) → `/link CODE`; commands `/help`, `/search` (title search over the chat's subscribed collections), `/get` (page card); permission ladder (linked + workspace member + chat scope); privacy: personal sections never leave the workspace, message texts carry titles + links only, every command is audited. |
| `/developers/changelog` | `docs/developers/changelog.md` | API versioning: v1 is current/stable; webhook payload envelope versioned via `X-AnyNote-Payload-Version` (currently `1`). Deprecation policy: breaking changes only with a new version, ≥ 90 days notice on this page, additive changes (new fields/event types) are non-breaking — consumers must tolerate unknown fields/events. Initial entries: 2026-06 outbound webhooks; 2026-06 Telegram integration; REST API v1 baseline. |

`generateStaticParams`-style dynamic routing is NOT needed — five static routes,
each its own `page.tsx` importing its `.md` (the `/changelog` pattern), wrapped
in `DevelopersShell` via a shared `layout.tsx` for the `/developers` segment.

## 3. Endpoint reference scope (api.md)

Document exactly these (from `apps/engines/src/apps/api/`):
`GET /healthz`, `GET /v1/meta` (both unauthenticated); authenticated:
`GET /v1/workspaces`; `POST /v1/workspace/stats|files|skills|agents|create-page-from-file`;
`POST /v1/pages/create|update|move|markdown|stats`;
`POST /v1/page-files/upload-file|upload-image|attach-file|attach-image|list`;
`POST /v1/search/pages`. Field tables come from the real DTOs (the plan cites
the DTO files); upload endpoints note the 1 MB base64 limit; search notes
`query` 1–500 chars and `k` 1–20 (default 10). The base URL is presented as
«адрес вашего сервера AnyNote Engines» with the production hostname left to the
operator (document the path shape only) — the implementer must check
`deploy/` for a public engines hostname and, if one exists, name it.

## 4. Navigation, SEO, infrastructure

- `apps/web/src/components/home/content.ts`: add «Разработчикам» → `/developers`
  to `publicNavItems` (after «Обновления») and to the footer «Продукт» section.
- `apps/web/src/app/sitemap.ts`: add the five routes. `robots.ts` already allows
  public routes — verify no `/developers` disallow.
- Each page: `buildMetadata()` (title, description, canonical, keywords) +
  `breadcrumbsSchema()` JSON-LD (the `/terms/[document]` pattern).
- `apps/web/Dockerfile`: add `COPY --from=prepare /app/docs/developers ./docs/developers`
  next to the existing terms/changelog COPY lines (the turbo-prune gotcha).
- No new env vars. No DB changes. No new packages.

## 5. Drift guards (contract tests)

`apps/web/test/developer-docs-contract.test.ts` (vitest, node env — reads the
.md files from `docs/developers/` with `fs.readFileSync`):

- From `@repo/webhooks`: every value of `WEBHOOK_EVENT_TYPES` appears in
  webhooks.md; every value of `COMING_EVENT_TYPES` appears; the delivery header
  names appear. Header names are string literals inside `deliver.ts` today —
  export a `WEBHOOK_DELIVERY_HEADERS` constant (object) from `@repo/webhooks`
  and use it in BOTH `deliver.ts` and `challenge.ts` (replacing the literals;
  behavior-neutral refactor guarded by the existing 99 tests), then assert each
  header name appears in the doc.
- Signature/secret shape: `sha256=`, `whsec_`, the base-string description
  (assert the literal `{timestamp}.{body}` or its doc spelling appears), the
  4096 echo window, backoff numbers (`60`, cap `30`), auto-disable `10`, cap
  `20` — import the real constants where exported (`DEFAULT_AUTO_DISABLE_THRESHOLD`
  etc. — export the handful that aren't, same pattern as the headers).
- From `@repo/telegram` / trpc: link-code alphabet/length (8), TTL 15 min,
  subscription cap 50, token regex shape — assert their doc presence (import
  what's exported; for router-local constants like the 50 cap, export or
  hardcode-with-comment — prefer exporting `TELEGRAM_LIMITS` from `@repo/telegram`).
- API: `ank_` prefix, the five TTL labels, the Bearer format line, every
  documented endpoint path (`/v1/pages/create` etc.) appears in api.md — and
  inversely, every controller route string in the engines source appears in the
  doc: the test reads the controller files (path-relative `fs.readFileSync` of
  `apps/engines/src/apps/api/rest/*.controller.ts`) and extracts
  `@Controller('...')` + `@Post('...')`/`@Get('...')` decorators to build the
  real route list, then asserts api.md mentions each. New endpoint without docs
  ⇒ red test.
- All cross-package imports here are dev/test-only inside `apps/web/test` —
  verify `pnpm check-architecture` tolerates them (tests are typically
  excluded; if not, read the constants via the same fs approach as the
  controllers).

## 6. E2E

`apps/e2e/developers.spec.ts` (template: `changelog.spec.ts` + `seo.spec.ts`
helpers; cookie-consent beforeEach):
1. Anonymous render: each of the five routes shows its h1 («Разработчикам» /
   «API», etc.) and a known content marker (e.g. `ank_` on /developers/api,
   `X-AnyNote-Signature` on /developers/webhooks).
2. Nav: from the home page, the header link «Разработчикам» lands on
   /developers; the sidebar navigates to /developers/webhooks.
3. Links: collect all internal `<a href>` on the five pages and assert each
   resolves (HEAD/GET 200, the seo.spec link-checking style) — catches typoed
   internal routes.
4. SEO: canonical + og:title present on /developers; BreadcrumbList JSON-LD on
   a subpage.

## 7. Testing summary

- Contract vitest (web): constants ↔ docs, endpoint inventory ↔ docs.
- Web lint/check-types/build (the .md imports must compile through @next/mdx).
- E2E: render, nav, links, SEO.
- Full `pnpm gates`.
- Product changelog `docs/changelog.md`: add a «Портал для разработчиков» block.

## 8. Non-goals

- OAuth, marketplace, public-app review, API v2 — roadmap text only.
- Link previews/connectors — named as a deferred parity surface.
- Generated OpenAPI artifact — roadmap (manual reference is the contract for now).
- English localisation; versioned docs; search within docs.
