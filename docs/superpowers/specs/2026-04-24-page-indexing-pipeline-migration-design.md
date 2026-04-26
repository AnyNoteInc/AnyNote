---
status: draft
date: 2026-04-24
topic: Page indexing pipeline migration — yjs outbox → agents vectorization
---

# Page Indexing Pipeline Migration — Design

## Goal

Переместить embedding/vector-stack из `apps/engines` (TS) в `apps/agents` (Python),
перевести инициализацию индексирования в `apps/yjs` через transactional outbox,
ускорить открытие страницы за счёт seed Y.Doc из снапшота, добавить RAG retrieval
прямо в LangGraph и обязательный формат цитирования `[title](/workspaces/{wsId}/pages/{pgId}#{blockNumber})`.

## Non-goals

- Не меняем JWT-аутентификацию в yjs (существующий flow).
- Не переделываем MCP-сервер в engines — остаётся на том же порту.
- Не добавляем hybrid search / cross-encoder rerank / кэш эмбеддингов.
- Не индексируем EXCALIDRAW / GENOGRAM — только TEXT.
- Не трогаем старую коллекцию `page_chunks` — создаём новую `pages`, старую удаляем после миграции.

## Current state

- **apps/yjs** (Hocuspocus): `onStoreDocument` сохраняет `contentYjs` (bytes) + `content`
  (Tiptap JSON через `TiptapTransformer.fromYdoc`) для TEXT. Для EXCALIDRAW — только `contentYjs`.
  Outbox-событий не генерирует.
- **apps/engines** (NestJS): полный пайплайн — `OutboxCronService` сканит `Page.updatedAt`
  и создаёт `page.upserted` события, `OutboxDrainerService` драинит в BullMQ,
  `IndexingProcessor` дёргает `/processing/normalize` в agents → Ollama embed → Qdrant upsert.
  `SearchModule` с HTTP-эндпоинтом `/search/pages` + `MCP-модуль`.
- **apps/agents** (FastAPI + LangGraph): `/processing/normalize` на spaCy + langdetect + splitter.
  LangGraph-чат, но без Qdrant-интеграции — retrieval делает `apps/web`, вызывая engines.
- **OutboxEvent** (Postgres): уже есть поля `status`, `next_attempt_at`, `aggregate_type`,
  `aggregate_id`, `workspace_id`, `event_type`. Частичный уникальный индекс
  `outbox_events_active_unique ON (aggregate_type, aggregate_id, event_type)
WHERE status IN ('PENDING','PROCESSING')` обеспечивает дедупликацию.
- **enqueueOutboxEvent** (`@repo/db`): хелпер без `ON CONFLICT`, вызывается из 9 мест
  tRPC-роутера (rename, create, duplicate и т.д.).

## Architecture

