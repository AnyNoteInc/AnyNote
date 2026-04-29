---
status: approved
date: 2026-04-29
topic: workspace embedding model selection
---

# Workspace Embedding Model Selection — Design

## Goal

Add explicit per-workspace vectorization model selection. A workspace can choose
which embedding-capable AI model indexes its pages and powers RAG retrieval. If
no vectorization model is selected, page indexing is skipped and chat answers are
generated without Qdrant retrieval.

## Decisions

- Use one Qdrant collection per embedding model.
- Build collection names from stable machine slugs:
  `pages__{providerSlug}__{modelSlug}`.
- Add `AiModel.embeddings` and `AiModel.embeddingDimensions`.
- Add `WorkspaceAiSettings.embeddingsModelId`.
- Existing workspaces keep `embeddingsModelId = null` after migration.
- Seed embedding-capable models for Ollama and existing GigaChat models only:
  `nomic-embed-text`, `gigachat-2`, `gigachat-2-pro`, `gigachat-2-max`.
- Do not add OpenAI seed rows in this pass.
- Keep provider credentials in `AiProvider.connection`, matching the current
  chat model path.
- On vectorization model change/removal, fail the settings mutation if Qdrant
  cleanup through `apps/agents` fails.
- LLM generation continues when vectorization is not configured; only RAG search
  is skipped.

## Non-goals

- A production secret-management redesign for `AiProvider.connection`.
- A new indexing feature flag or a replacement for existing plan checks.
- Named-vector Qdrant collections.
- Background cleanup retry jobs for failed vectorization model changes.
- File, genogram, or excalidraw indexing.

## Data Model

Extend `AiModel`:

```prisma
model AiModel {
  embeddings          Boolean @default(false)
  embeddingDimensions Int?    @map("embedding_dimensions")
}
```

Extend `WorkspaceAiSettings`:

```prisma
model WorkspaceAiSettings {
  defaultModelId    String? @map("default_model_id") @db.Uuid
  embeddingsModelId String? @map("embeddings_model_id") @db.Uuid

  defaultModel    AiModel? @relation("WorkspaceDefaultAiModel", fields: [defaultModelId], references: [id], onDelete: SetNull)
  embeddingsModel AiModel? @relation("WorkspaceEmbeddingAiModel", fields: [embeddingsModelId], references: [id], onDelete: SetNull)
}
```

Because `WorkspaceAiSettings` will reference `AiModel` twice, both
`defaultModel` and `embeddingsModel` relations must use explicit relation names.
Application validation enforces that `embeddingDimensions` is present and
positive when `embeddings = true`.

The migration leaves existing `workspace_ai_settings.embeddings_model_id` empty.
Users enable vectorization explicitly from workspace settings.

## Settings API and UI

`packages/trpc/src/routers/ai-settings.ts` expands the settings contract:

- `get` returns `embeddingsModelId`.
- `update` accepts `embeddingsModelId?: string | null`.
- Embedding model selection validates active, non-deprecated, plan-available
  models where `embeddings = true`.
- Chat model selection must not accidentally accept embedding-only models unless
  that model is also valid for chat.

Model listing should expose separate capability filtering, either through
`listAvailableModels({ capability: 'chat' | 'embeddings' })` or a dedicated
`listAvailableEmbeddingModels` procedure. The UI should not filter by string
slug.

`/workspaces/{workspaceId}/settings/ai` adds a **Векторизация** section beside
the existing LLM settings. It contains a model select with a "Не выбрано" option
and helper text explaining that an empty selection disables indexing and RAG
retrieval for the workspace. A single save action persists LLM model, system
prompt, and vectorization model.

## Qdrant Collections

Collection names are deterministic:

```text
pages__{providerSlug}__{modelSlug}
```

The builder lowercases slugs and replaces unsupported characters with `_`.
Examples:

```text
pages__ollama__nomic-embed-text
pages__gigachat__gigachat-2
pages__gigachat__gigachat-2-pro
pages__gigachat__gigachat-2-max
```

Each collection uses the selected model's `embeddingDimensions`. This avoids
mixing vectors with incompatible dimensions and keeps deletion/search scoped to
the model currently configured for the workspace.

