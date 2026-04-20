# apps/engines NestJS Unification Design

## Context

Сегодня индексация страниц и MCP-сервер для агентов живут в двух отдельных Python-сервисах:

- `apps/engines` (FastAPI) — MCP-сервер на FastMCP. Три read-only тула над Qdrant/Prisma.
- `apps/indexer` (FastAPI) — воркер outbox → chunker → Ollama → Qdrant.

Этот дизайн сливает оба сервиса в один NestJS-бэкенд — новый `apps/engines`. Одновременно в `apps/agents` (Python-чат-сервис) добавляется отдельный HTTP-модуль нормализации текста, поскольку full-NLP pipeline (лемматизация, stopwords) надёжно реализуется только в Python, а тащить `pymystem3`/`spaCy` в Node — высокорисково.

Ответы пользователя на ключевые вопросы брейншторма:

1. **Источник outbox-событий:** event-driven из `apps/web` сохраняется, cron в `apps/engines` работает как safety-net.
2. **Авторизация в MCP:** shared-secret для транспорта + явные `userId`/`workspaceId` в аргументах тулов + Prisma-проверка членства через `WorkspaceMember`.
3. **Лемматизация/stopwords:** отдельный Python-модуль `apps/agents/apps/processing`, в который `apps/engines` ходит по HTTP перед векторизацией.
4. **Upload файлов в MCP:** гибрид — inline base64 до 1 MB + attach-by-id для больших (предполагается, что файл загружен через `apps/web`).
5. **Skills/Agents:** страницы с `ownership='SKILL'`/`'AGENT'`. Отдельных моделей нет.
6. **Embeddings:** Ollama `nomic-embed-text` остаётся, вызов прямой из NestJS.
7. **Старые Python-сервисы:** `apps/engines/engines` (Python) и `apps/indexer` целиком удаляются в рамках этой работы.

## Goals

- Один NestJS-сервис `apps/engines` с двумя модулями: `indexer` и `mcp`.
- Полный MCP-тулсет из 15 операций над workspace, страницами и файлами.
- Cron-based reconciliation индексации (раз в минуту) поверх существующего event-driven outbox.
- Единая точка NLP-нормализации в `apps/agents/apps/processing`.
- Сохранить совместимость с `apps/web` (`ENGINES_MCP_URL`) и `apps/agents` (MCP-клиент на порт 8082).

## Non-Goals

- Индексация файлов (`file.upserted` events). Остаётся out-of-scope — индексируются только страницы.
- Замена embeddings-провайдера. `nomic-embed-text` на Ollama — как сейчас.
- UI-работы в `apps/web`.
- Realtime / Yjs-интеграция в MCP. `updatePage` перезаписывает `Page.content`, коллаборативное согласование с Yjs — отдельный спринт.

## Target Layout

```
apps/engines/              ← NestJS (целиком новое содержимое)
  src/
    main.ts
    app.module.ts
    apps/
      indexer/
        indexer.module.ts
        cron/
          outbox-cron.service.ts
          outbox-drainer.service.ts
        queue/
          indexing.processor.ts
        services/
          page-chunker.service.ts
          processing-client.service.ts
          embedding-client.service.ts
          qdrant-writer.service.ts
      mcp/
        mcp.module.ts
        guards/
          mcp-token.guard.ts
          workspace-member.guard.ts
        tools/
          page.tools.ts
          page-file.tools.ts
          workspace.tools.ts
        services/
          page-writer.service.ts
          markdown-renderer.service.ts
          file-uploader.service.ts
          stats.service.ts
        errors/
          mcp.errors.ts
    infra/
      db/
        db.module.ts
        db.providers.ts          ← DI-провайдер, отдающий singleton prisma из @repo/db
      qdrant/
        qdrant.module.ts
        qdrant.service.ts
      ollama/
        ollama.module.ts
        ollama.service.ts
  test/
    unit/
    integration/
  package.json
  tsconfig.json
  nest-cli.json
  Dockerfile
  Makefile
  README.md

apps/agents/agents/apps/
  chat/                    ← существующий
  processing/              ← НОВЫЙ
    __init__.py
    router.py
    depends.py
    errors.py
    schemas.py
    services/
      __init__.py
      normalizer.py
      language_detector.py

apps/indexer/              ← УДАЛЯЕТСЯ целиком
apps/engines/engines/      ← УДАЛЯЕТСЯ (Python-содержимое перезаписывается NestJS-структурой)
```

## Data Flow