```
──────────────────────────── WRITE PATH ────────────────────────────
Client edits page
     │
     ▼
apps/yjs  onStoreDocument (single prisma.$transaction)
     │
     ├─► Page.contentYjs (bytes)    ─┐
     ├─► Page.content (JSON:          │
     │     TEXT → Tiptap JSON,        │ атомарно
     │     EXCALIDRAW → { elements }) │
     └─► INSERT outbox_events (PENDING, next_attempt_at = now()+5m)
           ON CONFLICT DO NOTHING
           (только для TEXT)

──────────────────────────── INDEX PATH ────────────────────────────
apps/engines  @Cron "*/30 * * * * *"
     │
     ▼
SELECT 10 rows WHERE status='PENDING' AND next_attempt_at<=now()
  FOR UPDATE SKIP LOCKED   →   mark PROCESSING
     │
     ▼
For each row:
  · load Page.content
  · walk top-level blocks, пропуская heading/hiddenText/image/fileAttachment
  · рекурсивно собирать текст в каждом блоке, скипая те же типы
  · emit { blockNumber, content } (blockNumber = индекс в doc.content)
     │
     ▼
POST apps/agents /vectorization
  { pageId, workspaceId, title, pageType, contents[] }
     │
     ▼
Success → mark DONE. Failure → attempts++, exp backoff через next_attempt_at,
          FAILED после INDEXER_MAX_ATTEMPTS.

─────────────────────────── VECTORIZE PATH ────────────────────────
apps/agents POST /vectorization
     │
     ├─► vector_store_repository.delete_by_page(pageId)  # идемпотентность
     │
     └─► for each block in contents:
          chunks = splitter.split(block.content)     # 500/100
          for chunk in chunks:
            normalized = normalizer.normalize(chunk)  # lower + strip punct
                                                      # + NFC + tokenize
                                                      # + lemmatize + stopwords
            vector = vectorization_repository.embed(normalized)
            payload_meta = {
              pageId, workspaceId, title, pageType,
              blockNumber, content: <raw chunk, pre-norm>
            }
            points.append((stable_uuid, vector, payload_meta))
          vector_store_repository.upsert_chunks(points)

────────────────────────── RETRIEVE PATH ──────────────────────────
LangGraph prepare_prompt
     │
     ├─► rag_retrieval_service.retrieve(workspaceId, query, k=5)
     │     · retriever.ainvoke(query) с filter workspaceId (overfetch k*3)
     │     · dedupe by (pageId, blockNumber)
     │     · top 5
     │
     └─► jinja_renderer_repository.render(payload, mcp_tools, rag_documents)
         → default.j2 citation format:
         `[{title}](/workspaces/{workspaceId}/pages/{pageId}#{blockNumber})`
```

## Section 1 — apps/yjs: outbox + Excalidraw snapshot + atomic transaction

### Files

- `apps/yjs/src/persistence.ts` — расширяем `storePageDocument`.
- `apps/yjs/src/auth.ts` — `canAccessPage` возвращает `{ pageType, workspaceId }`.
- `apps/yjs/src/index.ts` — `AuthContext = { userId, pageType, workspaceId }`,
  `onStoreDocument` прокидывает `workspaceId`.
- `packages/db/src/index.ts` — новый хелпер `enqueueOutboxEventIgnoreConflict`.

### 1.1 AuthContext

```ts
type AuthContext = { userId: string; pageType: PageType; workspaceId: string }
```

`canAccessPage` читает `workspaceId` одним SELECT вместе с `pageType` — избегаем
лишнего SELECT внутри `onStoreDocument`.

### 1.2 Excalidraw JSON snapshot

В `storePageDocument`:

```ts
if (pageType === PageType.EXCALIDRAW) {
  const yElements = document.getArray('elements')
  const snapshot = { elements: yElements.toJSON() }
  data.content = snapshot as Prisma.InputJsonValue
}
```

Файлы (`yAssets`) **не** включаем — см. решение в спеке: быстрый рендер элементов
без файлов, картинки догружаются по существующему S3-flow.

Для TEXT — ветка `TiptapTransformer.fromYdoc` остаётся. Для GENOGRAM — `content`
не пишем.

### 1.3 Outbox insert в той же транзакции

```ts
await prisma.$transaction(async (tx) => {
  await tx.page.update({ where: { id: pageId }, data })
  if (pageType === PageType.TEXT) {
    await enqueueOutboxEventIgnoreConflict(tx, {
      eventType: 'page.upserted',
      aggregateType: 'page',
      aggregateId: pageId,
      workspaceId,
      delayMs: 5 * 60 * 1000,
    })
  }
})
```

Только TEXT-страницы создают события — EXCALIDRAW и GENOGRAM в индекс не попадают.

### 1.4 enqueueOutboxEventIgnoreConflict

Новый хелпер в `packages/db/src/index.ts`:

```ts
export async function enqueueOutboxEventIgnoreConflict(
  tx: Prisma.TransactionClient,
  args: EnqueueOutboxEventArgs & { delayMs?: number },
): Promise<void> {
  const delaySql = args.delayMs
    ? Prisma.sql`now() + ${args.delayMs} * interval '1 millisecond'`
    : Prisma.sql`now()`
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO outbox_events
      (event_type, aggregate_type, aggregate_id, workspace_id, payload, status, next_attempt_at)
    VALUES
      (${args.eventType}, ${args.aggregateType}, ${args.aggregateId}::uuid,
       ${args.workspaceId ?? null}::uuid, ${args.payload ?? {}}::jsonb, 'PENDING', ${delaySql})
    ON CONFLICT DO NOTHING
  `)
}
```

Существующий `enqueueOutboxEvent` **не меняем** — его 9 вызовов в tRPC-роутере
остаются работать как сейчас (без delay, без `ON CONFLICT`, ловят P2002 только при
гонках двойным кликом — приемлемо).

Побочный эффект: если одновременно приходит `rename` через tRPC (`next_attempt_at=now()`)
и правка контента через yjs (`now()+5m`), второй insert — no-op. Событие уедет в cron
раньше чем через 5 минут. Quiet-period теряется только в этом racing-кейсе —
не критично.

### 1.5 Tests

Добавляем jest в `apps/yjs` по образцу engines. Покрытие:

- TEXT + change → Page.update (content + contentYjs) + outbox insert
  с `next_attempt_at ≈ now()+5m`.
- EXCALIDRAW + change → Page.update (content = `{elements}`) + нет outbox.
- GENOGRAM → Page.update (только contentYjs) + нет outbox.
- Дубль insert → второй no-op (через mock PrismaClient с unique-constraint).

## Section 2 — apps/web + editor-пакеты: мгновенный рендер без сокета

Вариант B, подтверждено пользователем: клиент делает `Y.applyUpdate(doc, bytes)`
до подключения HocuspocusProvider. State vector клиента совпадает с серверным →
sync-handshake присылает только свежие дельты, пользовательского "флика" нет.

### 2.1 tRPC page read

В `packages/trpc/src/routers/page.ts` процедура, которую вызывает RSC-страница
`/workspaces/[id]/pages/[pageId]`, возвращает `contentYjs` как base64:

```ts
contentYjs: page.contentYjs ? Buffer.from(page.contentYjs).toString("base64") : null,
```

### 2.2 PageRenderer

В `apps/web/src/components/page/page-renderer.tsx`:

```ts
type Props = {
  page: { id: string; type: PageType; contentYjs: string | null }
  workspaceId: string
  user: { id: string; name: string; color: string }
}
```

`initialContentYjs` пробрасывается в `AnyNoteEditor` (для TEXT) и `Board` (для EXCALIDRAW).

### 2.3 @repo/editor

В `packages/editor/src/anynote-editor.tsx` Y.Doc создаётся с seed:

```ts
const ydoc = useMemo(() => {
  const doc = new Y.Doc()
  if (initialContentYjs) {
    Y.applyUpdate(doc, decodeBase64(initialContentYjs))
  }
  return doc
}, [pageId])
```

`TiptapTransformer.toYdoc(json)` НЕ используем — он создаёт Y.Doc с новым clientID,
merge с сервером даст дубли. Байты authoritative.

### 2.4 @repo/excalidraw

В `packages/excalidraw/src/use-excalidraw-yjs.ts` — тот же паттерн:
`Y.applyUpdate(ydoc, bytes)` до `new HocuspocusProvider(...)`. `yElements` получает
содержимое до первого рендера, `board-inner.tsx` рисует фигуры мгновенно.
`yAssets` будут пустыми до syncing — картинки появятся чуть позже элементов
(не хуже текущего поведения).

### 2.5 Scope guards

- `packages/genogram/` не трогаем.
- `usePageEditor` контекст / `yjs-config.ts` не меняем.
- Не вводим "read-only preview → editable" переключение.

### 2.6 Tests

- Unit на seed-путь в `@repo/editor` и `@repo/excalidraw`: после `applyUpdate`
  сравниваем `Y.encodeStateVector(doc)` с ожидаемым.
- Визуальная проверка — в Playwright (секция 8).

## Section 3 — apps/engines: удаление + новый outbox→vectorization cron

### 3.1 Удаляем целиком

**Файлы/папки:**

- `apps/engines/src/apps/indexer/services/embedding-client.service.{ts,spec.ts}`
- `apps/engines/src/apps/indexer/services/page-chunker.service.{ts,spec.ts}` — переезжает в agents
- `apps/engines/src/apps/indexer/services/processing-client.service.{ts,spec.ts}`
- `apps/engines/src/apps/indexer/services/qdrant-writer.service.{ts,spec.ts}`
- `apps/engines/src/apps/indexer/services/reindex-on-boot.service.{ts,spec.ts}`
- `apps/engines/src/apps/indexer/queue/` (весь каталог)
- `apps/engines/src/apps/indexer/cron/outbox-drainer.service.{ts,spec.ts}`
- `apps/engines/src/apps/indexer/cron/outbox-cron.service.{ts,spec.ts}` — заменяется новым
- `apps/engines/src/apps/search/` — весь каталог
- `apps/engines/src/infra/qdrant/` — весь каталог
- `apps/engines/src/infra/ollama/` — весь каталог

**package.json зависимости убираем:**

- `@nestjs/bullmq`, `bullmq`, `ioredis`
- `@qdrant/js-client-rest`
- `axios` (при реализации проверить, не используется ли в MCP)

**AppModule:**

- Убираем `BullModule.forRoot({...})`.
- `SearchModule`, `QdrantModule`, `OllamaModule` — удаляем из imports.
- `IndexerModule` — переписан (см. 3.2).

### 3.2 Новый `IndexerModule`

```
apps/engines/src/apps/indexer/
  cron/
    vectorization-cron.service.ts
    vectorization-cron.service.spec.ts
  services/
    agents-client.service.ts
    agents-client.service.spec.ts
    page-content-reader.service.ts
    page-content-reader.service.spec.ts
  indexer.module.ts
```

```ts
@Module({
  providers: [VectorizationCronService, AgentsClient, PageContentReader],
})
export class IndexerModule {}
```

### 3.3 PageContentReader — обход блоков

```ts
type TiptapNode = { type: string; text?: string; content?: TiptapNode[] }

const SKIP = new Set(["heading", "hiddenText", "image", "fileAttachment"])

blocksFromDoc(doc: TiptapNode): Array<{ blockNumber: number; content: string }> {
  if (!doc || doc.type !== "doc" || !Array.isArray(doc.content)) return []
  const out: Array<{ blockNumber: number; content: string }> = []
  doc.content.forEach((node, idx) => {
    if (SKIP.has(node.type)) return
    const text = collectText(node).trim()
    if (!text) return
    out.push({ blockNumber: idx, content: text })
  })
  return out
}

function collectText(node: TiptapNode): string {
  if (SKIP.has(node.type)) return ""
  if (node.type === "text") return node.text ?? ""
  if (!Array.isArray(node.content)) return ""
  return node.content.map(collectText).join(" ")
}
```

- `blockNumber` — индекс в исходном `doc.content`, **даже если блок пропущен/пуст** —
  соответствует подсветке N-го блока в UI.
- SKIP применяется и на верхнем уровне, и рекурсивно (вложенный `image` внутри
  `callout` тоже пропускается).
- Типтап-типы в SKIP соответствуют категориям из исходного запроса:
  `heading=header`, `hiddenText=hidder`, `image=image`, `fileAttachment=files`.
  Именно эти названия типов уже используются в текущем `PageChunker` (до удаления)
  и в `packages/editor/src/extensions/` (hidden-text.tsx, etc.).
- Контейнеры, которые **не** в SKIP (`callout`, `toggle`, `bulletList`, `orderedList`,
  `listItem`, `taskList`, `taskItem`, `blockquote`, `paragraph`) — их `content[]` рекурсивно
  обходится и весь вложенный текст конкатенируется в строку через пробел.
- Если `page.content` — `null` (новая пустая страница без сохранений) или не `{type:'doc'}`
  — возвращается `[]`, cron зовёт `/vectorization` с пустым `contents` → Qdrant чистит
  старые точки, если они были.

### 3.4 AgentsClient

Тонкий HTTP-клиент на нативном `fetch` (без axios):

```ts
@Injectable()
export class AgentsClient {
  private readonly baseUrl = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8080'
  private readonly timeoutMs = 30_000

  async vectorize(payload: VectorizationPayload): Promise<void> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}/vectorization`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal,
      })
      if (!res.ok) {
        throw new Error(`agents /vectorization ${res.status}: ${await res.text()}`)
      }
    } finally {
      clearTimeout(t)
    }
  }
}

