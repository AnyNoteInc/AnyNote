# Public API + MCP Gateway — Design

**Status:** Approved, ready for implementation plan
**Date:** 2026-05-27
**Scope:** Expose `apps/engines` as a public HTTP+MCP API at `api.anynote.ru`, with user-issued Bearer API keys and `workspaceId` moved from headers to tool parameters.

## Goal

Allow external MCP clients (Cursor, Claude Desktop, mcp-inspector) and arbitrary HTTP clients to use anynote tools (search pages, create pages, etc.) by minting an API key in user settings and calling `https://api.anynote.ru/mcp` or `https://api.anynote.ru/v1/*`.

## Non-goals

- OAuth 2.1 / PKCE flow (MCP spec 2025-11) — defer; Bearer API key is the MVP.
- Per-workspace keys — keys are user-level; workspace selected per request.
- Rate-limiting per key — defer; Traefik/Cloudflare provides global protection.
- Removing the `wsid` JWT-claim contract between `apps/web` and `apps/agents` — internal contract stays.
- Block-level or page-content REST endpoints beyond what MCP tools already provide.

## Architecture overview

```
External MCP client                Browser
Authorization: Bearer ank_…        session cookie
       │                               │
       ▼                               ▼
┌──────────────────────────────────────────────┐
│ Traefik                                      │
│   anynote.ru → web                           │
│   api.anynote.ru → engines    ← NEW          │
│   yjs.anynote.ru → yjs                       │
└──────────────────────────────────────────────┘
       │                               │
       ▼                               ▼
   engines:8082                    web:3000
   ┌─────────────────┐             ┌─────────────────┐
   │ /docs   Swagger │             │ /settings/api   │
   │ /v1/*   REST    │             │   apiKey.list   │
   │ /mcp    JSON-RPC│             │   apiKey.create │
   │ /healthz /v1/meta             │   apiKey.revoke │
   │ /internal/*     │  ← agents,  └─────────────────┘
   └─────────────────┘    indexer-test (docker-net only)
```

Internal flow `apps/agents → engines` continues over the docker network (does **not** transit Traefik). The only change for the internal path is that `X-Agents-Workspace` is removed; `workspaceId` becomes a tool argument.

`engines` loses its `/api` global prefix — the host *is* the API.

## Data model

New Prisma model in [packages/db/prisma/schema.prisma](packages/db/prisma/schema.prisma):

```prisma
model ApiKey {
  id          String    @id @default(uuid(7))
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  name        String                  // user-given label
  keyHash     String    @unique       // sha256(fullKey)
  keyPrefix   String                  // first 8 chars after ank_
  keyLastFour String                  // last 4 chars

  expiresAt   DateTime?               // null = never expires
  lastUsedAt  DateTime?               // throttled write, max once per 60s
  createdAt   DateTime  @default(now())
  revokedAt   DateTime?               // soft delete

  @@index([userId])
  @@index([keyHash])
}
```

Add `apiKeys ApiKey[]` to the `User` model.

Migration name: `add_api_key_model`.

### Key format

- Body: `crypto.randomBytes(18)` → base62-encoded → 24 chars.
- Full key: `ank_<body>` (27 chars total).
- Entropy: 24 × log2(62) ≈ 143 bits.
- Hash: SHA-256 of the full key, stored as hex.
- `keyPrefix`: `body.slice(0, 8)`.
- `keyLastFour`: `body.slice(-4)`.
- UI display: `ank_<prefix>…<lastFour>` (e.g., `ank_AbCd1234…wXyZ`).

### Why SHA-256 (not bcrypt)

API keys have 143 bits of system-generated entropy — brute force is computationally infeasible. SHA-256 enables O(1) lookup via the `keyHash` unique index; bcrypt would require scanning all rows on every auth.

## tRPC: `apiKey` router

New file: [packages/trpc/src/routers/api-key.ts](packages/trpc/src/routers/api-key.ts). Helper: [packages/trpc/src/services/api-key.ts](packages/trpc/src/services/api-key.ts) for key generation. Registered as `apiKey` in `appRouter` ([packages/trpc/src/index.ts](packages/trpc/src/index.ts)).