## Indexing Flow

`apps/engines` continues to drain the existing page outbox. Before calling
`apps/agents`, it reads `workspaceAiSettings.embeddingsModel` with provider
connection data.

This design does not add a new indexing feature flag and does not replace the
existing plan checks around indexing availability.

If `embeddingsModelId` is `null`, engines marks the outbox row done and does not
call agents. This is not an error.

If a model is configured, engines sends the selected embedding model config to
`POST /vectorization`:

```json
{
  "pageId": "0197b5fd-1111-7222-8333-123456789abc",
  "workspaceId": "0197b5fd-2222-7333-8444-123456789abc",
  "title": "Project notes",
  "pageType": "TEXT",
  "embeddingModel": {
    "provider": "gigachat",
    "name": "gigachat-2-pro",
    "dimensions": 1024,
    "connection": {
      "scope": "GIGACHAT_API_PERS"
    }
  },
  "contents": []
}
```

`apps/agents` uses that config to select an embedding adapter, ensure the target
collection exists, delete old vectors for the page in that collection, embed
chunks, and upsert points with the existing payload shape:
`pageId`, `workspaceId`, `title`, `pageType`, `blockNumber`, `content`.

## Vectorization Model Changes

`aiSettings.update` handles changes as follows:

1. Load the previous and requested embedding models.
2. If the previous model exists and the value changed, call agents to delete all
   vectors for the workspace from the previous model's collection.
3. If cleanup fails, abort the mutation and keep the old setting.
4. Save the new setting and enqueue `page.upserted` outbox rows for all live TEXT
   pages in the workspace in one database transaction.
5. If the new value is `null`, do not enqueue reindex rows.

`apps/agents` adds:

```http
POST /vectorization/delete-workspace
```

Request:

```json
{
  "workspaceId": "0197b5fd-2222-7333-8444-123456789abc",
  "embeddingModel": {
    "provider": "gigachat",
    "name": "gigachat-2-pro",
    "dimensions": 1024,
    "connection": {
      "scope": "GIGACHAT_API_PERS"
    }
  }
}
```

The endpoint deletes all Qdrant points matching `workspaceId` from the collection
derived from `embeddingModel`.

## Chat and RAG Flow

`apps/web` loads both `defaultModel` and `embeddingsModel` when starting
generation.

If `defaultModel` is missing, the current error behavior remains: chat generation
cannot start without an LLM.

If `embeddingsModel` is missing, web still calls `apps/agents /chat/generate`,
but the payload indicates that RAG is disabled. `GraphService.prepare_prompt`
skips `RagRetrievalService.retrieve`, and templates render no Retrieved context.

If `embeddingsModel` is present, web passes the embedding model config to agents.
`RagRetrievalService` embeds the query with the selected model, searches that
model's Qdrant collection with the existing `workspaceId` filter, dedupes results
by page/block, and renders the retrieved documents into the prompt.

RAG retrieval failures during chat generation are best-effort: log the failure
and continue with a normal LLM answer without retrieved context.

## Provider Support

The first seed update marks the current Ollama and GigaChat rows as
embedding-capable:

- `ollama / nomic-embed-text`
- `gigachat / gigachat-2`
- `gigachat / gigachat-2-pro`
- `gigachat / gigachat-2-max`

Each row must define `embeddingDimensions`. The exact values should be verified
against the installed provider clients and model documentation before
implementation.

OpenAI remains an architectural extension point but is not seeded or shown by
default in this pass.

## Testing

Focused coverage:

- Prisma schema generation and seed data for `embeddings` and
  `embeddingDimensions`.
- tRPC settings get/update, embedding model validation, cleanup failure
  behavior, and workspace TEXT-page reindex enqueue.
- AI settings UI renders the vectorization selector and posts
  `embeddingsModelId`.
- Web generation route allows LLM responses without vectorization and includes
  embedding model config when configured.
- Engines cron skips agents calls when `embeddingsModelId` is empty and sends
  model config when present.
- Agents collection-name builder, selected-model vectorization,
  delete-workspace endpoint, and RAG skip/search behavior.

Final verification should run targeted package tests first, then `pnpm gates`.