type VectorizationPayload = {
  pageId: string
  workspaceId: string
  title: string
  pageType: string
  contents: Array<{ blockNumber: number; content: string }>
}
```

### 3.5 VectorizationCronService

```ts
@Cron(process.env.INDEXER_CRON_EXPRESSION ?? "*/30 * * * * *")
async tick() {
  const claimed = await this.prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
      SELECT id, aggregate_id AS page_id, workspace_id
      FROM outbox_events
      WHERE event_type = 'page.upserted'
        AND aggregate_type = 'page'
        AND status = 'PENDING'
        AND next_attempt_at <= now()
      ORDER BY next_attempt_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    `)
    if (rows.length === 0) return []
    await tx.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status='PROCESSING', locked_at=now(), locked_by=${this.workerId}
      WHERE id IN (${Prisma.join(rows.map((r) => r.id))})
    `)
    return rows
  })
  await this.processBatch(claimed)
}

private async processBatch(rows: Row[]) {
  for (const row of rows) {
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: row.page_id },
        select: {
          id: true, type: true, deletedAt: true,
          title: true, content: true, workspaceId: true,
        },
      })
      if (!page || page.deletedAt || page.type !== "TEXT") {
        // idempotent cleanup: всё равно зовём agents с пустым contents,
        // чтобы он удалил старые точки из Qdrant
        await this.agents.vectorize({
          pageId: row.page_id, workspaceId: row.workspace_id,
          title: "", pageType: "TEXT", contents: [],
        })
        await this.markDone(row.id)
        continue
      }
      const contents = this.reader.blocksFromDoc(page.content as TiptapNode)
      await this.agents.vectorize({
        pageId: page.id,
        workspaceId: page.workspaceId,
        title: page.title ?? "",
        pageType: page.type,
        contents,
      })
      await this.markDone(row.id)
    } catch (err) {
      await this.markFailedOrRetry(row.id, err as Error)
    }
  }
}
```

- **Batch = 10** per tick, cadence 30s.
- **5-min quiet-period** — учтён на стороне yjs (yjs insertит с `next_attempt_at=now()+5m`),
  cron просто фильтрует.
- **FOR UPDATE SKIP LOCKED** — защита от гонок (на случай multi-instance).
- **markPROCESSING в транзакции, HTTP вне** — чтобы не держать локи.
- `markDone` / `markFailedOrRetry` — по образцу существующего
  `indexing.processor.ts` (exp backoff через `next_attempt_at`, `FAILED`
  после `INDEXER_MAX_ATTEMPTS=5`).

### 3.6 ENV

**Убираем:** `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`, `OLLAMA_BASE_URL`,
`EMBEDDING_MODEL`, `REDIS_URL`, `PROCESSING_SERVICE_URL`, `INDEXER_DRAINER_BATCH`,
`INDEXER_DRAINER_INTERVAL_MS`, `INDEXER_REINDEX_ON_BOOT`, `INDEXER_QUIET_PERIOD_MINUTES`.

**Оставляем:** `AGENTS_SERVICE_URL`, `INDEXER_CRON_EXPRESSION` (новый дефолт),
`INDEXER_MAX_ATTEMPTS`.

### 3.7 Tests

- `page-content-reader.service.spec.ts` — крайние случаи: пустой doc, документ с одним
  `heading`, вложенный `image` внутри `callout`, нумерация при пропущенных блоках.
- `agents-client.service.spec.ts` — happy path, таймаут, 5xx throw.
- `vectorization-cron.service.spec.ts` — batch claim/mark, skip deleted pages, retry,
  exp backoff.
- E2E из `apps/engines/test/integration/` — старые тесты search/index удаляются,
  добавляется интеграционный с real Postgres + mocked agents (10 событий за тик).

### 3.8 Backfill CLI

`apps/engines/src/cli/backfill-reindex.ts` — one-shot Nest CLI-команда:

```bash
pnpm --filter engines backfill:reindex
```

Читает все TEXT-страницы (`deletedAt IS NULL`), вставляет в outbox с
`next_attempt_at=now()` (без 5-min delay). Cron за несколько тиков обработает.
Не подписана на `onApplicationBootstrap` — только вручную.

## Section 4 — apps/agents: `/vectorization` endpoint

### 4.1 Удаляем из apps/processing

- `router.py` → endpoint `POST /processing/normalize` убираем.
- `schemas.py` → старые `NormalizeRequestSchema`/`NormalizeResponseSchema` —
  удаляем, пересобираем под vectorization.
- `use_cases/normalize_text.py` — удаляем.
- `services/language_detector.py` — **оставляем** (нужен для выбора spaCy pipeline).
- `services/normalizer.py` — **оставляем**, но упрощаем: убираем splitter (переносим
  в отдельный сервис), метод `normalize(text)` возвращает `str`.

### 4.2 Новая структура

```
apps/agents/agents/apps/processing/
  router.py               # POST /vectorization
  schemas.py              # VectorizationRequestSchema, ContentBlockSchema, ...
  depends.py
  errors.py
  services/
    language_detector.py  # keep
    normalizer.py         # keep, упростить (без splitter)
    chunker.py            # NEW — RecursiveCharacterTextSplitter
  repositories/
    vectorization_repository.py   # NEW — langchain-ollama
    vector_store_repository.py    # NEW — langchain-qdrant
  use_cases/
    vectorize_page.py     # NEW — orchestrator