### 1. Индексация страницы (два источника, одна очередь)

```
apps/web (tRPC write) ──enqueueOutboxEvent──▶ outbox_events (PENDING)
                                                       │
apps/engines cron ──scan pages──▶ outbox_events (UPSERT)
                                                       │
                                                       ▼
                        OutboxDrainerService (каждые 5с)
                                                       │
                                                       ▼
                        BullMQ queue 'indexing' (Redis)
                                                       │
                                                       ▼
                        IndexingProcessor
                             │
                             ├──▶ Qdrant.delete(filter: pageId)
                             ├──▶ Page.content → first-level chunks (PageChunker)
                             ├──▶ POST /processing/normalize (на каждый chunk)
                             ├──▶ POST Ollama /api/embeddings
                             ├──▶ Qdrant.upsert(points)
                             └──▶ outbox_events (DONE)
```

### 2. MCP-вызов

```
apps/agents LangGraph ──MCP HTTP──▶ apps/engines /mcp (Bearer ENGINES_MCP_TOKEN)
                                             │
                                             ▼
                                    McpTokenGuard (401)
                                             │
                                             ▼
                                    WorkspaceMemberGuard (403)
                                             │
                                             ▼
                                    Tool handler ──▶ Prisma / S3 / Qdrant
```

## Indexer Module

### OutboxCronService

- `@Cron(INDEXER_CRON_EXPRESSION)` (по умолчанию `*/1 * * * *`).
- Запрос: `prisma.page.findMany({ where: { type: 'TEXT', ownership: 'TEXT', deletedAt: null, updatedAt: { lt: sub(now, INDEXER_QUIET_PERIOD_MINUTES * 60 * 1000) } }, select: { id: true, workspaceId: true }, take: 500 })`.
- Для каждой страницы — INSERT в `outbox_events` с `ON CONFLICT DO NOTHING`. Работает благодаря partial unique index (см. миграцию БД).
- Не пишет в BullMQ напрямую — дренаж делает `OutboxDrainerService`.

### OutboxDrainerService

- Запускается каждые `INDEXER_DRAINER_INTERVAL_MS` (5000 ms по умолчанию).
- Внутри одной транзакции:
  ```sql
  SELECT * FROM outbox_events
  WHERE event_type = 'page.upserted'
    AND aggregate_type = 'page'
    AND status = 'PENDING'
    AND next_attempt_at <= now()
  ORDER BY next_attempt_at
  LIMIT INDEXER_DRAINER_BATCH
  FOR UPDATE SKIP LOCKED
  ```
- Для каждой строки: `indexingQueue.add('index-page', { outboxId, pageId, workspaceId })`, затем `UPDATE outbox_events SET status='PROCESSING', locked_at=now(), locked_by='engines-<hostname>'`.

### IndexingProcessor (`@Processor('indexing')`)

Алгоритм обработки одной задачи:

1. `prisma.page.findUnique({ where: { id: pageId } })`.
2. `qdrantWriter.deleteByPageId(pageId)` — всегда, даже если страница удалена или больше не подходит под условия (очистка остатков).
3. Если `page == null` / `page.deletedAt != null` / `page.type != 'TEXT'` / `page.ownership != 'TEXT'` / `page.content` пустой → mark outbox `DONE`, return.
4. `chunks = PageChunker.chunksFromDoc(page.content)` — список строк по количеству нод первого уровня.
5. Если `chunks.length === 0` → mark `DONE`, return.
6. Для каждого chunk параллельно (Promise.all с ограничением concurrency):
   - `normalized = await processingClient.normalize(chunk, language='auto')`.
   - Если `normalized` пустой — пропустить.
   - `vector = await embeddingClient.embed(normalized)`.
7. `qdrantWriter.upsert(points)` где `points = [{ id: hash(pageId + chunkIndex), vector, payload: { pageId, workspaceId, chunkIndex } }]`.
8. Mark outbox `DONE`.
9. При исключении на любом шаге: `attempts++`. Если `attempts < INDEXER_MAX_ATTEMPTS` → `status='PENDING'`, `next_attempt_at=now + backoff(attempts)` (backoff: `2^attempts * 10s`, max 5 min). Иначе `status='FAILED'`, `last_error=<message>`.

### PageChunkerService

