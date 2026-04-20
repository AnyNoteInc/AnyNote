# apps/indexer

AnyNote indexer worker. Drains the `outbox_events` table from the main
Postgres database, computes embeddings via Ollama (or OpenAI), and
upserts points into Qdrant for downstream RAG consumers.

## Quick start (host)

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter indexer dev
curl http://localhost:8081/health
```

`pnpm --filter indexer dev` runs the worker inside `uvicorn --reload`,
exposing FastAPI on port 8081. The health endpoint reports queue lag
and Qdrant reachability.

## Quick start (Compose worker profile)

```bash
docker compose --profile worker up -d indexer
docker compose logs -f indexer
```

The indexer service is gated by `profiles: ["worker"]` so plain
`docker compose up -d` does not start it. The container reads sane
defaults from the shell (with `${VAR:-default}` fallbacks) and reaches
`postgres` / `qdrant` / `ollama` via Compose-internal DNS.

## Tests

```bash
pnpm --filter indexer test            # unit (default)
pnpm --filter indexer test-int        # integration (needs infra)
```

Integration tests are marked `@pytest.mark.integration`; the unit run
deselects them. Integration suite requires Postgres, Qdrant, and Ollama
with `nomic-embed-text` pulled.

## Architecture

The worker is a single-purpose draining loop:

```
loop every INDEXER_POLL_INTERVAL_MS:
  rows = OutboxRepo.claim_batch()           # FOR UPDATE SKIP LOCKED
  for row in rows:
    try:
      handle(row)                            # dispatch by event_type
      OutboxRepo.mark_done(row.id)
    except Exception as exc:
      OutboxRepo.mark_failed_or_retry(row, str(exc))
```

Handlers:

- `page.upserted` — load Page from Postgres, walk Tiptap JSON to plain
  text, chunk (~500 tokens / 2000 chars), embed each chunk, upsert one
  Qdrant point per chunk. Deterministic point ids
  (`uuid5(NS, "{page_id}:{chunk_index}")`) make this idempotent.
- `page.deleted` — delete every Qdrant point matching the `page_id`
  payload filter (tombstone).
- `file.upserted` / `file.deleted` — no-ops in Pillar D (file content
  extraction lands in a follow-up pillar).

## Failure model

| Scenario | Behavior |
|---|---|
| Qdrant unreachable | `attempts++`, `next_attempt_at = now() + min(60s × 2^attempts, 30min)`, row stays PENDING |
| Embedding API error | same backoff |
| Page row missing (race with delete) | tombstone + ack DONE |
| `attempts >= INDEXER_MAX_ATTEMPTS` | mark FAILED, no further retries |
| Worker crash mid-row | `locked_at` ages out past `INDEXER_LOCK_TTL_MS`; row reclaimed by another tick |
| Worker crash post-Qdrant pre-ack | re-processed; Qdrant upsert is idempotent (deterministic point id) |

## Environment

See repo-root `.env.example` for the full list of `INDEXER_*` /
`EMBEDDINGS_*` / `OLLAMA_BASE_URL` / `OPENAI_API_KEY` variables.