```

### 4.3 Schemas

```python
from uuid import UUID
from pydantic import BaseModel, Field

class ContentBlockSchema(BaseModel):
    blockNumber: int = Field(..., ge=0)
    content: str = Field(..., min_length=1)

class VectorizationRequestSchema(BaseModel):
    pageId: UUID
    workspaceId: UUID
    title: str
    pageType: str
    contents: list[ContentBlockSchema]

class VectorizationResponseSchema(BaseModel):
    indexedChunks: int
    skippedBlocks: int
```

Pydantic сериализует `UUID` через `str()` при рендере в Qdrant-payload.

### 4.4 Router

```python
router = APIRouter(prefix="/vectorization", tags=["Vectorization"])

@router.post("", response_model=VectorizationResponseSchema)
@inject
async def vectorize(
    payload: VectorizationRequestSchema,
    use_case: FromDishka[VectorizePageUseCase],
) -> VectorizationResponseSchema:
    return await use_case(payload)
```

### 4.5 ChunkerService

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

class ChunkerService:
    def __init__(self) -> None:
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=500, chunk_overlap=100, length_function=len,
        )

    def split(self, text: str) -> list[str]:
        return [c.strip() for c in self.splitter.split_text(text) if c.strip()]
```

### 4.6 NormalizerService — упрощённый

Оставляем spaCy (ru/en) + `LanguageDetectorService`. Новая сигнатура:

```python
def normalize(self, text: str) -> str:
    """lower → strip punct → NFC → tokenize → lemmatize → drop stopwords → join."""
```

Splitter вынесен в `ChunkerService`. Splitting теперь ДО нормализации — `chunk_size=500`
считается по исходному тексту, естественнее для UX (длины ~соответствуют UI-блокам).

### 4.7 VectorizationRepository

```python
from dataclasses import dataclass
from langchain_ollama import OllamaEmbeddings

@dataclass
class VectorizationRepository:
    embeddings: OllamaEmbeddings

    async def embed(self, text: str) -> list[float]:
        return (await self.embeddings.aembed_documents([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return await self.embeddings.aembed_documents(texts)
```

### 4.8 VectorStoreRepository

```python
from dataclasses import dataclass
from typing import Any
from langchain_qdrant import QdrantVectorStore
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Distance, VectorParams, Filter, FieldCondition, MatchValue, PointStruct,
)
from langchain_ollama import OllamaEmbeddings

COLLECTION = "pages"
VECTOR_SIZE = 768

@dataclass
class VectorStoreRepository:
    client: AsyncQdrantClient
    embeddings: OllamaEmbeddings

    async def ensure_collection(self) -> None:
        cols = await self.client.get_collections()
        if not any(c.name == COLLECTION for c in cols.collections):
            await self.client.create_collection(
                COLLECTION,
                vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
            )

    async def delete_by_page(self, page_id: str) -> None:
        await self.client.delete(
            COLLECTION,
            points_selector=Filter(must=[
                FieldCondition(key="pageId", match=MatchValue(value=page_id))
            ]),
        )

    async def upsert_chunks(
        self,
        points: list[tuple[str, list[float], dict[str, Any]]],
    ) -> None:
        if not points:
            return
        await self.client.upsert(
            COLLECTION,
            points=[PointStruct(id=pid, vector=vec, payload=pl)
                    for (pid, vec, pl) in points],
        )

    def as_retriever(self, workspace_id: str, k: int = 5):
        store = QdrantVectorStore(
            client=self.client,
            collection_name=COLLECTION,
            embedding=self.embeddings,
        )
        return store.as_retriever(
            search_kwargs={
                "k": k,
                "filter": Filter(must=[
                    FieldCondition(key="workspaceId", match=MatchValue(value=workspace_id))
                ]),
            },
        )
```