- Input: `content: PrismaJson` (Tiptap doc: `{ type: 'doc', content: [...] }`).
- Output: `string[]`.
- Алгоритм:
  ```ts
  function chunksFromDoc(doc: TiptapDoc): string[] {
    if (!doc?.content) return []
    return doc.content.map(node => collectText(node))
                       .map(s => s.trim())
                       .filter(s => s.length > 0)
  }
  function collectText(node: TiptapNode): string {
    if (node.type === 'text') return node.text ?? ''
    if (!node.content) return ''
    return node.content.map(collectText).join(' ')
  }
  ```

### QdrantWriterService

- Коллекция `page_chunks` создаётся при старте через `ensureCollection()`: vector size = 768 (nomic-embed-text), distance `Cosine`.
- `deleteByPageId(pageId)`: `qdrant.delete(collection, { filter: { must: [{ key: 'pageId', match: { value: pageId } }] } })`.
- `upsert(points)`: `qdrant.upsert(collection, { points })`.

### ProcessingClientService

- `axios` клиент к `PROCESSING_SERVICE_URL`.
- `normalize(text: string, language?: 'ru' | 'en' | 'auto'): Promise<string>`.
- На 5xx — retry 3 раза с экспоненциальным backoff, после — пробрасывает в processor.

### EmbeddingClientService

- `axios` к `OLLAMA_URL/api/embeddings`.
- `embed(text: string): Promise<number[]>` (768-dim).
- Timeout 30с, retry 2 раза.

### БД-миграция (одна)

1. Partial unique index: `CREATE UNIQUE INDEX outbox_events_active_unique ON outbox_events (aggregate_type, aggregate_id, event_type) WHERE status IN ('PENDING', 'PROCESSING');`.

`OutboxEventStatus` уже содержит нужные значения (`PENDING`, `PROCESSING`, `DONE`, `FAILED`) — дополнять enum не требуется. Изменение вносится в `packages/db/prisma/schema.prisma` как новый `@@index` или через Prisma raw migration + `pnpm --filter @repo/db prisma:db-push`.

## Processing Module (apps/agents)

### Layout

```
agents/apps/processing/
  __init__.py
  router.py               ← APIRouter, prefix='/processing'
  depends.py              ← Dishka Provider, APP scope для NLP-моделей
  errors.py
  schemas.py              ← NormalizeRequest / NormalizeResponse
  services/
    __init__.py
    normalizer.py
    language_detector.py
```

`agents/router.py` агрегатор монтирует processing-роут; `agents/bootstrap.py` подключает `ProcessingProvider` в Dishka-контейнер.

### API

```http
POST /processing/normalize
Content-Type: application/json

{
  "text": "Какой-то шумный русский текст.",
  "language": "auto"
}
```

Response:
```json
{
  "normalized": "какой шумный русский текст",
  "language": "ru"
}
```

### NormalizerService pipeline

1. `unicodedata.normalize("NFC", text)`.
2. `text = text.lower()`.
3. Regex-замена служебных символов: `re.sub(r"[^\w\s]|_", " ", text)`.
4. Схлопывание пробелов: `re.sub(r"\s+", " ", text).strip()`.
5. Если `language == 'auto'` — `langdetect.detect(text)`. Fallback: `ru` на исключение.
6. Выбор spaCy-пайплайна: `ru_core_news_sm` или `en_core_web_sm`. Модели держатся в памяти (Dishka APP scope).
7. Токенизация + лемматизация: `doc = nlp(text)`, фильтр токенов:
   - `not token.is_stop`
   - `not token.is_punct`
   - `len(token.lemma_.strip()) >= 2`
8. `normalized = " ".join(token.lemma_ for token in filtered_tokens)`.

### Зависимости

Добавляются в `apps/agents/pyproject.toml`:
- `spacy ^3.7`
- `langdetect ^1.0`

В `apps/agents/Dockerfile` после `uv sync`:
```dockerfile
RUN uv run python -m spacy download ru_core_news_sm \
 && uv run python -m spacy download en_core_web_sm
```

### Тесты

`apps/agents/tests/test_processing.py` (pytest, unit):
- RU sample: проверяем что "быстрых" лемматизируется в "быстрый", "и"/"в" отфильтрованы как stopwords.
- EN sample: "running quickly" → "run quickly" (или что там выдаёт model).
- Edge-cases: пустая строка → `""`, только пунктуация → `""`, смешанный язык → детектится dominant.
- Контракт router: валидация схемы, happy path, 400 на неправильный body.

## MCP Module

### Структура тулов

Все тулы принимают `userId` и `workspaceId` как обязательные поля. Перед выполнением — `WorkspaceMemberGuard` валидирует членство.

