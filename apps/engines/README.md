# apps/engines

AnyNote engines service — NestJS backend that unifies:

1. **Indexer** — cron-based reconciler + BullMQ consumer that indexes
   `TEXT`/`TEXT` pages into Qdrant.
2. **MCP server** — Model Context Protocol endpoint exposing 15 tools for
   pages, files, skills, agents, and workspace statistics, consumed by
   `apps/agents` during tool-augmented generation.

## Prerequisites

- `docker compose up -d postgres redis qdrant ollama`
- `docker compose exec -T ollama ollama pull nomic-embed-text`
- `apps/agents` running on `http://localhost:8080` (provides
  `/processing/normalize` used by the indexer).

## Quick start

```bash
pnpm install
pnpm --filter engines dev
curl http://localhost:8082/health
```

The MCP endpoint is mounted at `POST /mcp`, protected by
`Authorization: Bearer $ENGINES_MCP_TOKEN`.

## Env variables

See repo root `.env.example`. Key knobs:

- `ENGINES_PORT` — default 8082
- `ENGINES_MCP_TOKEN` — shared secret with `apps/agents`
- `PROCESSING_SERVICE_URL` — `apps/agents` base URL (default `http://localhost:8080`)
- `INDEXER_QUIET_PERIOD_MINUTES` — wait this long after last edit before
  enqueueing (default 5)
- `INDEXER_CRON_EXPRESSION` — reconciler schedule (default `0 */5 * * * *`, i.e. every 5 minutes)
- `UPLOAD_INLINE_MAX_BYTES` — base64-upload ceiling (default 1 MiB)

## Tests

```bash
pnpm --filter engines test            # unit
pnpm --filter engines test-int        # integration (requires docker compose up)
```