```ts
apiKey: router({
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.apiKey.findMany({
      where: { userId: ctx.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, keyPrefix: true, keyLastFour: true,
        createdAt: true, expiresAt: true, lastUsedAt: true,
      },
    })
  ),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      ttl: z.enum(['7d', '30d', '90d', '1y', 'never']),
    }))
    .mutation(async ({ ctx, input }) => {
      const { fullKey, prefix, lastFour, hash } = generateApiKey()
      const expiresAt = input.ttl === 'never' ? null : addTtl(new Date(), input.ttl)
      const row = await ctx.prisma.apiKey.create({
        data: {
          userId: ctx.user.id, name: input.name,
          keyHash: hash, keyPrefix: prefix, keyLastFour: lastFour,
          expiresAt,
        },
        select: { id: true, name: true, keyPrefix: true,
                  keyLastFour: true, createdAt: true, expiresAt: true },
      })
      return { ...row, fullKey }     // fullKey shown ONCE; never again
    }),

  revoke: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const r = await ctx.prisma.apiKey.updateMany({
        where: { id: input.id, userId: ctx.user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
      if (r.count === 0) throw new TRPCError({ code: 'NOT_FOUND' })
      return { ok: true }
    }),
})
```

`addTtl` maps `'7d'|'30d'|'90d'|'1y'` to `Date` via `date-fns`. `'never'` → `null`.

## UI: `/settings/api`

- New page: [apps/web/src/app/(protected)/settings/api/page.tsx](apps/web/src/app/(protected)/settings/api/page.tsx) — RSC, fetches keys via `getServerTRPC()`, renders client section with `initialKeys`.
- New component: [apps/web/src/components/settings/api-keys-section.tsx](apps/web/src/components/settings/api-keys-section.tsx) — client component using `trpc.apiKey.*` mutations + `useQuery` with `initialData`.
- Add `{ slug: 'api', label: 'API-ключи' }` to the items array in [apps/web/src/components/settings/settings-nav.tsx](apps/web/src/components/settings/settings-nav.tsx).

Layout (one `SettingsCard`, matches May 2026 unified-card pattern):

- Title "API-ключи" + description sentence with the api endpoint URL.
- `[+ Создать ключ]` button (top-right).
- Table: Name · Token (`ank_prefix…lastFour`) · Created · Expires · Last used · Revoke icon.
- Empty state: "Список пуст — создайте первый ключ."
- Collapsible "Как подключить" block under the table with `claude_desktop_config.json` snippet using `NEXT_PUBLIC_API_BASE_URL`.

### Create flow

1. Click `+ Создать ключ` → MUI Dialog: Name input + TTL radio (7d / 30d / 90d / 1y / never).
2. Submit → `apiKey.create` → response contains `fullKey`.
3. Replace dialog content with one-time-reveal modal: full key in monospace box + Copy button + warning "Скопируйте сейчас — он больше не появится."
4. On close: `fullKey` discarded from memory; React Query invalidates list.

### Revoke flow

Icon click → `ConfirmDialog` ("Отозвать ключ Cursor laptop?") → `apiKey.revoke` → list refetches; revoked keys disappear (we filter `revokedAt: null` in `list`).

## Engines: structure changes

New module `apps/engines/src/apps/api/`:

```
apps/engines/src/apps/api/
├── api.module.ts
├── auth/
│   ├── api-key.guard.ts
│   ├── mcp-auth.guard.ts            ← combinator: api-key OR agents-internal
│   └── auth-context.ts              ← typed req.auth interface
├── tools/                            ← @Injectable() shared services
│   ├── pages.service.ts
│   ├── pages-files.service.ts
│   ├── workspace.service.ts
│   ├── search.service.ts
│   └── workspaces.service.ts        ← NEW (list_workspaces)
├── rest/                             ← REST controllers
│   ├── pages.controller.ts          (Controller('v1/pages'))
│   ├── pages-files.controller.ts
│   ├── workspaces.controller.ts
│   └── search.controller.ts
├── mcp/                              ← rekog @Tool() adapters
│   ├── pages.mcp.ts
│   ├── pages-files.mcp.ts
│   ├── workspace.mcp.ts
│   ├── search.mcp.ts
│   └── workspaces.mcp.ts
└── dto/                              ← class-validator DTOs
    ├── search-pages.dto.ts
    └── …                             (one per REST endpoint)
```