| Тул | Вход | Выход |
|---|---|---|
| `createPage` | `{ userId, workspaceId, parentId?, title, ownership? }` | `{ pageId }` |
| `createPageFromFile` | `{ userId, workspaceId, parentId?, fileId, title? }` | `{ pageId }` |
| `updatePage` | `{ userId, workspaceId, pageId, title?, icon?, content? }` | `{ ok: true }` |
| `movePage` | `{ userId, workspaceId, pageId, newParentId?, prevPageId? }` | `{ ok: true }` |
| `getPageMarkdown` | `{ userId, workspaceId, pageId }` | `{ markdown: string }` |
| `getPageStats` | `{ userId, workspaceId, pageId }` | `{ createdBy, createdAt, type, ownership }` |
| `getWorkspaceStats` | `{ userId, workspaceId }` | `{ members, pagesByType, totalPages }` |
| `listWorkspaceFiles` | `{ userId, workspaceId, limit?, offset? }` | `{ files }` |
| `listPageFiles` | `{ userId, workspaceId, pageId }` | `{ files }` |
| `listSkills` | `{ userId, workspaceId, limit? }` | `{ pages }` (ownership=SKILL) |
| `listAgents` | `{ userId, workspaceId, limit? }` | `{ pages }` (ownership=AGENT) |
| `uploadFileToPage` | `{ userId, workspaceId, pageId, fileName, mimeType, contentBase64 }` | `{ fileId }` |
| `uploadImageToPage` | то же, image-mime | `{ fileId }` |
| `attachFileToPage` | `{ userId, workspaceId, pageId, fileId }` | `{ ok: true }` |
| `attachImageToPage` | то же, image-only | `{ ok: true }` |

### Upload-гибрид

- `uploadFileToPage` / `uploadImageToPage` проверяют `Buffer.byteLength(contentBase64, 'base64') <= UPLOAD_INLINE_MAX_BYTES` (1 MB raw по умолчанию). Если больше — `FileTooLargeError` с сообщением «используйте attach-тул после upload через apps/web».
- Inline-поток: декод base64 → SHA-256 (для `hash`) → `@repo/storage.put(bucket, path, buffer)` → `prisma.file.create(...)` → `prisma.pageFile.create({ pageId, fileId })` → enqueue outbox `page.upserted`.
- Attach-поток: `prisma.file.findUnique({ id })` + проверка `file.workspaceId === workspaceId` → `prisma.pageFile.create({ pageId, fileId })` → enqueue outbox.

### Auth

1. **`McpTokenGuard`** (NestJS `CanActivate`): читает `Authorization: Bearer <token>`, сверяет с `ENGINES_MCP_TOKEN`. 401 на несовпадение.
2. **`WorkspaceMemberGuard`** (декоратор на тул-хэндлерах): из args достаёт `userId` и `workspaceId`, делает `prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })`. 403 если не найден.
3. Для тулов, где указан `pageId` или `fileId` — дополнительная проверка принадлежности ресурса workspace-у. При несовпадении — 404 (`PageNotFoundError` / `FileNotFoundError`), не 403, чтобы не раскрывать существование.

### PageWriterService

Все мутации (`createPage`, `updatePage`, `movePage`, upload/attach) оборачиваются в `prisma.$transaction([...])`:
1. Prisma write.
2. `enqueueOutboxEvent({ eventType: 'page.upserted', aggregateType: 'page', aggregateId: pageId, workspaceId, payload: {} })` (через `@repo/db`).

Так свежее изменение от MCP-тула сразу подхватится `OutboxDrainerService` и попадёт в индексацию.

### MarkdownRendererService

Walker TiptapDoc → Markdown, ~150 строк. Поддерживает ноды: `paragraph`, `heading` (1-6 через `#`-префикс), `bulletList`/`orderedList`/`listItem` (nested с отступом 2 пробела), `blockquote` (`> ` prefix), `codeBlock` (fenced ``` с `params.language`), `horizontalRule` (`---`), `hardBreak` (двойной пробел + `\n`), `text` с марками `bold` (`**`), `italic` (`_`), `code` (`` ` ``), `link` (`[text](href)`). Неподдерживаемые ноды — fallback в plain text их contents.

### FileUploaderService

