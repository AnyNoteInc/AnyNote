# Public Developer Portal Implementation Plan (Phase 7C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public `/developers` documentation section (5 pages) for the REST API, webhooks, and Telegram integration, with contract tests that break the build when docs drift from code — per `docs/superpowers/specs/2026-06-12-developer-portal-design.md` (THE SPEC; normative).

**Architecture:** Markdown in `docs/developers/*.md` imported via the `@docs` alias into static RSC pages under `apps/web/src/app/(about)/developers/` with a shared sidebar shell; a vitest contract suite cross-checks docs against exported package constants and the engines controller route inventory.

**Tech Stack:** @next/mdx + remark-gfm (already configured), MUI v6, vitest, Playwright.

**Template files:** `apps/web/src/app/(about)/changelog/page.tsx` (md import), `apps/web/src/app/(about)/terms/**` (index nav, dynamic doc renderer, breadcrumbs JSON-LD), `apps/web/src/seo/build-metadata.ts`, `apps/web/src/components/home/content.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/Dockerfile:30-36` (COPY gotcha), `apps/e2e/changelog.spec.ts` + `apps/e2e/seo.spec.ts`.

**Commits:** explicit paths only — NEVER `git add -A`.

---

## Task 1: Exported constants surface (drift-guard prerequisites)

**Files:** Modify `packages/webhooks/src/index.ts`, create `packages/webhooks/src/headers.ts`, modify `packages/webhooks/src/worker/deliver.ts`, `packages/webhooks/src/challenge.ts`; modify `packages/telegram/src/index.ts` (+ a small `limits.ts`); possibly `packages/trpc/src/routers/{webhook,telegram}.ts` (import the limits instead of local literals).

- [ ] **Step 1:** `packages/webhooks/src/headers.ts`:
```ts
/** Header names sent on every webhook delivery and verification challenge. */
export const WEBHOOK_DELIVERY_HEADERS = {
  signature: 'X-AnyNote-Signature',
  timestamp: 'X-AnyNote-Timestamp',
  event: 'X-AnyNote-Event',
  delivery: 'X-AnyNote-Delivery',
  payloadVersion: 'X-AnyNote-Payload-Version',
} as const
```
Replace the literal header strings in `worker/deliver.ts` and `challenge.ts` with references (behavior-neutral; the 99 existing tests are the guard — run them). Export from `src/index.ts` alongside the catalog. Also export the existing numeric constants needed by docs/tests: from `worker/deliver.ts` re-export (or move to a `limits.ts`) `BACKOFF_BASE_MS`, `BACKOFF_CAP_MS`, `DEFAULT_AUTO_DISABLE_THRESHOLD`; from `challenge.ts` the `4096` echo window (`CHALLENGE_ECHO_SCAN_CHARS`); plus `WEBHOOK_SECRET_PREFIX = 'whsec_'` (use it in `secret.ts`). Check what's already exported first — add only what's missing.
- [ ] **Step 2:** `packages/telegram/src/limits.ts`: `export const TELEGRAM_LIMITS = { maxSubscriptionsPerConnection: 50, linkCodeTtlMs: 15 * 60_000, linkCodeLength: 8, searchQueryMax: 200 } as const` — and IMPORT these in `packages/trpc/src/routers/telegram.ts` (replacing the local `50`/TTL literals) and in `commands.ts`/`secret.ts` where the 200/8 live, so the constant is the single source. Export from `src/index.ts`. Same for the webhook cap: export `MAX_WEBHOOK_SUBSCRIPTIONS_PER_WORKSPACE = 20` from `@repo/webhooks` and import it in `routers/webhook.ts`.
- [ ] **Step 3 — verify:** `pnpm --filter @repo/webhooks test && pnpm --filter @repo/telegram test && pnpm --filter @repo/trpc test && pnpm check-types && pnpm check-architecture`.
- [ ] **Step 4 — commit:**
```bash
git add packages/webhooks/src packages/telegram/src packages/trpc/src/routers/webhook.ts packages/trpc/src/routers/telegram.ts
git commit -m "refactor(webhooks,telegram): export contract constants for docs drift guards"
```

---

## Task 2: Documentation content — the five markdown files

**Files:** Create `docs/developers/{overview,api,webhooks,telegram,changelog}.md`.