The existing [apps/engines/src/apps/mcp/](apps/engines/src/apps/mcp/) directory is simplified: keeps only rekog bootstrap + shared context plumbing. Tool logic moves out to `api/tools/`. The old `McpTokenGuard` is deleted (membership check moves into each service; auth check moves into `McpAuthGuard`).

### main.ts changes

[apps/engines/src/main.ts](apps/engines/src/main.ts):

- Remove `app.setGlobalPrefix('api')`.
- `SwaggerModule.setup('docs', app, doc, { swaggerOptions: { persistAuthorization: true } })`.
- Bearer security scheme registered on Swagger doc.
- CORS: `*` for `/v1/*` and `/mcp`; standard for `/internal/*` (docker network only — Traefik won't route to it anyway).
- New routes: `GET /healthz` (no guard) and `GET /v1/meta` (no guard, returns `{ version, mcpEndpoint, docs }`).
- Existing `IndexerController` route moves to `/internal/indexer/*` (still gated by `PlaywrightGuard`).

### `ApiKeyGuard`

```ts
@Injectable()
export class ApiKeyGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>()
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException()
    const token = auth.slice(7)
    if (!token.startsWith('ank_')) return false  // not ours; let combinator try next

    const hash = createHash('sha256').update(token).digest('hex')
    const key = await this.prisma.apiKey.findUnique({ where: { keyHash: hash } })
    if (!key || key.revokedAt) throw new UnauthorizedException('Key revoked')
    if (key.expiresAt && key.expiresAt < new Date())
      throw new UnauthorizedException('Key expired')

    req.auth = { userId: key.userId, apiKeyId: key.id, source: 'api-key' }
    this.touchLastUsed(key.id, key.lastUsedAt)   // fire-and-forget, throttled
    return true
  }

  private touchLastUsed(id: string, prev: Date | null) {
    if (prev && Date.now() - prev.getTime() < 60_000) return
    this.prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch(() => {/* swallow */})
  }
}
```

### `McpAuthGuard` (combinator)

```ts
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeyGuard: ApiKeyGuard,
    private readonly internalGuard: AgentsInternalAuthGuard,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest()
    const auth = req.headers.authorization as string | undefined
    if (auth?.startsWith('Bearer ank_')) return this.apiKeyGuard.canActivate(ctx)
    return this.internalGuard.canActivate(ctx)
  }
}
```

Applied via `@UseGuards(McpAuthGuard)` on REST controllers and the rekog MCP entry point. `/docs`, `/healthz`, `/v1/meta`, `/internal/*` are excluded.

### Tool services pattern

Each tool method takes `(auth, args)`. Membership is asserted first:

```ts
@Injectable()
export class PagesService {
  constructor(private readonly prisma: PrismaService) {}

  async search(auth: AuthContext, args: SearchPagesArgs): Promise<SearchPagesResult> {
    await assertMember(this.prisma, auth.userId, args.workspaceId)
    // … existing search logic, scoped to args.workspaceId
  }
}

async function assertMember(prisma: PrismaService, userId: string, workspaceId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { workspaceId: true },
  })
  if (!m) throw new ForbiddenException('No access to workspace')
}
```

### REST controller + MCP adapter pattern

REST:

```ts
@Controller('v1/pages')
@ApiTags('pages')
@ApiBearerAuth()
@UseGuards(McpAuthGuard)
export class PagesController {
  constructor(private readonly pages: PagesService) {}

  @Post('search')
  @ApiOperation({ summary: 'Search pages by query in a workspace' })
  @ApiOkResponse({ type: SearchPagesResultDto })
  search(@Body() body: SearchPagesDto, @Req() req: AuthedRequest) {
    return this.pages.search(req.auth, body)
  }
}
```

MCP (rekog adapter):

```ts
@Injectable()
export class PagesMcp {
  constructor(private readonly pages: PagesService) {}

  @Tool({
    name: 'search_pages',
    description: 'Search pages in a workspace…',
    parameters: searchPagesSchema,        // Zod schema
  })
  search(args: SearchPagesArgs, ctx: McpToolContext) {
    return this.pages.search(ctx.auth, args)
  }
}
```

`ctx.auth` is populated by `McpAuthGuard` via NestJS request scope; rekog proxies the http request into the tool context.

## workspaceId migration (header → tool args)

### Tools to update

All 12 existing tools gain a required `workspaceId: z.string().uuid()` parameter:

| File | Tools |
|---|---|
| `pages.mcp.ts` / `pages.service.ts` | createPage, updatePage, movePage, getPageMarkdown, getPageStats |
| `pages-files.mcp.ts` / `pages-files.service.ts` | uploadFileToPage, uploadImageToPage, attachFileToPage, attachImageToPage, listPageFiles |
| `workspace.mcp.ts` / `workspace.service.ts` | getWorkspaceStats, listWorkspaceFiles, listSkills, listAgents, createPageFromFile |
| `search.mcp.ts` / `search.service.ts` | search_pages |

### New tool: `list_workspaces`

- No `workspaceId` arg (the only such tool).
- Returns `[{ id, name, slug, role }]` for every workspace where `auth.userId` is a `WorkspaceMember`.
- REST mirror: `GET /v1/workspaces`.

### apps/agents changes

[apps/agents/agents/apps/agent/repositories/mcp_client.py](apps/agents/agents/apps/agent/repositories/mcp_client.py):

- Remove `X-Agents-Workspace` header from outgoing requests.
- `X-Agents-User` header stays — it identifies the user for `AgentsInternalAuthGuard`.

LangGraph integration: a middleware (or pre-tool-call hook) injects `workspace_id` into the args of every tool call before sending to engines. Source of truth: JWT claim `claims['wsid']` (unchanged contract between web and agents). The LLM is **not** asked to provide `workspace_id` — it is auto-injected, so the model cannot hallucinate it. Tool schemas exposed to the LLM mark `workspace_id` as auto-supplied (description note + Pydantic default coming from middleware).

### Cutover

No backward-compat fallback. Engines + agents change atomically in the same release. Justification: both deploy from the monorepo together; the window of incompatibility is on the order of seconds. A fallback would add code that has to be removed later.

## Traefik

Edit [deploy/traefik/dynamic/routers.yml](deploy/traefik/dynamic/routers.yml):

```yaml
http:
  routers:
    api:
      rule: "Host(`api.anynote.ru`)"
      entryPoints: [websecure]
      service: engines
      tls:
        certResolver: letsencrypt
      middlewares:
        - secureHeaders            # existing middleware reused

  services:
    engines:
      loadBalancer:
        servers:
          - url: "http://engines:8082"
        passHostHeader: true
```

The `engines` service is already on the internal docker network; no compose changes needed beyond ensuring it's on the same network as Traefik (verify in [compose.yml](compose.yml)).

## Environment variables

Add to [.env.example](.env.example) and the `globalEnv` list in [turbo.json](turbo.json):

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `apps/web` | Used in `/settings/api` "Как подключить" block. Defaults to `https://api.anynote.ru` in prod, `http://localhost:8082` in dev. |

No new secrets — API key hashes live in the DB.

## Public-facing docs in Swagger

Top-of-doc description block:

> **anynote API.** Authentication: `Authorization: Bearer ank_<your_key>`. Generate keys at `https://anynote.ru/settings/api`.
>
> Also available as an MCP server at `https://api.anynote.ru/mcp` (JSON-RPC, MCP 2025-11 spec, Bearer auth). See `/v1/meta` for server metadata.

## Health & meta endpoints

- `GET /healthz` — `{ status: 'ok' }`; no auth.
- `GET /v1/meta` — `{ version, mcpEndpoint: '/mcp', docs: '/docs' }`; no auth.

`/v1/meta` is exposed without auth so discovery scripts and Cursor-style configurators can verify the endpoint is alive without minting a key.

## Testing

| Layer | Test | File |
|---|---|---|
| Key crypto | unit: format, length, hash determinism | `packages/trpc/test/api-key-helpers.test.ts` |
| `apiKey.*` tRPC | integration: create / list / revoke / re-create-after-revoke / TTL math | `packages/trpc/test/api-key-router.test.ts` |
| `ApiKeyGuard` | integration: valid / revoked / expired / not-our-prefix / hash mismatch | `apps/engines/test/api-key.guard.spec.ts` |
| `assertMember` | unit per service: member→ok, non-member→ForbiddenException | per-service spec files |
| `list_workspaces` | integration: returns only user's workspaces with roles | `apps/engines/test/api/workspaces.service.spec.ts` |
| `/settings/api` UI | E2E: create → see full key once → revoke → empty | `apps/e2e/settings-api-keys.spec.ts` |
| Public API end-to-end | E2E: create key via UI → POST `/v1/pages/search` with Bearer → 200 | `apps/e2e/public-api.spec.ts` |
| workspaceId migration | unit/integration: tools work with args.workspaceId; refuse if missing | per-service spec files |

`pnpm gates` must be green before merge. E2E suite runs in CI as separate step.

## Security notes

- Logs never contain the full token — only `keyPrefix` (8 chars after `ank_`).
- `ank_` prefix is documented so secret-scanners (GitGuardian, TruffleHog) can recognize the format.
- Hash comparison is constant-time? No — we look up by hash equality. Acceptable because hashes are 256 bits; no timing channel to exploit.
- No per-key rate-limit at MVP; relying on Traefik / Cloudflare for global protection. Add per-key limit later if abuse is observed.
- Revocation is immediate (next request fails on guard); no token cache.

## Operations (action items outside code)

1. DNS: add `api.anynote.ru` A/AAAA record pointing to the Traefik host.
2. Letsencrypt: existing resolver provisions cert automatically on first request.
3. Cloudflare or other CDN sitting in front of Traefik: verify SSE/streaming works for `/mcp` (rekog transport). Likely fine since it's plain HTTP POST.

## Acceptance criteria

- `https://api.anynote.ru/docs` renders Swagger with a Bearer-authorize button and lists every `/v1/*` REST endpoint.
- `https://api.anynote.ru/mcp` responds to MCP `tools/list` with the full tool catalog including `list_workspaces`.
- `/settings/api` allows: creating a named key with TTL, copying the full key once, listing existing keys, revoking. Revoked keys do not appear in the list.
- A revoked key fails with `401` on the next API call (no caching).
- An expired key fails with `401` after `expiresAt`.
- A tool call with a `workspaceId` for which the user is not a member fails with `403`.
- `list_workspaces` returns exactly the workspaces the user is a member of.
- `apps/agents` no longer sends `X-Agents-Workspace`; all tool calls include `workspace_id` in args.
- `pnpm gates` green on the feature branch.

## Out of scope (explicit)

- Multi-tenant SaaS API for third parties (different scope, different auth, billing).
- OAuth 2.1 PKCE — defer until publicly listing the MCP catalog warrants it.
- Per-workspace API keys.
- Rate-limiting per key.
- Audit log of API key actions (create/revoke/use). Could be added later via existing logging infra.
- Removing `wsid` from the internal `apps/web → apps/agents` JWT contract.

## Open dependencies

- `@nestjs/swagger` is already installed and partially used; verify all needed DTO decorators (`@ApiProperty`, etc.) are available.
- `@rekog/mcp-nest` exposes per-tool context — confirm it surfaces `req.auth` from the guard. If not, add a small adapter in `McpAuthGuard` that stuffs auth into rekog's context.
- DNS + cert provisioning for `api.anynote.ru` — DevOps action item, not blocking code.