`ensure_collection` зовётся один раз на startup (FastAPI lifespan).

### 4.9 VectorizePageUseCase

```python
from dataclasses import dataclass
from hashlib import sha256
from uuid import UUID
from typing import Any

@dataclass
class VectorizePageUseCase:
    chunker_service: ChunkerService
    normalizer_service: NormalizerService
    vectorization_repository: VectorizationRepository
    vector_store_repository: VectorStoreRepository

    async def __call__(
        self, payload: VectorizationRequestSchema,
    ) -> VectorizationResponseSchema:
        # 1. Идемпотентность: удаляем все точки страницы
        await self.vector_store_repository.delete_by_page(str(payload.pageId))

        indexed = 0
        skipped = 0
        points: list[tuple[str, list[float], dict[str, Any]]] = []

        for block in payload.contents:
            raw_chunks = self.chunker_service.split(block.content)
            if not raw_chunks:
                skipped += 1
                continue

            for i, raw_chunk in enumerate(raw_chunks):
                normalized = self.normalizer_service.normalize(raw_chunk)
                if not normalized:
                    continue

                vector = await self.vectorization_repository.embed(normalized)

                payload_meta = {
                    "pageId":      str(payload.pageId),
                    "workspaceId": str(payload.workspaceId),
                    "title":       payload.title,
                    "pageType":    payload.pageType,
                    "blockNumber": block.blockNumber,
                    "content":     raw_chunk,   # raw chunk до нормализации
                }
                points.append((
                    self._point_id(payload.pageId, block.blockNumber, i),
                    vector,
                    payload_meta,
                ))
                indexed += 1

        await self.vector_store_repository.upsert_chunks(points)
        return VectorizationResponseSchema(
            indexedChunks=indexed, skippedBlocks=skipped,
        )

    @staticmethod
    def _point_id(page_id: UUID, block_number: int, chunk_idx: int) -> str:
        """Стабильный UUID из (pageId, blockNumber, chunkIdx) — Qdrant upsert по id
        делает retry полностью идемпотентным."""
        h = sha256(f"{page_id}:{block_number}:{chunk_idx}".encode()).hexdigest()
        return str(UUID(h[:32]))
```

Ключевое: `payload_meta.content` = **исходный чанк до нормализации** (ровно как в
вашей спеке "исходный чанк после сплитинга"). Нормализованный текст нужен только
для embedding-а, нигде не сохраняется.

### 4.10 Dishka-провайдер

```python
class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    normalizer_service = provide(NormalizerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    chunker_service = provide(ChunkerService, scope=Scope.APP)
    vectorization_repository = provide(VectorizationRepository)
    vector_store_repository = provide(VectorStoreRepository)
    vectorize_page_use_case = provide(VectorizePageUseCase)

provider = ProcessingProvider()
```

`qdrant_client` и `ollama_embeddings` выносим в общий `VectorsProvider`
(`agents/core/providers/vectors.py`) — их использует и chat (retrieval).

### 4.11 Dependencies pyproject.toml

Добавляем:

- `langchain-qdrant>=0.2.0`
- `qdrant-client>=1.12` (если ещё не в tree)

Ничего из существующего не удаляем: `langchain-text-splitters`, `spacy`, `langdetect`
все нужны.

### 4.12 Tests

- `tests/apps/processing/test_chunker.py`
- `tests/apps/processing/test_normalizer.py` (адаптируем существующие)
- `tests/apps/processing/test_vectorize_page.py` (mocked repositories, dedupe, idempotency)
- `tests/apps/processing/test_router.py` (FastAPI TestClient, 200 / 422)
- Интеграционный с реальным Qdrant (marker `integration`).

## Section 5 — apps/agents: RAG retrieval в LangGraph + шаблон

### 5.1 RagRetrievalService

```
apps/agents/agents/apps/chat/services/
  graph.py
  rag_retrieval.py        # NEW
```

```python
from dataclasses import dataclass
from uuid import UUID
from langchain_core.documents import Document

@dataclass
class RagRetrievalService:
    vector_store_repository: VectorStoreRepository

    async def retrieve(
        self, workspace_id: UUID, query: str, k: int = 5,
    ) -> list[RagDocumentSchema]:
        if not query.strip():
            return []
        retriever = self.vector_store_repository.as_retriever(
            workspace_id=str(workspace_id), k=k * 3,  # overfetch для dedup
        )
        docs = await retriever.ainvoke(query)
        return self._dedupe(docs, k)

    @staticmethod
    def _dedupe(docs: list[Document], k: int) -> list[RagDocumentSchema]:
        seen: set[tuple[str, int]] = set()
        result: list[RagDocumentSchema] = []
        for d in docs:
            key = (d.metadata["pageId"], d.metadata["blockNumber"])
            if key in seen:
                continue
            seen.add(key)
            result.append(RagDocumentSchema(
                page_id=UUID(d.metadata["pageId"]),
                workspace_id=UUID(d.metadata["workspaceId"]),
                title=d.metadata["title"],
                page_type=d.metadata["pageType"],
                block_number=d.metadata["blockNumber"],
                content=d.metadata["content"],
            ))
            if len(result) >= k:
                break
        return result
```

### 5.2 Schema updates

В `apps/chat/schemas.py`:

```python
class RagDocumentSchema(BaseModel):
    page_id: UUID
    workspace_id: UUID
    title: str
    page_type: str
    block_number: int
    content: str

class RagDocumentsSchema(BaseModel):
    documents: list[RagDocumentSchema]
```

Удаляем старые поля (`chunk_index`, `created_by_id`, `created_at`, `updated_at`) — их
нет в новой metadata, для ссылок не нужны. `QueryRequestSchema.rag` делаем опциональным —
web больше не шлёт.

### 5.3 GraphService.prepare_prompt