Write in Russian (code/identifiers in English), GFM tables, fenced code blocks with language tags. Content per spec §2 — the spec's per-page table is the outline; FIDELITY RULES:
- Every constant/header/format MUST be read from the source, not memory. Primary sources: `packages/webhooks/src/{headers,signature,payload,catalog,secret,challenge}.ts`, `worker/deliver.ts` (backoff/threshold), `packages/trpc/src/routers/webhook.ts` (cap 20, challenge timeout), `packages/telegram/src/{secret,commands,api}.ts`, `packages/trpc/src/routers/telegram.ts`, `apps/engines/src/apps/api/rest/*.controller.ts` + `apps/engines/src/apps/api/dto/*.dto.ts` (endpoint reference — document EVERY route and EVERY DTO field with type/required/constraints), `apps/engines/src/apps/api/auth/api-key.guard.ts` + `packages/trpc/src/services/api-key.ts` (ank_ format, TTLs, hashing).
- webhooks.md must include: a complete Node.js signature-verification sample (createHmac over `` `${timestamp}.${body}` ``, `timingSafeEqual`, timestamp staleness check), a challenge-handler sample (echo the challenge, 2xx), the envelope v1 JSON example, the headers table, the event table with hint columns, retry/auto-disable numbers, the security bullet list (HTTPS-only; redirects not followed; private/metadata IP ranges blocked; metadata-only payloads — fetch state via the API; secret shown once).
- api.md endpoint reference: one H3 per endpoint, request-field table, response example (shape from DTOs/controllers), then a shared «Примеры» section with curl + JS fetch + error-handling (401 variants verbatim from the guard: `Invalid API key` / `API key revoked` / `API key expired`).
- overview.md quick start: settings path **Настройки → API-ключи**, base-URL note («адрес сервера AnyNote Engines вашей установки»; check `deploy/` compose/traefik for a public engines hostname — if one exists, name it; otherwise state the path-only form), first curl to `/v1/search/pages`, roadmap block (OAuth/marketplace/v2/OpenAPI export/link previews — будущее, не доступно сейчас).
- telegram.md: per spec §2 row (admin flow + user flow + privacy bullets).
- changelog.md: versioning + deprecation policy (≥90 days, additive non-breaking, tolerate unknown fields/events) + three initial entries.

- [ ] **Step 1:** write the five files. **Step 2:** self-check every constant against source (grep each documented literal). **Step 3 — commit:**
```bash
git add docs/developers
git commit -m "docs(developers): portal content — api reference, webhooks, telegram, changelog"
```

---

## Task 3: Routes, shell, nav, SEO, Dockerfile

**Files:** Create `apps/web/src/app/(about)/developers/{layout.tsx,page.tsx,api/page.tsx,webhooks/page.tsx,telegram/page.tsx,changelog/page.tsx}`, `apps/web/src/components/developers/developers-shell.tsx`; Modify `apps/web/src/components/home/content.ts`, `apps/web/src/app/sitemap.ts`, `apps/web/Dockerfile`.