- `uploadInline(pageId, fileName, mimeType, buffer)` — валидация размера, mime, SHA-256, upload в S3 через `@repo/storage`, запись в `File` + `PageFile` + outbox.
- `attach(pageId, fileId, workspaceId)` — валидация принадлежности файла к workspace, запись в `PageFile` + outbox.
- `computePath(workspaceId, fileId, ext)` — детерминированный путь в S3: `workspaces/${workspaceId}/files/${fileId}.${ext}`.

### StatsService

- `getWorkspaceStats(workspaceId)`: три параллельных запроса — `prisma.workspaceMember.findMany` с include user, `prisma.page.groupBy({ by: ['type'], where: { workspaceId, deletedAt: null }, _count: true })`, `prisma.page.count({ where: { workspaceId, deletedAt: null } })`.
- `getPageStats(pageId)`: `prisma.page.findUnique({ include: { createdBy: true } })` → маппинг в DTO.

### Таксономия ошибок

`apps/engines/src/apps/mcp/errors/mcp.errors.ts`:
- `WorkspaceAccessDeniedError` → HTTP 403, MCP error code `WORKSPACE_ACCESS_DENIED`.
- `PageNotFoundError` → 404, `PAGE_NOT_FOUND`.
- `FileNotFoundError` → 404, `FILE_NOT_FOUND`.
- `FileTooLargeError` → 413, `FILE_TOO_LARGE` (включает подсказку использовать attach).
- `UnsupportedMimeTypeError` → 415, `UNSUPPORTED_MIME_TYPE`.
- NestJS `ExceptionFilter` маппит их в MCP error response.

## Cross-cutting

### Env-переменные (добавить в корневой `.env` и `.env.example`, прописать в `turbo.json > globalEnv`)

```
ENGINES_PORT=8082
ENGINES_MCP_TOKEN=<shared secret>
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
QDRANT_COLLECTION=page_chunks
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=nomic-embed-text
PROCESSING_SERVICE_URL=http://localhost:8080
INDEXER_QUIET_PERIOD_MINUTES=5
INDEXER_CRON_EXPRESSION="*/1 * * * *"
INDEXER_DRAINER_INTERVAL_MS=5000
INDEXER_DRAINER_BATCH=50
INDEXER_MAX_ATTEMPTS=5
UPLOAD_INLINE_MAX_BYTES=1048576
```

`ENGINES_MCP_URL` в `apps/web` не меняется (`http://localhost:8082/mcp`). `PROCESSING_SERVICE_URL` указывает на `apps/agents` (порт 8080).

### package.json / turbo

`apps/engines/package.json`:
- `"name": "engines"`
- `"dev": "nest start --watch"`
- `"build": "nest build"`
- `"check-types": "tsc --noEmit"`
- `"lint": "eslint src --max-warnings 0"`
- `"test": "jest"`
- `"test-int": "jest --config jest.integration.config.ts"`

Зависимости (`@nestjs/core` `^11`, `@nestjs/common` `^11`, `@nestjs/platform-express` `^11`, `@nestjs/schedule` `^4`, `@nestjs/bullmq` + `bullmq` `^5`, `ioredis` `^5`, `@rekog/mcp-nest` latest, `@qdrant/js-client-rest` `^1`, `axios`, `zod`, `@repo/db` workspace, `@repo/storage` workspace).

`turbo.json`:
- Добавить outputs `dist/**` для build.
- Добавить все новые env-ключи в `globalEnv`.

### Docker

`apps/engines/Dockerfile` — multi-stage:
1. `node:22-alpine` builder: `pnpm install`, `pnpm build`.
2. `node:22-alpine` runner: `dist/`, `node_modules` (prod-only), `CMD ["node", "dist/main.js"]`.
3. `prisma generate` запускается на build-шаге через `@repo/db` postinstall hook (уже настроено в monorepo).

`compose.yml` — добавить сервис `engines` (порт 8082), зависит от `postgres`, `redis`, `qdrant`, `ollama`, `agents`.

### Тесты

**Unit (Jest, `apps/engines/test/unit/`):**
- `OutboxCronService` — фикстура страниц, проверка ON CONFLICT DO NOTHING через мок Prisma.
- `OutboxDrainerService` — concurrency через FOR UPDATE SKIP LOCKED, backoff calculation.
- `PageChunker` — фикстуры Tiptap JSON (вложенные списки, хедеры, пустой doc).
- `MarkdownRenderer` — каждая нода/марка покрыта.
- `McpTokenGuard` — happy path + wrong token + missing header.
- `WorkspaceMemberGuard` — member / non-member / deleted-user.
- Каждый MCP-тул — happy path + access-denied + cross-workspace attempt.
- `FileUploaderService` — размер, mime, SHA-256, workspace-ownership.
- `MarkdownRendererService` — все поддерживаемые ноды.

