# AnyNote

AnyNote — Russian SaaS knowledge workspace: Notion-style markdown
editor, team collaboration, public sharing, and AI search built on top
of `apps/agents` + `apps/engines`.

## Apps

| App | Tech | Default port | Purpose |
|---|---|---|---|
| `apps/web` | Next.js 16 (App Router, RSC, MUI v6) | 3000 | The product UI |
| `apps/yjs` | Hocuspocus | 1234 | Realtime collaborative editor |
| `apps/agents` | FastAPI · LangGraph · Dishka | 8080 | LLM gateway with streaming + MCP tool-call loop |
| `apps/engines` | NestJS · @rekog/mcp-nest · @nestjs/schedule | 8082 | MCP server exposing workspace tools + vectorization cron |
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
docker compose up -d                          # postgres, minio, qdrant, ollama
docker compose exec -T ollama ollama pull qwen2.5:0.5b
docker compose exec -T ollama ollama pull nomic-embed-text   # for vectorization (engines + agents)
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
`apps/engines` cron drains the outbox and calls `POST /vectorization`
in `apps/agents`, which normalises + embeds via Ollama and writes points
to the `pages` Qdrant collection. `apps/engines` also serves those
results as MCP tools. `apps/agents` discovers tools at request-start
when `payload.mcp.servers[*].url` is provided (apps/web injects it via
`ENGINES_MCP_URL`).

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
- D — outbox + vectorization pipeline (`2026-04-19-pillar-d-indexing-pipeline-design.md`)
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
apps/        web · yjs · agents · engines · e2e
packages/    db · auth · trpc · ui · chat · editor · excalidraw · storage · eslint-config · typescript-config
docs/        superpowers/specs · superpowers/plans
docker/      postgres-init scripts
compose.yml  postgres · minio · qdrant · ollama
```

## RAG / vectorization setup

Vectorization runs as a cron in `apps/engines` that calls `POST /vectorization`
in `apps/agents`. Qdrant (`pages` collection, cosine, 768 dims) and Ollama
(`nomic-embed-text`) must be up before starting the services.

### Pre-flight checklist

1. `docker compose up -d` — brings up Postgres, Qdrant, Ollama.
2. `ollama pull nomic-embed-text` — pull the embedding model into your local Ollama.
3. `pnpm --filter @repo/db prisma:db-push` — apply schema if first run.
4. `pnpm --filter @repo/db prisma:seed` — seeds AI providers (GigaChat, Yandex, etc.).
5. `pnpm dev` — start web, yjs, engines, agents.

### Initial backfill

After the first deploy (or after changing the normalizer pipeline), re-enqueue
every TEXT page into the outbox so it gets indexed:

```bash
pnpm --filter engines backfill:reindex
```

The cron picks up events every 30 seconds in batches of 10 — a workspace with
1000 pages takes ~50 minutes. For faster backfill, temporarily bump cadence and
batch size via env:

```bash
INDEXER_CRON_EXPRESSION="*/5 * * * * *" INDEXER_BATCH=50 pnpm --filter engines dev
```

### Rollback (if /vectorization or Qdrant is broken)

Disable the cron by setting an invalid schedule:

```bash
INDEXER_CRON_EXPRESSION="0 0 31 2 *" pnpm --filter engines dev
```

Drop the `pages` collection if needed:

```bash
curl -X DELETE http://localhost:6333/collections/pages
```

`apps/agents` will recreate it on next startup.