- [ ] **Step 1 — shell:** `DevelopersShell` (client or RSC — RSC preferred; nav needs active-state → use a small client nav subcomponent reading `usePathname`): two-column layout (sidebar ~240px: «Обзор», «REST API», «Вебхуки», «Телеграм», «Изменения API»; content column with the markdown typographic styling — reuse/extend whatever wrapper `/terms/[document]` uses for md body styling). Mobile: sidebar becomes a horizontal scroll row or select above the content (match the repo's existing responsive idioms).
- [ ] **Step 2 — pages:** `layout.tsx` for the segment renders `DevelopersShell`; each `page.tsx` does `import Doc from '@docs/developers/<name>.md'`, exports `metadata = buildMetadata({...})` (unique title/description/canonical per page) and renders `<Doc />` (+ `breadcrumbsSchema` JSON-LD on subpages, the `/terms/[document]` pattern).
- [ ] **Step 3 — wiring:** `content.ts` publicNavItems + footer «Продукт» get «Разработчикам» → `/developers`; `sitemap.ts` gets the five routes; Dockerfile gets `COPY --from=prepare /app/docs/developers ./docs/developers` next to the existing docs COPY lines (cite: the turbo-prune gotcha comment block).
- [ ] **Step 4 — verify:** `pnpm --filter web lint && pnpm --filter web check-types && set -a && source .env && set +a && pnpm --filter web build` then `curl` the five routes against a dev server (RSC render sanity — anonymous, no redirect).
- [ ] **Step 5 — commit:**
```bash
git add apps/web/src/app/\(about\)/developers apps/web/src/components/developers apps/web/src/components/home/content.ts apps/web/src/app/sitemap.ts apps/web/Dockerfile
git commit -m "feat(web): /developers portal — five doc pages, sidebar shell, nav, seo, sitemap"
```

---

## Task 4: Contract tests (drift guards)

**Files:** Create `apps/web/test/developer-docs-contract.test.ts`.

- [ ] **Step 1 — TDD sanity:** write one deliberately-failing assertion first (e.g. expect a bogus header in webhooks.md), confirm red, remove it.
- [ ] **Step 2 — the suite** (node env; `fs.readFileSync` the five md files relative to the repo root — resolve via `path.join(__dirname, '../../../docs/developers')`):
  1. webhooks.md contains every `WEBHOOK_EVENT_TYPES` value and every `COMING_EVENT_TYPES` value (import from `@repo/webhooks`).
  2. webhooks.md contains every `WEBHOOK_DELIVERY_HEADERS` value; the strings `sha256=`, `whsec_` (via `WEBHOOK_SECRET_PREFIX`), the literal `` {timestamp}.{body} `` base-string spelling, `4096` (echo window const), the backoff/cap/threshold numbers derived from the exported constants (`60` s base → assert `60`, `30` min cap → assert `30 мин` or the number, threshold `10`), the cap `20`.
  3. telegram.md contains the `TELEGRAM_LIMITS` facts: `50`, `15 мин` (or `15`), code length `8`; the token format hint (`BotFather`); `X-Telegram-Bot-Api-Secret-Token` is NOT required (internal) — skip.
  4. api.md contains `ank_`, `Bearer`, all five TTL labels (`7d`,`30d`,`90d`,`1y`,`never` — import `API_KEY_TTL_OPTIONS`-equivalent from `packages/trpc/src/services/api-key.ts` if exported, else the router zod enum — read how it's defined and import/replicate), and the three 401 messages from the guard.
  5. Endpoint inventory: read `apps/engines/src/apps/api/rest/*.controller.ts` sources, extract routes via regex over `@Controller('...')` + `@Get('...')`/`@Post('...')` decorators, build full paths, assert EVERY one appears in api.md (normalize: `@Get()` with no arg = controller base). This is the new-endpoint-without-docs tripwire.
  6. Inverse spot check: every `/v1/...` path string mentioned in api.md exists in the extracted route set (catches typos/stale docs). Extract doc paths with a `/v1/[a-z/-]+` regex.
- [ ] **Step 3 — verify:** `pnpm --filter web test` green; `pnpm check-architecture` still clean (test-only imports of @repo/webhooks/@repo/telegram from apps/web — if the architecture check flags them, switch those asserts to fs-reads of the package source files instead and note it).
- [ ] **Step 4 — commit:**
```bash
git add apps/web/test/developer-docs-contract.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "test(web): developer docs contract suite — constants and endpoint inventory drift guards"
```
(package.json only if dev-deps were needed.)

---

## Task 5: E2E + product changelog

**Files:** Create `apps/e2e/developers.spec.ts`; Modify `docs/changelog.md`.

- [ ] **Step 1 — E2E** per spec §6 (templates `changelog.spec.ts` + `seo.spec.ts`, cookie-consent beforeEach): (1) five anonymous renders with h1 + content marker (`ank_` on /api, `X-AnyNote-Signature` on /webhooks, `BotFather` on /telegram, deprecation wording on /changelog); (2) header nav «Разработчикам» from `/` lands on /developers, sidebar click reaches /developers/webhooks; (3) internal-link audit: collect `a[href^="/"]` on the five pages, `request.get` each unique path expecting <400; (4) canonical + og:title on /developers, BreadcrumbList JSON-LD on a subpage.
- [ ] **Step 2 — product changelog** `docs/changelog.md` («Готовится», after the telegram block):
```md
**Портал для разработчиков**

- Публичная документация по REST API, вебхукам и интеграции с Телеграм: аутентификация по API-ключам, каталог событий, проверка подписи, политика версионирования и поддержки.
```
- [ ] **Step 3 — run:** `set -a; source .env; set +a; pnpm exec playwright test apps/e2e/developers.spec.ts --retries=2` → green (kill any stale port-3100 server first; if first navigation hangs on a fresh worktree, `rm -rf apps/web/.next` — known poisoned-cache failure mode).
- [ ] **Step 4 — commits:**
```bash
git add apps/e2e/developers.spec.ts && git commit -m "test(e2e): developer portal render, nav, link audit, seo"
git add docs/changelog.md && git commit -m "docs(changelog): developer portal"
```

---

## Completion

Single whole-branch review (spec + quality combined focus, this phase is docs-weight): (1) content fidelity — spot-check documented constants/shapes against source beyond what the contract tests pin (esp. DTO field tables and response examples); (2) the Task 1 refactor is behavior-neutral (headers byte-identical on the wire — webhook tests prove); (3) no (about) bundle pollution (no tRPC/client imports in the new pages); (4) nav/sitemap/Dockerfile wiring complete; (5) the contract tests actually fail on drift (mutate a constant locally, watch red, revert). Then fixes, full `pnpm gates` (env sourced), and the merge checkpoint — closes cl7.

## Self-review (at plan-writing time)

- Spec §2→T2 (content) + T3 (routes); §3→T2 api.md; §4→T3; §5→T1 (constants) + T4 (tests); §6→T5; §7 changelog→T5.
- Type consistency: `WEBHOOK_DELIVERY_HEADERS`/`WEBHOOK_SECRET_PREFIX`/limits exports defined in T1, consumed in T4; doc filenames in T2 match the imports in T3 and the fs-reads in T4/T5 markers.
- Known risks named in-task: check-architecture on test imports (T4 step 3 fallback), engines public hostname uncertainty (T2 overview), md-body styling reuse (T3 step 1).
