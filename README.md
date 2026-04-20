# AnyNote

AnyNote — Russian SaaS knowledge workspace: Notion-style markdown
editor, team collaboration, public sharing, and AI search built on top
of `apps/agents` + `apps/engines` + `apps/indexer`.

## Apps

| App | Tech | Default port | Purpose |
|---|---|---|---|
| `apps/web` | Next.js 16 (App Router, RSC, MUI v6) | 3000 | The product UI |
| `apps/yjs` | Hocuspocus | 1234 | Realtime collaborative editor |
| `apps/agents` | FastAPI · LangGraph · Dishka | 8080 | LLM gateway with streaming + MCP tool-call loop |
| `apps/engines` | FastAPI · FastMCP · Dishka | 8082 | MCP server exposing workspace tools (search, page lookup) |
| `apps/indexer` | FastAPI · asyncpg · Qdrant | 8081 | Drains the transactional outbox into Qdrant |
| `apps/e2e` | Playwright | — | E2E smoke tests |

## Packages

`packages/db` (Prisma 7 client + migrations + seed) ·
`packages/auth` (better-auth) ·
`packages/trpc` (typed API) ·
`packages/ui` (MUI design system) ·
`packages/chat` (chat UI) ·
`packages/editor` + `packages/excalidraw` (page renderers) ·
`packages/storage` (S3/MinIO).

## Quick start

```bash
docker compose up -d                          # postgres, minio, qdrant, ollama, redis
docker compose exec -T ollama ollama pull qwen2.5:0.5b
docker compose exec -T ollama ollama pull nomic-embed-text   # for indexer + engines
cp .env.example .env                          # adjust secrets
pnpm install
pnpm --filter @repo/db prisma:generate
pnpm --filter @repo/db exec prisma migrate dev
pnpm dev                                      # all apps in parallel
```

Open http://localhost:3000. Sign up. Create a workspace. In **Settings → AI агент**
pick a model. Open **/workspaces/[id]/chats** and start a conversation.

## End-to-end AI loop

```
[browser]
   └─ /workspaces/<id>/chat/<chatId>
        └─ POST /api/agents/generate { chatId, prompt, history }
              └─ apps/agents POST /api/v1/generate (SSE)
                   └─ LangGraph: prepare_prompt → llm
                                              ⤷ tools (MCP) → llm → … → END
                       └─ MCP: apps/engines /mcp (search_workspace_pages,
                              get_page, list_workspace_pages)
                              └─ Qdrant + Postgres
```

Page mutations in `apps/web` enqueue rows to `outbox_events`.
`apps/indexer` drains the outbox, embeds via Ollama, writes points
to the `anynote-pages` Qdrant collection. `apps/engines` reads from
the same collection and serves tools via MCP. `apps/agents` discovers
those tools at request-start when `payload.mcp.servers[*].url` is
provided (apps/web injects it via `ENGINES_MCP_URL`).

## Gates

```bash
pnpm gates                # check-types + lint + build + test, all workspaces
pnpm check-types
pnpm lint
pnpm build
pnpm test
```

Per-package:

```bash
pnpm --filter @repo/chat test
pnpm --filter agents test
pnpm --filter indexer test            # unit
pnpm --filter indexer test-int        # integration (requires infra)
pnpm --filter engines test
```

Playwright:

```bash
pnpm exec playwright test                       # repo-root config
pnpm exec playwright test apps/e2e/auth.spec.ts # one spec
```

## Architecture docs

Designs live in `docs/superpowers/specs/` and implementation plans in
`docs/superpowers/plans/`. The latest pillars:

- A — DB foundation (`2026-04-19-db-foundation-design.md`)
- B1 — `apps/agents` MVP (`2026-04-19-apps-agents-mvp-design.md`)
- C — `packages/chat`
- D — outbox + Qdrant indexer (`2026-04-19-pillar-d-indexing-pipeline-design.md`)
- E — `apps/engines` MCP server
- F-mini / F2 — workspace AI settings (model picker, API keys, skills)
- B2 — MCP tool-calling loop in agents

## Conventions

See `CLAUDE.md` for the full list. Highlights:

- MUI imported only via `@repo/ui/components` / `@repo/ui/widgets`.
- Next 16 RSC ↔ Client boundary: never pass functions across.
  `<Button component={Link}>` in a Server Component breaks prerender.
- Prisma migrations live in `packages/db/prisma/migrations/`.
  `prisma migrate dev --name X` is the working command.
- Conventional Commits (`feat`, `fix`, `chore`, `docs`, `refactor`,
  `test`) with a scope.

## Repo layout

```
apps/        web · yjs · agents · indexer · engines · e2e
packages/    db · auth · trpc · ui · chat · editor · excalidraw · storage · eslint-config · typescript-config
docs/        superpowers/specs · superpowers/plans
docker/      postgres-init scripts
compose.yml  postgres · minio · qdrant · ollama · redis · indexer (worker profile)
```
