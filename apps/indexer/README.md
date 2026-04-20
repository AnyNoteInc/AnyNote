# apps/indexer

AnyNote indexer worker. Drains the `outbox_events` table from the main
Postgres database, computes embeddings, and upserts points into Qdrant.

## Quick start (host)

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter indexer dev
curl http://localhost:8081/health
```

## Tests

```bash
pnpm --filter indexer test            # unit
pnpm --filter indexer test-int        # integration (needs infra)
```