**Integration (Jest, `apps/engines/test/integration/`):**
- Требует запущенные `postgres`, `redis`, `qdrant`, `ollama`, `apps/agents` (с processing module).
- Полный e2e: tRPC-мутация в `apps/web` (через прямой Prisma-write в тесте) → outbox PENDING → drainer → BullMQ → processor → Qdrant point существует → `search_workspace_pages` (reuse из apps/agents) возвращает страницу.
- MCP e2e: `createPage` через MCP → страница в БД → outbox → индексация → searchable.

**apps/agents:**
- `tests/test_processing.py` — юнит фикстуры RU/EN.

### Rollout plan (одна ветка `feat/engines-nest-rewrite`, последовательные коммиты)

1. **Миграция БД:** добавить partial unique index и enum value в schema.prisma → `pnpm --filter @repo/db prisma:db-push`. Отдельный коммит для БД.
2. **apps/agents processing:** создать модуль, тесты, зависимости. Отдельный коммит.
3. **apps/engines scaffold:** удалить `apps/engines/engines/` (Python) и `apps/indexer/` целиком. Создать NestJS-скелет (`package.json`, `tsconfig.json`, `nest-cli.json`, `src/main.ts`, `src/app.module.ts`), infra модули (db/qdrant/ollama). Коммит.
4. **Indexer module:** реализация cron + drainer + processor + services + unit tests. Коммит.
5. **MCP module:** все тулы + guards + services + error taxonomy + unit tests. Коммит.
6. **Integration tests + compose:** добавить engines в `compose.yml`, написать integration tests. Коммит.
7. **Env + Turbo + docs:** обновить `.env.example`, `turbo.json`, README в `apps/engines/`. Коммит.
8. **Smoke test:** `docker compose up -d`, `pnpm dev`, создать страницу через UI → убедиться что outbox становится DONE за ≤ minute+drainer_interval, `listWorkspacePages` (MCP) возвращает её, search работает.
9. Merge в `main`.

## Risks and Mitigations

- **Race между apps/web enqueue и cron UPSERT:** partial unique index гарантирует что одновременно не может быть двух активных outbox строк для одной страницы и eventType. Второй INSERT получит `DO NOTHING`.
- **Processing-service down:** processor пробрасывает исключение → outbox `attempts++`, retry с backoff. После `INDEXER_MAX_ATTEMPTS=5` → `FAILED`. Мониторинг падающих задач через SQL query (follow-up).
- **Ollama cold start:** первый embedding может занять >10 секунд. Retry в `EmbeddingClientService` покроет.
- **spaCy memory footprint:** ~200 MB с обеими моделями. Подъём `apps/agents` процесса занимает +2-3 секунды. Dishka APP scope — загрузка один раз.
- **Удаление старых `apps/engines/engines` и `apps/indexer`:** должно быть в том же коммите, где добавляется новый `apps/engines`, чтобы в любой момент между коммитами репо компилировался.
- **MCP tool передаёт userId от любого агента:** компенсируется `WorkspaceMemberGuard` — агент не может представиться не-членом. Ограничение: внутри одного workspace агент может выдавать себя за любого участника. Принято пользователем (Q2-C).
- **`updatePage` vs Yjs:** перезапись `Page.content` из MCP игнорирует активные Yjs-сессии. Реальный Yjs-аккорд будет потерян при следующем broadcast от клиента. Accept-решение: MCP используется автоматикой агента, Yjs — живыми пользователями; коллизии маловероятны. Follow-up: использовать Yjs-aware update API.

## Definition of Done

- `apps/engines` — NestJS-сервис, запускается `pnpm --filter engines dev`, отвечает `200` на `/health`.
- `/mcp` отдаёт 15 тулов согласно spec.
- Cron + drainer работают, индексация страницы завершается за ≤ `INDEXER_QUIET_PERIOD_MINUTES + INDEXER_DRAINER_INTERVAL_MS + обработка`.
- `apps/agents/apps/processing/normalize` работает для RU и EN.
- Старые `apps/engines/engines` (Python) и `apps/indexer` удалены, git log чист.
- Unit-тесты проходят, integration-тесты зелёные на реальных сервисах.
- `pnpm check-types`, `pnpm lint`, `pnpm build`, `pnpm test` — все зелёные.
- Smoke-тест пройден.
