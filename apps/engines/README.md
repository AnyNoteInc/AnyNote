# apps/engines

AnyNote engines service — exposes workspace tools (Qdrant search, page
lookup) via the Model Context Protocol so `apps/agents` can call them
during tool-augmented generation.

## Tools

- `search_workspace_pages(query, workspace_id, top_k=5)` — semantic
  search over the indexer's Qdrant collection.
- `get_page(page_id, workspace_id?)` — full page text (Tiptap walked
  to plain text).
- `list_workspace_pages(workspace_id, limit=20)` — recent pages.

## Quick start

```bash
docker compose up -d postgres qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter engines dev
curl http://localhost:8082/health
```

The MCP endpoint is mounted at `/mcp` and requires
`Authorization: Bearer ${ENGINES_MCP_TOKEN}`.

## Tests

```bash
pnpm --filter engines test            # unit
pnpm --filter engines test-int        # integration
```