```python
@dataclass
class GraphService:
    jinja_repository: JinjaRendererRepository
    mcp_tools_repository: McpToolsRepository
    model_factory_repository: ModelFactoryRepository
    rag_retrieval_service: RagRetrievalService
    checkpointer: AsyncPostgresSaver

    async def prepare_prompt(self, context, state):
        payload = state.payload
        # ... mcp tools как сейчас ...

        rag_documents = await self.rag_retrieval_service.retrieve(
            workspace_id=payload.user_context.workspace_id,
            query=payload.query,
            k=5,
        )

        system_prompt = self.jinja_repository.render(
            payload=state.payload,
            mcp_server_tools=mcp_server_tools,
            rag_documents=rag_documents,
        )
        # ... дальше как сейчас ...
```

### 5.4 apps/web — убираем дублирующий search-путь

- Удаляем `apps/web/src/lib/chat/rag-search.ts`.
- Убираем `rag` из `agents-payload.ts` builder и типа.
- Убираем `searchRagDocuments(...)` из `apps/web/src/app/api/agents/generate/route.ts`.
- Соответствующие тесты удаляем.

### 5.5 default.j2 — формат ссылок с якорем

```jinja
{% if rag and rag.documents -%}
## Retrieved context
Ниже — фрагменты страниц рабочего пространства, найденные по запросу пользователя.
Используй их как основной источник фактов. Если фрагмента недостаточно —
вызови инструмент `getPageMarkdown(pageId)`, чтобы прочитать полный текст страницы.

{% for d in rag.documents -%}
### Документ {{ loop.index }}
- pageId: {{ d.page_id }}
- workspaceId: {{ d.workspace_id }}
- blockNumber: {{ d.block_number }}
- title: {{ d.title }}
- pageType: {{ d.page_type }}
- content:
{{ d.content | indent(2, first=True) }}

{% endfor -%}

Правила цитирования:
- Ссылайся на страницы так: `[{{ '{title}' }}](/workspaces/{{ '{workspaceId}' }}/pages/{{ '{pageId}' }}#{{ '{blockNumber}' }})`
- Не придумывай pageId/blockNumber — используй только значения из списка выше
- Если нужного факта нет в найденных фрагментах — явно скажи «в базе знаний не найдено»
{% endif -%}
```

Остальная часть шаблона (TOOLS с `getPageMarkdown(pageId)`, # TASK, # OUTPUT) —
не меняется.

### 5.6 JinjaRendererRepository.render

Добавляем третий параметр:

```python
def render(
    self,
    payload: QueryRequestSchema,
    mcp_server_tools: list[McpServerToolsSchema],
    rag_documents: list[RagDocumentSchema],
) -> str:
    ...
```

Внутри: `rag = {"documents": [d.model_dump(mode="json") for d in rag_documents]}`
(mode=json чтобы UUID сериализовался в строку).

### 5.7 Dishka wiring

`VectorsProvider` (общий):

```python
class VectorsProvider(Provider):
    scope = Scope.APP

    @provide
    async def qdrant_client(self, settings_repo) -> AsyncIterator[AsyncQdrantClient]:
        settings = await settings_repo.get(SettingsSchema)
        auth = settings.qdrant.auth
        client = AsyncQdrantClient(
            url=settings.qdrant.url,
            api_key=auth.token if auth else None,
        )
        try:
            yield client
        finally:
            await client.close()

    @provide
    async def ollama_embeddings(self, settings_repo) -> OllamaEmbeddings:
        settings = await settings_repo.get(SettingsSchema)
        return OllamaEmbeddings(
            base_url=settings.ollama.url,
            model=settings.ollama.embedding_model,
        )
```

Подключается в обоих app-контейнерах (chat + processing).

В `apps/chat/depends.py`:

```python
rag_retrieval_service = provide(RagRetrievalService, scope=Scope.REQUEST)
```

### 5.8 Tests

- `tests/apps/chat/services/test_rag_retrieval.py` — mocked retriever, dedup, overfetch, empty query.
- `tests/apps/chat/repositories/test_jinja_renderer.py` — обновить: рендер с двумя
  документами, проверить, что в выводе есть `/workspaces/{wsId}/pages/{pgId}#{blockNumber}`.
- `tests/apps/chat/services/test_graph.py` — `prepare_prompt` вызывает `retrieve` и
  прокидывает результат в `render`.
- Интеграционный: реальный Qdrant + Ollama, workspace-фильтр.

## Section 6 — Settings + env + wiring

### 6.1 settings.py

```python
from typing import Annotated
from pydantic import Field
from fast_clean.settings import (
    CoreDbSettingsSchema,
    CoreSettingsSchema,
    CoreServiceSettingsSchema,
    BearerTokenAuthSchema,
)

class QdrantSettingsSchema(CoreServiceSettingsSchema):
    auth: BearerTokenAuthSchema | None = None
    collection_name: str = "pages"
    vector_size: int = 768

class OllamaSettingsSchema(CoreServiceSettingsSchema):
    embedding_model: str = "nomic-embed-text"

class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema

settings = SettingsSchema()  # type: ignore
```

### 6.2 .env (root)

**Удаляем:**

```
QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION,
OLLAMA_BASE_URL, EMBEDDING_MODEL,
REDIS_URL, PROCESSING_SERVICE_URL, ENGINES_SERVICE_URL,
INDEXER_DRAINER_BATCH, INDEXER_DRAINER_INTERVAL_MS,
INDEXER_REINDEX_ON_BOOT, INDEXER_QUIET_PERIOD_MINUTES
```

**Добавляем:**

```
QDRANT__HOST=localhost
QDRANT__PORT=6333
QDRANT__PROTOCOL=http
QDRANT__AUTH__TOKEN=
QDRANT__COLLECTION_NAME=pages
OLLAMA__HOST=localhost
OLLAMA__PORT=11434
OLLAMA__PROTOCOL=http
OLLAMA__EMBEDDING_MODEL=nomic-embed-text
```

**Остаются как есть:** `AGENTS_SERVICE_URL`, `INDEXER_CRON_EXPRESSION` (новый дефолт
`*/30 * * * * *`), `INDEXER_MAX_ATTEMPTS`, все `NEXT_PUBLIC_*`, `YJS_*`, `DATABASE_URL`,
`BETTER_AUTH_*`, `S3_*`.

### 6.3 turbo.json globalEnv

Синхронизируем список с `.env` — удаляем старые, добавляем новые с префиксами.

### 6.4 compose.yml

Проверить, нужен ли Redis — был только под BullMQ. Если никто больше не использует —
удалить service. Weaviate оставляем (вне скоупа).

### 6.5 Prisma schema

Не меняется. Все нужные поля `OutboxEvent` уже есть. Частичный уникальный индекс
работает. Миграций нет.

### 6.6 Application bootstrap

В `apps/agents` FastAPI lifespan (или `@app.on_event("startup")`):

```python
async with container(scope=Scope.APP) as req_container:
    vsr = await req_container.get(VectorStoreRepository)
    await vsr.ensure_collection()
```

### 6.7 requests.http / Swagger

- `apps/agents/requests.http`: убрать `POST /processing/normalize`, добавить `POST /vectorization`.
- `apps/engines/requests.http`: убрать `/search/pages`, `/indexer/*`.
- `apps/engines/src/main.ts`: убрать `.addTag("search")`, `.addTag("indexer")` (чистота).

## Section 7 — Playwright E2E

### 7.1 File

`apps/e2e/rag-block-links.spec.ts`

Если существующий `apps/e2e/rag.spec.ts` есть — переименовываем и переписываем.

### 7.2 Setup через Prisma (в beforeAll)

```ts
const MARKER = 'Корпоративный кофе называется «Бразильский Медведь»'
const QUERY = 'Как называется наш корпоративный кофе?'

test.beforeAll(async () => {
  // 1. user + workspace + WorkspaceAiSettings (GigaChat)
  // 2. TEXT-страница с Tiptap-структурой:
  //    doc
  //      ├─ paragraph { text: "Документ о напитках в офисе." } // blockNumber 0
  //      ├─ heading   { text: "Кофе" }                         // blockNumber 1 (skip)
  //      └─ paragraph { text: MARKER }                         // blockNumber 2
  // 3. В той же транзакции — outbox insert с next_attempt_at=now()
  //    (НЕ +5m, обходим quiet-period для короткого цикла теста)
})
```

### 7.3 Steps

```ts
test('assistant cites page with block-anchor link', async ({ page }) => {
  // 1. Подождать, пока engines cron обработает outbox (max ~45s)
  await waitUntil(
    async () => {
      const row = await prisma.outboxEvent.findFirst({
        where: { aggregateId: pageId, eventType: 'page.upserted' },
      })
      return row?.status === 'DONE'
    },
    { timeout: 45_000, pollMs: 1000 },
  )

  // 2. Fail-fast: проверяем, что в Qdrant лежит точка для blockNumber=2
  const pointExists = await qdrantHasPointForBlock(pageId, 2)
  expect(pointExists).toBe(true)

  // 3. UI login + чат
  await loginAs(page, userId)
  await page.goto(`/workspaces/${workspaceId}/chats/new`)
  await page.getByRole('textbox', { name: /сообщение/i }).fill(QUERY)
  await page.getByRole('button', { name: /отправить/i }).click()

  // 4. Ждём окончания стриминга
  await expect(page.getByTestId('assistant-message-status-done')).toBeVisible({
    timeout: 60_000,
  })

  // 5. Assertions
  const text = await page.getByTestId('assistant-message-content').textContent()
  expect(text).toContain('Бразильский Медведь')

  const anchor = page.locator(`a[href="/workspaces/${workspaceId}/pages/${pageId}#2"]`)
  await expect(anchor).toBeVisible()
})
```

### 7.4 Helpers

- `apps/e2e/helpers/qdrant-helpers.ts` — `qdrantHasPointForBlock(pageId, blockNumber)`
  через REST `/collections/pages/points/scroll`.
- `apps/e2e/helpers/wait-until.ts` — polling wrapper (если отсутствует).
- `apps/e2e/helpers/prisma-seed.ts` — дополняем функциями `createUserWithWorkspace`,
  `createTextPage`.

### 7.5 Scope guards

- Не мокаем LLM — нужен реальный, чтобы проверить формат ссылки.
- Не трогаем `chat-streaming.spec.ts`, `auth.spec.ts` — зелёные без изменений.
- EXCALIDRAW не покрываем (не индексируется).

### 7.6 Risks

- **LLM-недетерминированность** — GigaChat может выдать ссылку в другом формате. Hedge:
  если флакает, усиливаем prompt (few-shot пример в шаблоне).
- **Ollama `nomic-embed-text` не подгружена** — тест падает на шаге 2. README + pre-flight check.

## Migration plan

### Qdrant collections

- Новая `pages` создаётся автоматически при старте agents (через `ensure_collection`).
- Старая `page_chunks` удаляется вручную после переключения:
  `curl -X DELETE http://localhost:6333/collections/page_chunks`
- Данные не мигрируем — backfill через CLI.

### Backfill

`pnpm --filter engines backfill:reindex` — заливает все TEXT-страницы в outbox с
`next_attempt_at=now()`. Cron обработает за несколько тиков. Документируем в README.

Для ускорения backfill-а можно временно поднять cadence до `*/5 * * * * *` и batch
до 50.

### Rollback

- **yjs** — откат коммита. Страницы не регистрируются к векторизации, но работа
  редактора не страдает.
- **engines** — возврат старого `IndexerModule` + `SearchModule` из Git. Outbox-события
  продолжают копиться (`attempts` растёт, потом `FAILED`) — БД не портится.
- **agents** `/vectorization` 5xx — engines retry. При долгой проблеме выключаем cron
  `INDEXER_CRON_EXPRESSION="0 0 31 2 *"` (невалидное "никогда").
- Коллекция `pages` — можно уронить, при следующем старте agents создаст пустую.

## Error handling summary

| Ошибка                                 | Где               | Поведение                                                                                            |
| -------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------- |
| yjs → Postgres down                    | `onStoreDocument` | Ошибка клиенту, retry при reconnect. Страница не испорчена.                                          |
| Page.update прошёл, outbox insert упал | `onStoreDocument` | Транзакция откатывается — атомарно.                                                                  |
| Дубль outbox insert (concurrent)       | `onStoreDocument` | `ON CONFLICT DO NOTHING` — no-op.                                                                    |
| engines cron упал                      | —                 | `PROCESSING` + `locked_by` остаются. Нужен watchdog (вне скоупа) или ручная очистка. README warning. |
| agents `/vectorization` 5xx            | engines cron      | `markFailedOrRetry` — exp backoff. `FAILED` после `INDEXER_MAX_ATTEMPTS=5`.                          |
| agents Ollama down                     | `/vectorization`  | 503, engines retry.                                                                                  |
| agents Qdrant down                     | `/vectorization`  | 503, engines retry.                                                                                  |
| LLM retrieval: Qdrant down             | `prepare_prompt`  | Warning в лог, `rag.documents=[]`. Чат отвечает без контекста (best-effort).                         |
| Page soft-deleted между outbox и cron  | engines cron      | Вызываем `/vectorization` с пустым `contents` — agents сам сделает `delete_by_page_id`. 200 OK.      |

## Implementation order (PR split)

**PR 1 — agents: `/vectorization` endpoint** (без интеграции с engines)

Settings, repositories, services, use_case, router, тесты. Старый `/processing/normalize`
временно остаётся — engines всё ещё его дёргает, ничего не ломается. Shippable
независимо.

**PR 2 — agents: RAG retrieval в LangGraph + template**

`RagRetrievalService`, изменения `GraphService.prepare_prompt`, правки `default.j2`,
общий `VectorsProvider`. Зависит от PR 1. До PR 5 web шлёт пустой `rag.documents` —
retrieval внутри agents заполняет сам.

**PR 3 — yjs: outbox + Excalidraw + `enqueueOutboxEventIgnoreConflict`**

Persistence, auth context, Excalidraw JSON, тесты. В отрыве от индексации —
старый engines `OutboxDrainer` по-прежнему драинит в BullMQ. Страницы переиндексируются
через старый путь.

**PR 4 — engines: заменить старый indexer/search на новый cron**

Удаление старых файлов/зависимостей, добавление нового `VectorizationCronService`.
⚠️ Blocking: после merge web-код, бьющий `/search/pages`, начнёт возвращать 404. PR 5
идёт merge-pair или сразу после.

**PR 5 — web: убрать `rag-search.ts`, чистка payload**

Удаление, тесты. Выкатывается вместе с PR 4.

**PR 6 — Playwright E2E + README + backfill CLI**

`rag-block-links.spec.ts`, pre-flight инструкции, backfill-команда в engines.

**PR 7 — cleanup env + docs**

Убрать устаревшие env из `.env.example`, `turbo.json globalEnv`. CLAUDE.md при
необходимости.

Каждый PR самостоятелен, green на main.

## Environment variables summary

**Добавляется в `.env` / `turbo.json globalEnv`:**

- `QDRANT__HOST`, `QDRANT__PORT`, `QDRANT__PROTOCOL`, `QDRANT__AUTH__TOKEN`,
  `QDRANT__COLLECTION_NAME`
- `OLLAMA__HOST`, `OLLAMA__PORT`, `OLLAMA__PROTOCOL`, `OLLAMA__EMBEDDING_MODEL`

**Удаляется:**

- `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION`
- `OLLAMA_BASE_URL`, `EMBEDDING_MODEL`
- `REDIS_URL`, `PROCESSING_SERVICE_URL`, `ENGINES_SERVICE_URL`
- `INDEXER_DRAINER_BATCH`, `INDEXER_DRAINER_INTERVAL_MS`
- `INDEXER_REINDEX_ON_BOOT`, `INDEXER_QUIET_PERIOD_MINUTES`

**Остаётся без изменений:**

- `DATABASE_URL`, `BETTER_AUTH_*`, `S3_*`, `NEXT_PUBLIC_BASE_URL`
- `NEXT_PUBLIC_YJS_URL`, `YJS_PORT`, `BETTER_AUTH_JWT_AUDIENCE`
- `AGENTS_SERVICE_URL`
- `INDEXER_CRON_EXPRESSION` (новый дефолт `*/30 * * * * *`), `INDEXER_MAX_ATTEMPTS`

## Known risks

| Риск                                                      | Mitigation                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `TiptapTransformer.toYdoc` даёт дубли при клиентском seed | Используем `Y.applyUpdate(doc, bytes)` — байты authoritative.           |
| spaCy-модели качаются долго                               | Bake в Docker image (уже сделано).                                      |
| `nomic-embed-text` не подтянут локально                   | README + pre-flight warning в agents bootstrap.                         |
| langchain-qdrant + asyncpg: event loop конфликты          | `AsyncQdrantClient` + langchain-qdrant async API. Интеграционные тесты. |
| Concurrent outbox insert                                  | `ON CONFLICT DO NOTHING` — отрабатывает.                                |
| Backfill 100k+ событий — cron медленный                   | Временный повышенный cadence + batch до 50 для backfill-окна. README.   |

## Decisions (for future readers)

1. **Где живёт vectorization?** apps/agents (Python) — langchain-qdrant + langchain-ollama
   унифицируют retrieval и indexing, код-экосистема spaCy/langdetect и так здесь.
2. **Где живёт outbox cron?** apps/engines — NestJS scheduler уже есть, Prisma-клиент
   есть, не тянем Python-драйнер outbox в agents.
3. **Кто пишет outbox?** apps/yjs — единая точка входа всех изменений контента.
   tRPC-мутации метаданных продолжают писать через `enqueueOutboxEvent` (rename/create/duplicate).
4. **Начальный рендер из JSON или байтов?** Байты — `Y.applyUpdate(doc, bytes)`. JSON
   не годится для seed Y.Doc'а (merge даёт дубли).
5. **Excalidraw в `page.content`?** Да, только `{ elements }` — без `files`/dataURL.
6. **Индексация EXCALIDRAW?** Нет — в нём нет текста для векторизации.
7. **Quiet-period?** 5 минут, через `next_attempt_at = now() + 5m` при insert.
   Cron фильтрует `next_attempt_at <= now()`. Дедуп через partial unique index.
8. **Batch size / cadence?** 10 per tick, cadence 30s. Для backfill — бампим до 50 / 5s.
9. **Collection name?** `pages` (новая), старую `page_chunks` удаляем вручную.
10. **LLM-ссылка формат?** `[title](/workspaces/{wsId}/pages/{pageId}#{blockNumber})`
    — якорь ведёт к конкретному блоку в UI.
