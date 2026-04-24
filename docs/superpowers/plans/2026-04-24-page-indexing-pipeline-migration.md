# Page Indexing Pipeline Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Переместить embedding/vector-stack из `apps/engines` в `apps/agents`, перевести индексирование на transactional outbox в `apps/yjs`, ускорить открытие страниц через Y.Doc seed, добавить RAG в LangGraph и формат цитирования с блок-якорем.

**Architecture:** Трёхсервисный pipeline: `apps/yjs` пишет Page.content + outbox row → `apps/engines` cron (каждые 30s, batch 10, quiet-period 5 min) обходит блоки → POST `apps/agents /vectorization` → langchain-ollama embed → langchain-qdrant upsert в коллекцию `pages`. LangGraph retrieval идёт напрямую из Qdrant внутри `prepare_prompt`. Клиент сеет Y.Doc из `contentYjs` (bytes) до подключения Hocuspocus, чтобы первый пейнт был мгновенный.

**Tech Stack:** Python (FastAPI, Dishka, LangGraph, langchain-qdrant, langchain-ollama, spaCy), TypeScript (NestJS, Prisma, Yjs, Hocuspocus, Next.js), Qdrant, Ollama, Playwright.

**Spec:** `docs/superpowers/specs/2026-04-24-page-indexing-pipeline-migration-design.md`

**Execution phases (= PR boundaries):**

- Phase 1 — agents `/vectorization` endpoint (self-contained)
- Phase 2 — agents RAG retrieval + prompt template
- Phase 3 — apps/yjs outbox + Excalidraw snapshot
- Phase 4 — client-side initial content loading
- Phase 5 — engines slim-down + new cron
- Phase 6 — apps/web cleanup (remove rag-search)
- Phase 7 — E2E tests + backfill CLI
- Phase 8 — env / docs cleanup

Each phase ends with a commit; main stays green after every phase.

---

## Phase 1 — apps/agents: `/vectorization` endpoint

### Task 1: Add Qdrant + Ollama settings

**Files:**
- Modify: `apps/agents/agents/settings.py`

- [ ] **Step 1: Update settings.py with Qdrant and Ollama schemas**

Replace the file content with:

```python
from typing import Annotated

from fast_clean.settings import (
    BearerTokenAuthSchema,
    CoreDbSettingsSchema,
    CoreServiceSettingsSchema,
    CoreSettingsSchema,
)
from pydantic import Field


class QdrantSettingsSchema(CoreServiceSettingsSchema):
    auth: BearerTokenAuthSchema | None = None
    collection_name: str = 'pages'
    vector_size: int = 768


class OllamaSettingsSchema(CoreServiceSettingsSchema):
    embedding_model: str = 'nomic-embed-text'


class SettingsSchema(CoreSettingsSchema):
    cors_origins: Annotated[list[str], Field(default_factory=list)]
    db: CoreDbSettingsSchema
    qdrant: QdrantSettingsSchema
    ollama: OllamaSettingsSchema


settings = SettingsSchema()  # type: ignore
```

- [ ] **Step 2: Verify settings parses env correctly**

Create temporary test env and run:
```bash
cd apps/agents && QDRANT__HOST=localhost QDRANT__PORT=6333 QDRANT__PROTOCOL=http \
  OLLAMA__HOST=localhost OLLAMA__PORT=11434 OLLAMA__PROTOCOL=http \
  DB__HOST=localhost DB__PORT=5432 DB__PROTOCOL=postgresql DB__NAME=test DB__USER=test DB__PASSWORD=test \
  python -c "from agents.settings import settings; print(settings.qdrant.url, settings.ollama.embedding_model)"
```

Expected output contains `http://localhost:6333 nomic-embed-text`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/settings.py
git commit -m "feat(agents): add qdrant + ollama settings schemas"
```

---

### Task 2: Add langchain-qdrant and qdrant-client dependencies

**Files:**
- Modify: `apps/agents/pyproject.toml`

- [ ] **Step 1: Add dependencies**

Edit the `[project] dependencies` array to insert, after `"langchain-text-splitters>=0.3.11",`:

```toml
    "langchain-qdrant>=0.2.0",
    "qdrant-client>=1.12.0",
```

- [ ] **Step 2: Sync uv lock + install**

```bash
cd apps/agents && uv sync
```

Expected: `langchain-qdrant` and `qdrant-client` appear in `uv.lock`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/pyproject.toml apps/agents/uv.lock
git commit -m "feat(agents): add langchain-qdrant + qdrant-client deps"
```

---

### Task 3: ChunkerService (RecursiveCharacterTextSplitter wrapper)

**Files:**
- Create: `apps/agents/agents/apps/processing/services/chunker.py`
- Create: `apps/agents/tests/apps/processing/test_chunker.py`
- Modify: `apps/agents/agents/apps/processing/services/__init__.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/apps/processing/test_chunker.py`:

```python
from agents.apps.processing.services.chunker import ChunkerService


def test_split_returns_stripped_chunks() -> None:
    service = ChunkerService()
    text = '  hello world  '
    result = service.split(text)
    assert result == ['hello world']


def test_split_drops_empty_chunks() -> None:
    service = ChunkerService()
    assert service.split('') == []
    assert service.split('   ') == []


def test_split_large_text_produces_multiple_chunks() -> None:
    service = ChunkerService()
    long = 'abcdefg ' * 200  # ~1600 chars
    result = service.split(long)
    assert len(result) >= 2
    assert all(len(c) <= 500 for c in result)
```

Also ensure `apps/agents/tests/apps/processing/__init__.py` exists (touch if missing).

- [ ] **Step 2: Run test — should fail**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_chunker.py -v
```

Expected: ImportError — `ChunkerService` not found.

- [ ] **Step 3: Implement ChunkerService**

Create `apps/agents/agents/apps/processing/services/chunker.py`:

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter


class ChunkerService:
    """Разбиение текста на чанки фиксированного размера с overlap."""

    def __init__(self) -> None:
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=500,
            chunk_overlap=100,
            length_function=len,
        )

    def split(self, text: str) -> list[str]:
        return [c.strip() for c in self.splitter.split_text(text) if c.strip()]
```

Update `apps/agents/agents/apps/processing/services/__init__.py` to export it:

```python
from .chunker import ChunkerService
from .language_detector import LanguageDetectorService
from .normalizer import NormalizerService

__all__ = ['ChunkerService', 'LanguageDetectorService', 'NormalizerService']
```

- [ ] **Step 4: Run test — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_chunker.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/services/chunker.py apps/agents/agents/apps/processing/services/__init__.py apps/agents/tests/apps/processing/test_chunker.py
git commit -m "feat(agents): add ChunkerService for recursive text splitting"
```

---

### Task 4: Simplify NormalizerService (remove splitter)

**Files:**
- Modify: `apps/agents/agents/apps/processing/services/normalizer.py`
- Modify: `apps/agents/tests/apps/processing/test_normalizer.py` (create if missing)

- [ ] **Step 1: Check existing tests**

```bash
ls apps/agents/tests/apps/processing/ 2>/dev/null
```

If `test_normalizer.py` exists, read it. If not, plan to create it.

- [ ] **Step 2: Write/update test**

Create or replace `apps/agents/tests/apps/processing/test_normalizer.py`:

```python
from agents.apps.processing.services.language_detector import LanguageDetectorService
from agents.apps.processing.services.normalizer import NormalizerService


def test_normalize_russian_text() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Привет, мир! Это тестовый текст.')
    assert isinstance(result, str)
    # После лемматизации + удаления стопслов должно остаться что-то непустое
    assert len(result) > 0
    assert result == result.lower()


def test_normalize_english_text() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Hello world! This is a test.')
    assert isinstance(result, str)
    assert len(result) > 0
    assert result == result.lower()


def test_normalize_empty_string_returns_empty() -> None:
    service = NormalizerService(LanguageDetectorService())
    assert service.normalize('') == ''
    assert service.normalize('   ') == ''


def test_normalize_strips_punctuation() -> None:
    service = NormalizerService(LanguageDetectorService())
    result = service.normalize('Hello!!! World...')
    assert '!' not in result
    assert '.' not in result
```

- [ ] **Step 3: Run — should fail (signature mismatch)**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_normalizer.py -v
```

Expected: FAIL — current `normalize(text, language)` returns a tuple, new API expects `normalize(text) -> str`.

- [ ] **Step 4: Rewrite NormalizerService**

Replace `apps/agents/agents/apps/processing/services/normalizer.py`:

```python
import re
import unicodedata

import spacy
from spacy.language import Language

from .language_detector import LanguageDetectorService

PIPELINE_NAMES = {
    'ru': 'ru_core_news_sm',
    'en': 'en_core_web_sm',
}

SERVICE_CHARS_RE = re.compile(r'[^\w\s]|_', re.UNICODE)
WHITESPACE_RE = re.compile(r'\s+')


class NormalizerService:
    """spaCy-backed text normalizer. Loads both models on construction."""

    def __init__(self, detector: LanguageDetectorService) -> None:
        self.pipelines: dict[str, Language] = {
            lang: spacy.load(model_name) for lang, model_name in PIPELINE_NAMES.items()
        }
        self.detector = detector

    def normalize(self, text: str) -> str:
        """Run the full normalization pipeline: lower + strip punct + NFC
        + tokenize + lemmatize + drop stopwords.

        Returns the normalized string (may be empty).
        """
        if not text or not text.strip():
            return ''

        # 1. Unicode NFC
        text = unicodedata.normalize('NFC', text)
        # 2. Lowercase
        text = text.lower()
        # 3. Remove service chars (punctuation, underscores) → space
        text = SERVICE_CHARS_RE.sub(' ', text)
        # 4. Collapse whitespace
        text = WHITESPACE_RE.sub(' ', text).strip()

        if not text:
            return ''

        # 5. Language detection
        effective_lang = self.detector.detect(text)
        nlp = self.pipelines[effective_lang]

        # 6-8. Tokenize + lemmatize + filter stopwords/punct/short
        doc = nlp(text)
        lemmas: list[str] = []
        for token in doc:
            if token.is_stop or token.is_punct or token.is_space:
                continue
            lemma = token.lemma_.strip()
            if len(lemma) < 2:
                continue
            lemmas.append(lemma)

        return ' '.join(lemmas)
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_normalizer.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/processing/services/normalizer.py apps/agents/tests/apps/processing/test_normalizer.py
git commit -m "refactor(agents): simplify NormalizerService — drop splitter, return str"
```

---

### Task 5: VectorizationRepository (Ollama embeddings wrapper)

**Files:**
- Create: `apps/agents/agents/apps/processing/repositories/__init__.py`
- Create: `apps/agents/agents/apps/processing/repositories/vectorization_repository.py`
- Create: `apps/agents/tests/apps/processing/test_vectorization_repository.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/apps/processing/test_vectorization_repository.py`:

```python
from unittest.mock import AsyncMock

import pytest

from agents.apps.processing.repositories.vectorization_repository import VectorizationRepository


@pytest.mark.asyncio
async def test_embed_returns_single_vector() -> None:
    mock_embeddings = AsyncMock()
    mock_embeddings.aembed_documents = AsyncMock(return_value=[[0.1, 0.2, 0.3]])
    repo = VectorizationRepository(embeddings=mock_embeddings)

    result = await repo.embed('test')

    assert result == [0.1, 0.2, 0.3]
    mock_embeddings.aembed_documents.assert_awaited_once_with(['test'])


@pytest.mark.asyncio
async def test_embed_batch_returns_multiple_vectors() -> None:
    mock_embeddings = AsyncMock()
    mock_embeddings.aembed_documents = AsyncMock(return_value=[[0.1], [0.2]])
    repo = VectorizationRepository(embeddings=mock_embeddings)

    result = await repo.embed_batch(['a', 'b'])

    assert result == [[0.1], [0.2]]
```

- [ ] **Step 2: Run — should fail (module missing)**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vectorization_repository.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement repository**

Create `apps/agents/agents/apps/processing/repositories/__init__.py`:

```python
from .vector_store_repository import VectorStoreRepository
from .vectorization_repository import VectorizationRepository

__all__ = ['VectorStoreRepository', 'VectorizationRepository']
```

Note: `vector_store_repository` will be created in Task 6 — import order here is fine because Python loads both lazily.

Create `apps/agents/agents/apps/processing/repositories/vectorization_repository.py`:

```python
from dataclasses import dataclass

from langchain_ollama import OllamaEmbeddings


@dataclass
class VectorizationRepository:
    """Обёртка над OllamaEmbeddings для векторизации текста."""

    embeddings: OllamaEmbeddings

    async def embed(self, text: str) -> list[float]:
        return (await self.embeddings.aembed_documents([text]))[0]

    async def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return await self.embeddings.aembed_documents(texts)
```

- [ ] **Step 4: Temporarily create stub vector_store_repository.py** so the __init__ import works

Create `apps/agents/agents/apps/processing/repositories/vector_store_repository.py` with a minimal stub:

```python
# Stub — real implementation in Task 6.
class VectorStoreRepository:
    pass
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vectorization_repository.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/agents/agents/apps/processing/repositories/ apps/agents/tests/apps/processing/test_vectorization_repository.py
git commit -m "feat(agents): add VectorizationRepository over OllamaEmbeddings"
```

---

### Task 6: VectorStoreRepository (langchain-qdrant wrapper)

**Files:**
- Modify: `apps/agents/agents/apps/processing/repositories/vector_store_repository.py` (replace stub)
- Create: `apps/agents/tests/apps/processing/test_vector_store_repository.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/apps/processing/test_vector_store_repository.py`:

```python
from unittest.mock import AsyncMock, MagicMock

import pytest
from qdrant_client.http.models import Distance, VectorParams

from agents.apps.processing.repositories.vector_store_repository import (
    COLLECTION, VECTOR_SIZE, VectorStoreRepository,
)


@pytest.mark.asyncio
async def test_ensure_collection_creates_when_missing() -> None:
    client = AsyncMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[]))
    client.create_collection = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.ensure_collection()

    client.create_collection.assert_awaited_once()
    args, kwargs = client.create_collection.call_args
    assert args[0] == COLLECTION or kwargs.get('collection_name') == COLLECTION


@pytest.mark.asyncio
async def test_ensure_collection_noop_when_exists() -> None:
    existing = MagicMock(); existing.name = COLLECTION
    client = AsyncMock()
    client.get_collections = AsyncMock(return_value=MagicMock(collections=[existing]))
    client.create_collection = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.ensure_collection()

    client.create_collection.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_by_page_calls_client_delete_with_filter() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.delete_by_page('abc-123')

    client.delete.assert_awaited_once()
    args, kwargs = client.delete.call_args
    assert args[0] == COLLECTION
    # filter must reference pageId='abc-123'
    filt = kwargs['points_selector']
    assert filt.must[0].key == 'pageId'
    assert filt.must[0].match.value == 'abc-123'


@pytest.mark.asyncio
async def test_upsert_chunks_noop_when_empty() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    await repo.upsert_chunks([])

    client.upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_upsert_chunks_calls_client_upsert() -> None:
    client = AsyncMock()
    repo = VectorStoreRepository(client=client, embeddings=MagicMock())

    points = [('point-1', [0.1, 0.2], {'pageId': 'p1'})]
    await repo.upsert_chunks(points)

    client.upsert.assert_awaited_once()


def test_constants() -> None:
    assert COLLECTION == 'pages'
    assert VECTOR_SIZE == 768
```

- [ ] **Step 2: Run — should fail (stub has no methods)**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_repository.py -v
```

Expected: ImportError or AttributeError.

- [ ] **Step 3: Implement VectorStoreRepository**

Replace `apps/agents/agents/apps/processing/repositories/vector_store_repository.py`:

```python
from dataclasses import dataclass
from typing import Any

from langchain_ollama import OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    Distance, FieldCondition, Filter, MatchValue, PointStruct, VectorParams,
)

COLLECTION = 'pages'
VECTOR_SIZE = 768


@dataclass
class VectorStoreRepository:
    """Обёртка над Qdrant collection `pages` для векторных операций."""

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
                FieldCondition(key='pageId', match=MatchValue(value=page_id))
            ]),
        )

    async def upsert_chunks(
        self, points: list[tuple[str, list[float], dict[str, Any]]],
    ) -> None:
        if not points:
            return
        await self.client.upsert(
            COLLECTION,
            points=[
                PointStruct(id=pid, vector=vec, payload=pl)
                for (pid, vec, pl) in points
            ],
        )

    def as_retriever(self, workspace_id: str, k: int = 5):  # type: ignore[no-untyped-def]
        store = QdrantVectorStore(
            client=self.client,
            collection_name=COLLECTION,
            embedding=self.embeddings,
        )
        return store.as_retriever(
            search_kwargs={
                'k': k,
                'filter': Filter(must=[
                    FieldCondition(key='workspaceId', match=MatchValue(value=workspace_id))
                ]),
            },
        )
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vector_store_repository.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/repositories/vector_store_repository.py apps/agents/tests/apps/processing/test_vector_store_repository.py
git commit -m "feat(agents): add VectorStoreRepository over langchain-qdrant"
```

---

### Task 7: Shared VectorsProvider (Qdrant client + Ollama embeddings)

**Files:**
- Create: `apps/agents/agents/core/__init__.py`
- Create: `apps/agents/agents/core/depends.py`

Rationale: both `processing` (indexing) and `chat` (retrieval) need the same `AsyncQdrantClient` and `OllamaEmbeddings`. We put them in a shared provider to avoid double-construction. `fast_clean.ContainerManager` auto-discovers all modules named `depends.py`.

- [ ] **Step 1: Create shared provider**

Create `apps/agents/agents/core/__init__.py` (empty file).

Create `apps/agents/agents/core/depends.py`:

```python
"""Shared providers used by multiple apps (processing, chat)."""

from __future__ import annotations

from collections.abc import AsyncIterator

from dishka import Provider, Scope, provide
from fast_clean.repositories import SettingsRepositoryProtocol
from langchain_ollama import OllamaEmbeddings
from qdrant_client import AsyncQdrantClient

from agents.settings import SettingsSchema


class VectorsProvider(Provider):
    scope = Scope.APP

    @provide
    async def qdrant_client(
        self, settings_repository: SettingsRepositoryProtocol,
    ) -> AsyncIterator[AsyncQdrantClient]:
        settings = await settings_repository.get(SettingsSchema)
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
    async def ollama_embeddings(
        self, settings_repository: SettingsRepositoryProtocol,
    ) -> OllamaEmbeddings:
        settings = await settings_repository.get(SettingsSchema)
        return OllamaEmbeddings(
            base_url=settings.ollama.url,
            model=settings.ollama.embedding_model,
        )


provider = VectorsProvider()
```

- [ ] **Step 2: Smoke test — app container still builds**

```bash
cd apps/agents && uv run python -c "
import asyncio
from agents.bootstrap import create_app
from agents.router import apply_routes
app = create_app([apply_routes])
print('OK', app.title)
"
```

Expected: `OK <app title>` — no import/container build error.

(If Qdrant/Ollama env is not set, the provider is still fine — it only constructs clients on first `@inject`.)

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/core/
git commit -m "feat(agents): add shared VectorsProvider for Qdrant + Ollama"
```

---

### Task 8: VectorizationRequestSchema / ResponseSchema

**Files:**
- Modify: `apps/agents/agents/apps/processing/schemas.py` (replace content)

- [ ] **Step 1: Replace schemas.py**

Replace `apps/agents/agents/apps/processing/schemas.py`:

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

- [ ] **Step 2: Verify parse roundtrip**

```bash
cd apps/agents && uv run python -c "
from agents.apps.processing.schemas import VectorizationRequestSchema
import json
data = {
  'pageId': '00000000-0000-0000-0000-000000000001',
  'workspaceId': '00000000-0000-0000-0000-000000000002',
  'title': 't', 'pageType': 'TEXT',
  'contents': [{'blockNumber': 0, 'content': 'x'}]
}
print(VectorizationRequestSchema(**data).model_dump_json())
"
```

Expected: valid JSON output without error.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/processing/schemas.py
git commit -m "feat(agents): replace processing schemas with Vectorization*"
```

---

### Task 9: VectorizePageUseCase

**Files:**
- Create: `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`
- Create: `apps/agents/tests/apps/processing/test_vectorize_page.py`
- Modify: `apps/agents/agents/apps/processing/use_cases/__init__.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/apps/processing/test_vectorize_page.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from agents.apps.processing.schemas import (
    ContentBlockSchema, VectorizationRequestSchema,
)
from agents.apps.processing.use_cases.vectorize_page import VectorizePageUseCase


PAGE_ID = UUID('00000000-0000-0000-0000-000000000001')
WS_ID = UUID('00000000-0000-0000-0000-000000000002')


def _make_use_case(
    split_return=None, normalize_return='normalized', embed_return=None,
):
    chunker = MagicMock()
    chunker.split = MagicMock(side_effect=split_return or (lambda t: [t]))

    normalizer = MagicMock()
    normalizer.normalize = MagicMock(return_value=normalize_return)

    vec_repo = MagicMock()
    vec_repo.embed = AsyncMock(return_value=embed_return or [0.1, 0.2])

    store = MagicMock()
    store.delete_by_page = AsyncMock()
    store.upsert_chunks = AsyncMock()

    return VectorizePageUseCase(
        chunker_service=chunker,
        normalizer_service=normalizer,
        vectorization_repository=vec_repo,
        vector_store_repository=store,
    ), chunker, normalizer, vec_repo, store


def _payload(contents: list[ContentBlockSchema]) -> VectorizationRequestSchema:
    return VectorizationRequestSchema(
        pageId=PAGE_ID, workspaceId=WS_ID, title='T', pageType='TEXT',
        contents=contents,
    )


@pytest.mark.asyncio
async def test_deletes_before_indexing() -> None:
    uc, *_, store = _make_use_case()
    await uc(_payload([ContentBlockSchema(blockNumber=0, content='hello')]))
    store.delete_by_page.assert_awaited_once_with(str(PAGE_ID))


@pytest.mark.asyncio
async def test_empty_contents_still_deletes() -> None:
    uc, *_, store = _make_use_case()
    result = await uc(_payload([]))
    store.delete_by_page.assert_awaited_once()
    store.upsert_chunks.assert_awaited_once_with([])
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0


@pytest.mark.asyncio
async def test_skips_block_with_no_chunks() -> None:
    uc, chunker, *_, store = _make_use_case(split_return=lambda t: [])
    result = await uc(_payload([ContentBlockSchema(blockNumber=2, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 1
    store.upsert_chunks.assert_awaited_once_with([])


@pytest.mark.asyncio
async def test_skips_chunks_that_normalize_to_empty() -> None:
    uc, *_, store = _make_use_case(
        split_return=lambda t: ['chunk'], normalize_return='',
    )
    result = await uc(_payload([ContentBlockSchema(blockNumber=0, content='x')]))
    assert result.indexedChunks == 0
    assert result.skippedBlocks == 0  # не пустой блок, просто чанки ушли на ноль


@pytest.mark.asyncio
async def test_upserts_with_expected_metadata() -> None:
    uc, chunker, normalizer, vec_repo, store = _make_use_case()
    chunker.split = MagicMock(side_effect=lambda t: ['raw chunk'])
    normalizer.normalize = MagicMock(return_value='norm text')

    await uc(_payload([ContentBlockSchema(blockNumber=5, content='ignored')]))

    # vec_repo.embed called with NORMALIZED text, not raw
    vec_repo.embed.assert_awaited_once_with('norm text')

    # store.upsert_chunks got a single point with the RAW chunk in metadata
    args, _ = store.upsert_chunks.call_args
    points = args[0]
    assert len(points) == 1
    pid, vector, payload_meta = points[0]
    assert payload_meta == {
        'pageId': str(PAGE_ID),
        'workspaceId': str(WS_ID),
        'title': 'T',
        'pageType': 'TEXT',
        'blockNumber': 5,
        'content': 'raw chunk',  # raw, pre-normalization
    }


@pytest.mark.asyncio
async def test_point_id_is_deterministic() -> None:
    a = VectorizePageUseCase._point_id(PAGE_ID, 3, 1)
    b = VectorizePageUseCase._point_id(PAGE_ID, 3, 1)
    c = VectorizePageUseCase._point_id(PAGE_ID, 3, 2)
    assert a == b
    assert a != c
```

Ensure `apps/agents/tests/apps/processing/__init__.py` and `apps/agents/tests/apps/__init__.py` exist.

- [ ] **Step 2: Run — should fail**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vectorize_page.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement VectorizePageUseCase**

Create `apps/agents/agents/apps/processing/use_cases/vectorize_page.py`:

```python
from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from uuid import UUID

from ..repositories import VectorStoreRepository, VectorizationRepository
from ..schemas import (
    VectorizationRequestSchema, VectorizationResponseSchema,
)
from ..services import ChunkerService, NormalizerService


@dataclass
class VectorizePageUseCase:
    chunker_service: ChunkerService
    normalizer_service: NormalizerService
    vectorization_repository: VectorizationRepository
    vector_store_repository: VectorStoreRepository

    async def __call__(
        self, payload: VectorizationRequestSchema,
    ) -> VectorizationResponseSchema:
        # 1. Идемпотентность: удаляем все точки этой страницы (reindex)
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

                payload_meta: dict[str, Any] = {
                    'pageId': str(payload.pageId),
                    'workspaceId': str(payload.workspaceId),
                    'title': payload.title,
                    'pageType': payload.pageType,
                    'blockNumber': block.blockNumber,
                    'content': raw_chunk,  # raw chunk до нормализации
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
        """Стабильный UUID из (pageId, blockNumber, chunkIdx) — Qdrant upsert
        по id делает retry полностью идемпотентным."""
        h = sha256(f'{page_id}:{block_number}:{chunk_idx}'.encode()).hexdigest()
        return str(UUID(h[:32]))
```

Replace `apps/agents/agents/apps/processing/use_cases/__init__.py`:

```python
from .vectorize_page import VectorizePageUseCase

__all__ = ['VectorizePageUseCase']
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vectorize_page.py -v
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/use_cases/ apps/agents/tests/apps/processing/test_vectorize_page.py
git commit -m "feat(agents): add VectorizePageUseCase with TDD pipeline"
```

---

### Task 10: Replace Router — POST /vectorization

**Files:**
- Modify: `apps/agents/agents/apps/processing/router.py` (replace content)

- [ ] **Step 1: Replace router.py**

Replace `apps/agents/agents/apps/processing/router.py`:

```python
"""POST /vectorization route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import VectorizationRequestSchema, VectorizationResponseSchema
from .use_cases import VectorizePageUseCase

router = APIRouter(prefix='/vectorization', tags=['Vectorization'])


@router.post('', response_model=VectorizationResponseSchema)
@inject
async def vectorize(
    payload: VectorizationRequestSchema,
    use_case: FromDishka[VectorizePageUseCase],
) -> VectorizationResponseSchema:
    return await use_case(payload)
```

- [ ] **Step 2: Verify routes load**

```bash
cd apps/agents && uv run python -c "
from agents.bootstrap import create_app
from agents.router import apply_routes
app = create_app([apply_routes])
routes = [r.path for r in app.routes]
assert '/vectorization' in routes, routes
print('OK')
"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/processing/router.py
git commit -m "feat(agents): replace /processing/normalize with POST /vectorization"
```

---

### Task 11: Remove old NormalizeTextUseCase + dead normalize code

**Files:**
- Delete: `apps/agents/agents/apps/processing/use_cases/normalize_text.py`

- [ ] **Step 1: Delete the old use case**

```bash
rm apps/agents/agents/apps/processing/use_cases/normalize_text.py
```

The updated `use_cases/__init__.py` (from Task 9) already drops the import. Verify:

```bash
grep -rn "NormalizeTextUseCase" apps/agents/agents/ 2>/dev/null
```

Expected: no matches.

- [ ] **Step 2: Smoke test imports**

```bash
cd apps/agents && uv run python -c "from agents.apps.processing import router; print(router.router.prefix)"
```

Expected: `/vectorization`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/processing/use_cases/
git commit -m "refactor(agents): remove NormalizeTextUseCase"
```

---

### Task 12: Update Dishka provider for processing

**Files:**
- Modify: `apps/agents/agents/apps/processing/depends.py` (replace content)

- [ ] **Step 1: Replace depends.py**

Replace `apps/agents/agents/apps/processing/depends.py`:

```python
"""Dishka providers for the processing (vectorization) application."""

from __future__ import annotations

from dishka import Provider, Scope, provide

from .repositories import VectorStoreRepository, VectorizationRepository
from .services import ChunkerService, LanguageDetectorService, NormalizerService
from .use_cases import VectorizePageUseCase


class ProcessingProvider(Provider):
    scope = Scope.REQUEST

    chunker_service = provide(ChunkerService, scope=Scope.APP)
    language_detector_service = provide(LanguageDetectorService, scope=Scope.APP)
    normalizer_service = provide(NormalizerService, scope=Scope.APP)

    vectorization_repository = provide(VectorizationRepository)
    vector_store_repository = provide(VectorStoreRepository)

    vectorize_page_use_case = provide(VectorizePageUseCase)


provider = ProcessingProvider()
```

- [ ] **Step 2: Smoke test container builds**

```bash
cd apps/agents && uv run python -c "
from agents.bootstrap import create_app
from agents.router import apply_routes
app = create_app([apply_routes])
print('OK', app.title)
"
```

Expected: `OK <title>`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/processing/depends.py
git commit -m "feat(agents): wire ProcessingProvider with new repositories + use case"
```

---

### Task 13: Bootstrap — ensure Qdrant collection on startup

**Files:**
- Modify: `apps/agents/agents/bootstrap.py`

- [ ] **Step 1: Update lifespan to call ensure_collection**

Edit `apps/agents/agents/bootstrap.py` — replace the `lifespan` function:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Предварительная инициализация приложения.

    - устанавливаем настройки логгирования
    - устанавливаем настройки кеширования
    - устанавливаем настройки стриминга
    - создаём qdrant-коллекцию `pages`, если её ещё нет
    """
    from agents.apps.processing.repositories import VectorStoreRepository
    container = ContainerManager.container
    if container is not None:
        async with container() as req:
            vsr = await req.get(VectorStoreRepository)
            await vsr.ensure_collection()

    yield

    await ContainerManager.close()
```

Note: the import is kept inside the function to avoid a circular import at module load.

- [ ] **Step 2: Smoke test startup (requires running Qdrant on localhost:6333)**

Start docker compose (if not running):
```bash
docker compose up -d
```

Then:
```bash
cd apps/agents && uv run python -c "
import asyncio
from agents.bootstrap import create_app, lifespan
from agents.router import apply_routes
from fastapi import FastAPI

async def run():
    app = create_app([apply_routes])
    async with lifespan(app):
        import httpx
        async with httpx.AsyncClient() as c:
            r = await c.get('http://localhost:6333/collections/pages')
            print(r.status_code, r.json())

asyncio.run(run())
"
```

Expected: status 200, collection `pages` exists with cosine distance and 768 dims.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/bootstrap.py
git commit -m "feat(agents): ensure qdrant `pages` collection on startup"
```

---

### Task 14: Integration test for /vectorization (real Qdrant + Ollama)

**Files:**
- Create: `apps/agents/tests/apps/processing/test_vectorization_integration.py`

- [ ] **Step 1: Write integration test**

Create `apps/agents/tests/apps/processing/test_vectorization_integration.py`:

```python
"""Integration test — requires docker compose running (Qdrant on 6333, Ollama on 11434
with nomic-embed-text pulled)."""

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from agents.bootstrap import create_app
from agents.router import apply_routes


@pytest.mark.integration
def test_vectorization_end_to_end() -> None:
    app = create_app([apply_routes])
    with TestClient(app) as client:  # runs lifespan → ensures collection
        page_id = str(uuid4())
        ws_id = str(uuid4())
        payload = {
            'pageId': page_id,
            'workspaceId': ws_id,
            'title': 'Integration Test',
            'pageType': 'TEXT',
            'contents': [
                {'blockNumber': 0, 'content': 'Корпоративный кофе называется «Бразильский Медведь».'},
                {'blockNumber': 1, 'content': ''},  # must be rejected by schema min_length=1
            ],
        }
        # Remove the empty block — schema rejects min_length=1
        payload['contents'] = payload['contents'][:1]

        res = client.post('/vectorization', json=payload)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body['indexedChunks'] >= 1
        assert body['skippedBlocks'] == 0

        # Second call — should be idempotent (same result, no duplicate points)
        res2 = client.post('/vectorization', json=payload)
        assert res2.status_code == 200
        assert res2.json()['indexedChunks'] == body['indexedChunks']
```

- [ ] **Step 2: Run integration test**

Ensure docker services are up and `ollama pull nomic-embed-text` has been executed previously:

```bash
cd apps/agents && uv run pytest tests/apps/processing/test_vectorization_integration.py -v -m integration
```

Expected: 1 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/tests/apps/processing/test_vectorization_integration.py
git commit -m "test(agents): integration test for POST /vectorization"
```

---

### Phase 1 Completion

- [ ] **Run full agents test suite**

```bash
cd apps/agents && uv run pytest -v
```

Expected: all green (except `integration`-marked if services are down).

- [ ] **Optional: test from apps/engines (not yet switched, should still work with old /processing/normalize until Phase 5)**

No action needed — old `/processing/normalize` was already removed in Task 10. **Engines will now start failing `IndexingProcessor` calls** — this is expected and resolved in Phase 5. If running locally and you want a green engines, skip to Phase 5 first OR roll back Task 11 temporarily. For CI, tag this phase with the expected downstream breakage.

**Note for execution:** if the user wants engines to stay green during Phase 1→5 work, modify Task 10/11 to leave `/processing/normalize` alongside `/vectorization` as a no-op 410 Gone, and only remove it in Phase 5. The plan as written assumes a fast sequential execution from Phase 1 to Phase 5.

---

## Phase 2 — apps/agents: RAG retrieval in LangGraph + template

### Task 15: Update RagDocumentSchema shape

**Files:**
- Modify: `apps/agents/agents/apps/chat/schemas.py:32-78` (the `RagDocumentSchema` block)

- [ ] **Step 1: Replace RagDocumentSchema**

In `apps/agents/agents/apps/chat/schemas.py`, replace the `RagDocumentSchema` class (and keep `RagDocumentsSchema` with new field types):

```python
class RagDocumentSchema(RequestResponseSchema):
    page_id: UUID
    """
    PageId идентификатор документа
    """
    workspace_id: UUID
    """
    WorkspaceId идентификатор рабочего пространства.
    """
    title: str
    """
    Заголовок документа.
    """
    page_type: str
    """
    Тип страницы.
    """
    block_number: int
    """
    Порядковый номер блока на странице.
    """
    content: str
    """
    Текст контента (исходный чанк до нормализации).
    """


class RagDocumentsSchema(RequestResponseSchema):
    documents: Annotated[list[RagDocumentSchema], Field(default_factory=list)]
```

Remove fields: `chunk_index`, `created_by_id`, `created_at`, `updated_at`. Also remove `from datetime import datetime` if `datetime` is no longer used in the file.

- [ ] **Step 2: Verify imports still valid**

```bash
cd apps/agents && uv run python -c "from agents.apps.chat.schemas import RagDocumentSchema, RagDocumentsSchema, QueryRequestSchema; print('OK')"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/chat/schemas.py
git commit -m "feat(agents): update RagDocumentSchema to block-anchor shape"
```

---

### Task 16: RagRetrievalService

**Files:**
- Create: `apps/agents/agents/apps/chat/services/rag_retrieval.py`
- Create: `apps/agents/tests/apps/chat/services/test_rag_retrieval.py`
- Modify: `apps/agents/agents/apps/chat/services/__init__.py`

- [ ] **Step 1: Write failing tests**

Create `apps/agents/tests/apps/chat/services/__init__.py` (empty) and `apps/agents/tests/apps/chat/__init__.py` (empty) if missing.

Create `apps/agents/tests/apps/chat/services/test_rag_retrieval.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from langchain_core.documents import Document

from agents.apps.chat.services.rag_retrieval import RagRetrievalService


WS_ID = UUID('00000000-0000-0000-0000-000000000001')


def _doc(page_id: str, block_number: int, content: str = 'x') -> Document:
    return Document(page_content=content, metadata={
        'pageId': page_id,
        'workspaceId': str(WS_ID),
        'title': 'Title',
        'pageType': 'TEXT',
        'blockNumber': block_number,
        'content': content,
    })


def _make_service(retriever_docs: list[Document]) -> RagRetrievalService:
    retriever = MagicMock()
    retriever.ainvoke = AsyncMock(return_value=retriever_docs)
    store = MagicMock()
    store.as_retriever = MagicMock(return_value=retriever)
    return RagRetrievalService(vector_store_repository=store)


@pytest.mark.asyncio
async def test_empty_query_returns_empty() -> None:
    svc = _make_service([])
    assert await svc.retrieve(WS_ID, '') == []
    assert await svc.retrieve(WS_ID, '   ') == []


@pytest.mark.asyncio
async def test_dedupes_by_page_and_block() -> None:
    docs = [
        _doc('page-a', 0), _doc('page-a', 0),  # dupe
        _doc('page-a', 1), _doc('page-b', 0),
    ]
    svc = _make_service(docs)
    result = await svc.retrieve(WS_ID, 'q', k=5)
    assert len(result) == 3
    keys = {(str(d.page_id), d.block_number) for d in result}
    assert keys == {('page-a', 0), ('page-a', 1), ('page-b', 0)}


@pytest.mark.asyncio
async def test_respects_k_limit() -> None:
    docs = [_doc(f'page-{i}', 0) for i in range(10)]
    svc = _make_service(docs)
    result = await svc.retrieve(WS_ID, 'q', k=3)
    assert len(result) == 3


@pytest.mark.asyncio
async def test_overfetches_k_times_3() -> None:
    docs: list[Document] = []
    svc = _make_service(docs)
    store = svc.vector_store_repository
    await svc.retrieve(WS_ID, 'q', k=5)
    store.as_retriever.assert_called_once()
    _, kwargs = store.as_retriever.call_args
    # workspace_id kwarg + k=15 (overfetch = k*3)
    assert kwargs['workspace_id'] == str(WS_ID)
    assert kwargs['k'] == 15
```

- [ ] **Step 2: Run — should fail**

```bash
cd apps/agents && uv run pytest tests/apps/chat/services/test_rag_retrieval.py -v
```

Expected: ImportError.

- [ ] **Step 3: Implement service**

Create `apps/agents/agents/apps/chat/services/rag_retrieval.py`:

```python
from dataclasses import dataclass
from uuid import UUID

from langchain_core.documents import Document

from agents.apps.processing.repositories import VectorStoreRepository

from ..schemas import RagDocumentSchema


@dataclass
class RagRetrievalService:
    """Поиск top-K релевантных чанков из Qdrant с dedup по (pageId, blockNumber)."""

    vector_store_repository: VectorStoreRepository

    async def retrieve(
        self, workspace_id: UUID, query: str, k: int = 5,
    ) -> list[RagDocumentSchema]:
        if not query.strip():
            return []
        retriever = self.vector_store_repository.as_retriever(
            workspace_id=str(workspace_id), k=k * 3,
        )
        docs = await retriever.ainvoke(query)
        return self._dedupe(docs, k)

    @staticmethod
    def _dedupe(docs: list[Document], k: int) -> list[RagDocumentSchema]:
        seen: set[tuple[str, int]] = set()
        result: list[RagDocumentSchema] = []
        for d in docs:
            key = (d.metadata['pageId'], d.metadata['blockNumber'])
            if key in seen:
                continue
            seen.add(key)
            result.append(RagDocumentSchema(
                page_id=UUID(d.metadata['pageId']),
                workspace_id=UUID(d.metadata['workspaceId']),
                title=d.metadata['title'],
                page_type=d.metadata['pageType'],
                block_number=d.metadata['blockNumber'],
                content=d.metadata['content'],
            ))
            if len(result) >= k:
                break
        return result
```

Update `apps/agents/agents/apps/chat/services/__init__.py`:

```python
from .graph import GraphService
from .rag_retrieval import RagRetrievalService

__all__ = ['GraphService', 'RagRetrievalService']
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/chat/services/test_rag_retrieval.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/chat/services/rag_retrieval.py apps/agents/agents/apps/chat/services/__init__.py apps/agents/tests/apps/chat/
git commit -m "feat(agents): add RagRetrievalService with pageId/blockNumber dedup"
```

---

### Task 17: Update default.j2 template — citation with block anchor

**Files:**
- Modify: `apps/agents/agents/apps/chat/templates/default.j2`

- [ ] **Step 1: Replace the `## Retrieved context` block**

In `apps/agents/agents/apps/chat/templates/default.j2`, replace lines from `{% if rag and rag.documents -%}` to the matching `{% endif -%}` with:

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

Leave the TOOLS, TASK, OUTPUT sections untouched.

- [ ] **Step 2: Verify template loads**

```bash
cd apps/agents && uv run python -c "
from jinja2 import Environment, FileSystemLoader
from os.path import join
env = Environment(loader=FileSystemLoader(join('agents', 'apps', 'chat', 'templates')))
tpl = env.get_template('default.j2')
print(tpl.render(
    model={'name': 'm'}, thread_id='t',
    system_prompt='', instruction={'format': 'md', 'language': 'ru'},
    query='q', messages=[], mcp_servers=[],
    rag={'documents': [{
        'page_id': 'p1', 'workspace_id': 'w1', 'block_number': 2,
        'title': 'T', 'page_type': 'TEXT', 'content': 'abc',
    }]},
)[:500])
"
```

Expected: output contains `/workspaces/{workspaceId}/pages/{pageId}#{blockNumber}` literal and document metadata.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/chat/templates/default.j2
git commit -m "feat(agents): update default.j2 citation format with block anchor"
```

---

### Task 18: JinjaRendererRepository — add rag_documents parameter

**Files:**
- Modify: `apps/agents/agents/apps/chat/repositories/jinja_renderer.py`
- Create: `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/apps/chat/repositories/__init__.py` (empty) if missing.

Create `apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py`:

```python
from unittest.mock import MagicMock
from uuid import UUID

from agents.apps.chat.repositories.jinja_renderer import JinjaRendererRepository
from agents.apps.chat.schemas import (
    InstructionRequestSchema, ModelConfigSchema, ModelConnectionSchema,
    ModelSettingsSchema, QueryRequestSchema, RagDocumentSchema,
)


def _payload() -> QueryRequestSchema:
    return QueryRequestSchema(
        thread_id=UUID('00000000-0000-0000-0000-000000000001'),
        model=ModelConfigSchema(
            provider='ollama',  # type: ignore[arg-type]
            name='test',
            connection=ModelConnectionSchema(),
            settings=ModelSettingsSchema(),
        ),
        system_prompt='',
        instruction=InstructionRequestSchema(
            format='markdown', language='ru', citations_required=True,
        ),
        messages=[], rag=None, mcp=None, query='test query',
    )


def _settings() -> MagicMock:
    s = MagicMock()
    s.base_dir = __import__('os').path.abspath(
        __import__('os').path.join(__file__, '..', '..', '..', '..', '..')
    )  # apps/agents/
    return s


def test_render_with_rag_documents_has_anchor_link() -> None:
    renderer = JinjaRendererRepository(_settings())
    docs = [RagDocumentSchema(
        page_id=UUID('00000000-0000-0000-0000-000000000002'),
        workspace_id=UUID('00000000-0000-0000-0000-000000000003'),
        title='Cafe', page_type='TEXT', block_number=7, content='coffee details',
    )]
    result = renderer.render(_payload(), [], docs)
    assert '/workspaces/' in result
    assert '/pages/' in result
    assert '#{blockNumber}' in result  # literal shown to the model as template
    assert 'coffee details' in result
    assert 'blockNumber: 7' in result


def test_render_without_rag_omits_retrieved_context() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.render(_payload(), [], [])
    assert '## Retrieved context' not in result


def test_render_still_renders_tools_section() -> None:
    renderer = JinjaRendererRepository(_settings())
    result = renderer.render(_payload(), [], [])
    assert 'getPageMarkdown' in result
```

- [ ] **Step 2: Run — should fail (signature mismatch)**

```bash
cd apps/agents && uv run pytest tests/apps/chat/repositories/test_jinja_renderer.py -v
```

Expected: FAIL — `render()` currently takes 2 args, not 3.

- [ ] **Step 3: Update JinjaRendererRepository**

Replace `apps/agents/agents/apps/chat/repositories/jinja_renderer.py`:

```python
from __future__ import annotations

from os.path import join

from jinja2 import Environment, FileSystemLoader

from agents.settings import SettingsSchema

from ..schemas import McpServerToolsSchema, QueryRequestSchema, RagDocumentSchema


class JinjaRendererRepository:
    """Render the default Jinja prompt for chat payloads."""

    TEMPLATE_NAME = 'default.j2'

    def __init__(self, settings: SettingsSchema) -> None:
        path = join(settings.base_dir, 'agents', 'apps', 'chat', 'templates')
        self.environment = Environment(loader=FileSystemLoader(path))

    def render(
        self,
        context: QueryRequestSchema,
        mcp_servers: list[McpServerToolsSchema],
        rag_documents: list[RagDocumentSchema],
    ) -> str:
        template = self.environment.get_template(self.TEMPLATE_NAME)
        rag_payload = None
        if rag_documents:
            rag_payload = {
                'documents': [d.model_dump(mode='json') for d in rag_documents]
            }
        context_data = context.model_dump(mode='json')
        # Override payload.rag with the retrieval result (source of truth at render time)
        context_data['rag'] = rag_payload
        return template.render(**{
            **context_data,
            'mcp_servers': mcp_servers,
        })
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/chat/repositories/test_jinja_renderer.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/chat/repositories/jinja_renderer.py apps/agents/tests/apps/chat/repositories/test_jinja_renderer.py
git commit -m "feat(agents): JinjaRendererRepository accepts explicit rag_documents"
```

---

### Task 19: Inject RagRetrievalService into GraphService

**Files:**
- Modify: `apps/agents/agents/apps/chat/services/graph.py`

- [ ] **Step 1: Update GraphService signature and prepare_prompt**

In `apps/agents/agents/apps/chat/services/graph.py`:

1. Add import at top:
```python
from .rag_retrieval import RagRetrievalService
```

2. Change the `GraphService` dataclass:
```python
@dataclass
class GraphService:
    jinja_repository: JinjaRendererRepository
    mcp_tools_repository: McpToolsRepository
    model_factory_repository: ModelFactoryRepository
    rag_retrieval_service: RagRetrievalService
    checkpointer: AsyncPostgresSaver
```

3. Update `prepare_prompt` — after the existing MCP-tools block and before `messages: list[BaseMessage]`, add RAG retrieval:
```python
        rag_documents = await self.rag_retrieval_service.retrieve(
            workspace_id=state.user_context.x_workspace_id,
            query=payload.query,
            k=5,
        )
```

4. Change the `system_prompt = self.jinja_repository.render(...)` call to:
```python
        system_prompt = self.jinja_repository.render(
            state.payload, mcp_server_tools, rag_documents,
        )
```

- [ ] **Step 2: Write a test for the graph prepare_prompt wiring**

Create `apps/agents/tests/apps/chat/services/test_graph.py`:

```python
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from agents.apps.chat.services.graph import GraphService
from agents.apps.chat.schemas import (
    GraphStateSchema, InstructionRequestSchema, ModelConfigSchema,
    ModelConnectionSchema, ModelSettingsSchema, QueryRequestSchema,
    RuntimeContext, UserContextSchema,
)


@pytest.mark.asyncio
async def test_prepare_prompt_invokes_retrieval_and_render() -> None:
    jinja = MagicMock()
    jinja.render = MagicMock(return_value='SYSTEM')
    mcp = MagicMock()
    mcp.fetch_mcp_tools = AsyncMock(return_value=([], []))
    retrieval = MagicMock()
    retrieval.retrieve = AsyncMock(return_value=[])

    svc = GraphService(
        jinja_repository=jinja,
        mcp_tools_repository=mcp,
        model_factory_repository=MagicMock(),
        rag_retrieval_service=retrieval,
        checkpointer=MagicMock(),
    )

    ws_id = UUID('00000000-0000-0000-0000-000000000001')
    user_id = UUID('00000000-0000-0000-0000-000000000002')
    payload = QueryRequestSchema(
        thread_id=UUID('00000000-0000-0000-0000-000000000003'),
        model=ModelConfigSchema(
            provider='ollama', name='x',  # type: ignore[arg-type]
            connection=ModelConnectionSchema(), settings=ModelSettingsSchema(),
        ),
        system_prompt='', instruction=InstructionRequestSchema(
            format='markdown', language='ru', citations_required=True,
        ),
        messages=[], rag=None, mcp=None, query='ping',
    )
    state = GraphStateSchema(
        system_prompt='', payload=payload,
        user_context=UserContextSchema(x_user_id=user_id, x_workspace_id=ws_id),
        messages=[], tools=[], response_text='',
    )

    new_state = await svc.prepare_prompt(RuntimeContext(), state)

    retrieval.retrieve.assert_awaited_once_with(
        workspace_id=ws_id, query='ping', k=5,
    )
    jinja.render.assert_called_once()
    assert new_state.system_prompt == 'SYSTEM'
```

- [ ] **Step 3: Run tests — should pass**

```bash
cd apps/agents && uv run pytest tests/apps/chat/services/test_graph.py -v
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/chat/services/graph.py apps/agents/tests/apps/chat/services/test_graph.py
git commit -m "feat(agents): inject RagRetrievalService into GraphService"
```

---

### Task 20: Wire RagRetrievalService in chat Dishka provider

**Files:**
- Modify: `apps/agents/agents/apps/chat/depends.py`

- [ ] **Step 1: Add provider registration**

In `apps/agents/agents/apps/chat/depends.py`, add import:

```python
from .services import GraphService, RagRetrievalService
```

And inside the `ChatProvider` class, add:

```python
    rag_retrieval_service = provide(RagRetrievalService)
```

Place it anywhere inside the class body alongside the other `provide(...)` lines.

- [ ] **Step 2: Smoke test container builds**

```bash
cd apps/agents && uv run python -c "
from agents.bootstrap import create_app
from agents.router import apply_routes
app = create_app([apply_routes])
print('OK')
"
```

Expected: `OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/agents/apps/chat/depends.py
git commit -m "feat(agents): register RagRetrievalService in ChatProvider"
```

---

### Phase 2 Completion

- [ ] **Run full agents test suite**

```bash
cd apps/agents && uv run pytest -v -m "not integration"
```

Expected: all green.

---

## Phase 3 — apps/yjs: outbox + Excalidraw snapshot + atomic tx

### Task 21: Add jest scaffolding to apps/yjs

**Files:**
- Modify: `apps/yjs/package.json`
- Create: `apps/yjs/jest.config.ts`
- Create: `apps/yjs/jest.setup.cjs`

- [ ] **Step 1: Update package.json**

Edit `apps/yjs/package.json`. Add to `scripts`:

```json
    "test": "NODE_OPTIONS=--experimental-vm-modules jest"
```

Add to `devDependencies`:

```json
    "@jest/globals": "^29.7.0",
    "@types/jest": "^29.5.14",
    "jest": "^29.7.0",
    "ts-jest": "^29.2.5"
```

- [ ] **Step 2: Create jest.config.ts**

Create `apps/yjs/jest.config.ts` (copy engines pattern):

```ts
import type { Config } from "jest"

const config: Config = {
  preset: "ts-jest/presets/default-esm",
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { useESM: true, tsconfig: "tsconfig.json" }],
  },
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@repo/db$": "<rootDir>/../../packages/db/src/index.ts",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.cjs"],
}

export default config
```

- [ ] **Step 3: Create jest.setup.cjs**

Create `apps/yjs/jest.setup.cjs` (empty or with env stubs):

```js
// yjs test setup
```

- [ ] **Step 4: Install**

```bash
pnpm install
```

Expected: lockfile updates, new packages added.

- [ ] **Step 5: Verify jest runs (no tests yet → exits 0 with "no tests")**

```bash
cd apps/yjs && pnpm test --passWithNoTests
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/yjs/package.json apps/yjs/jest.config.ts apps/yjs/jest.setup.cjs pnpm-lock.yaml
git commit -m "chore(yjs): add jest scaffolding"
```

---

### Task 22: canAccessPage returns workspaceId

**Files:**
- Modify: `apps/yjs/src/auth.ts`

- [ ] **Step 1: Replace canAccessPage function**

In `apps/yjs/src/auth.ts`, replace the existing `canAccessPage` function with:

```ts
export async function canAccessPage(
  userId: string,
  pageId: string,
): Promise<{ pageType: PageType; workspaceId: string } | null> {
  const page = await prisma.page.findFirst({
    where: {
      id: pageId,
      deletedAt: null,
      workspace: { members: { some: { userId } } },
    },
    select: { type: true, workspaceId: true },
  })
  return page ? { pageType: page.type, workspaceId: page.workspaceId } : null
}
```

Only the `select` clause and return object change — the `where` clause (workspace membership check) stays identical.

- [ ] **Step 2: Verify build**

```bash
cd apps/yjs && pnpm check-types
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/yjs/src/auth.ts
git commit -m "feat(yjs): canAccessPage returns workspaceId"
```

---

### Task 23: Add enqueueOutboxEventIgnoreConflict to @repo/db

**Files:**
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add the helper**

In `packages/db/src/index.ts`, after the existing `enqueueOutboxEvent` function, add:

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
       ${args.workspaceId ?? null}::uuid, ${JSON.stringify(args.payload ?? {})}::jsonb, 'PENDING', ${delaySql})
    ON CONFLICT DO NOTHING
  `)
}
```

- [ ] **Step 2: Build and verify export**

```bash
pnpm --filter @repo/db build
grep -c "enqueueOutboxEventIgnoreConflict" packages/db/dist/index.js
```

Expected: count ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/index.ts packages/db/dist/
git commit -m "feat(db): add enqueueOutboxEventIgnoreConflict with delayMs + ON CONFLICT DO NOTHING"
```

---

### Task 24: Write failing persistence tests

**Files:**
- Create: `apps/yjs/src/persistence.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/yjs/src/persistence.spec.ts`:

```ts
import { jest } from "@jest/globals"
import * as Y from "yjs"

// Mock @repo/db BEFORE importing persistence
const mockTxExecuteRaw = jest.fn<(sql: unknown) => Promise<number>>().mockResolvedValue(1)
const mockTxPageUpdate = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({})
const mockEnqueueOutboxEventIgnoreConflict = jest.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue()
const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  return fn({
    $executeRaw: mockTxExecuteRaw,
    page: { update: mockTxPageUpdate },
  })
})

jest.unstable_mockModule("@repo/db", () => ({
  prisma: { $transaction: mockTransaction },
  PageType: { TEXT: "TEXT", EXCALIDRAW: "EXCALIDRAW", GENOGRAM: "GENOGRAM" },
  Prisma: { sql: (s: TemplateStringsArray, ...v: unknown[]) => ({ s, v }) },
  enqueueOutboxEventIgnoreConflict: mockEnqueueOutboxEventIgnoreConflict,
}))

const { storePageDocument } = await import("./persistence.js")

beforeEach(() => {
  mockTxPageUpdate.mockClear()
  mockEnqueueOutboxEventIgnoreConflict.mockClear()
  mockTransaction.mockClear()
})

describe("storePageDocument", () => {
  it("TEXT: writes contentYjs + tiptap JSON + enqueues outbox with 5m delay", async () => {
    const doc = new Y.Doc()
    doc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")])
    await storePageDocument({
      pageId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      document: doc,
      pageType: "TEXT" as never,
    })
    expect(mockTxPageUpdate).toHaveBeenCalledTimes(1)
    const call = mockTxPageUpdate.mock.calls[0][0] as { data: { content: unknown; contentYjs: unknown } }
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(call.data.content).toBeDefined()

    expect(mockEnqueueOutboxEventIgnoreConflict).toHaveBeenCalledTimes(1)
    const outboxArgs = mockEnqueueOutboxEventIgnoreConflict.mock.calls[0][1] as {
      eventType: string; aggregateId: string; workspaceId: string; delayMs: number
    }
    expect(outboxArgs.eventType).toBe("page.upserted")
    expect(outboxArgs.aggregateId).toBe("00000000-0000-0000-0000-000000000001")
    expect(outboxArgs.workspaceId).toBe("00000000-0000-0000-0000-000000000002")
    expect(outboxArgs.delayMs).toBe(5 * 60 * 1000)
  })

  it("EXCALIDRAW: saves { elements } JSON to content + NO outbox", async () => {
    const doc = new Y.Doc()
    const yElements = doc.getArray<Y.Map<unknown>>("elements")
    const el = new Y.Map()
    el.set("type", "rectangle")
    yElements.insert(0, [el])

    await storePageDocument({
      pageId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      document: doc,
      pageType: "EXCALIDRAW" as never,
    })

    const call = mockTxPageUpdate.mock.calls[0][0] as { data: { content: { elements: unknown[] }; contentYjs: unknown } }
    expect(call.data.content).toEqual({ elements: [{ type: "rectangle" }] })
    expect(call.data.contentYjs).toBeInstanceOf(Uint8Array)
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })

  it("GENOGRAM: saves only contentYjs + NO outbox", async () => {
    const doc = new Y.Doc()
    await storePageDocument({
      pageId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      document: doc,
      pageType: "GENOGRAM" as never,
    })
    const call = mockTxPageUpdate.mock.calls[0][0] as { data: { content?: unknown } }
    expect(call.data.content).toBeUndefined()
    expect(mockEnqueueOutboxEventIgnoreConflict).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — should fail**

```bash
cd apps/yjs && pnpm test
```

Expected: FAIL — `storePageDocument` does not accept `workspaceId`, does not call `enqueueOutboxEventIgnoreConflict`, and does not serialize EXCALIDRAW `elements`.

---

### Task 25: Update storePageDocument implementation

**Files:**
- Modify: `apps/yjs/src/persistence.ts`

- [ ] **Step 1: Replace persistence.ts**

Replace `apps/yjs/src/persistence.ts`:

```ts
import {
  enqueueOutboxEventIgnoreConflict,
  PageType,
  Prisma,
  prisma,
} from "@repo/db"
import * as Y from "yjs"
import { TiptapTransformer } from "@hocuspocus/transformer"

import { log } from "./logger.js"

export async function loadPageDocument(pageId: string): Promise<Y.Doc> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { contentYjs: true },
  })
  const ydoc = new Y.Doc()
  if (page?.contentYjs) {
    Y.applyUpdate(ydoc, new Uint8Array(page.contentYjs))
  }
  return ydoc
}

export async function storePageDocument(args: {
  pageId: string
  workspaceId: string
  document: Y.Doc
  pageType: PageType
}): Promise<void> {
  const { pageId, workspaceId, document, pageType } = args
  const contentYjs = new Uint8Array(Y.encodeStateAsUpdate(document))

  const data: Prisma.PageUpdateInput = { contentYjs }

  if (pageType === PageType.TEXT) {
    try {
      data.content = TiptapTransformer.fromYdoc(document, "default") as Prisma.InputJsonValue
    } catch (err) {
      log.warn("tiptap transformer failed; saving contentYjs only", {
        pageId,
        error: (err as Error).message,
      })
    }
  } else if (pageType === PageType.EXCALIDRAW) {
    const yElements = document.getArray("elements")
    const snapshot = { elements: yElements.toJSON() }
    data.content = snapshot as Prisma.InputJsonValue
  }

  await prisma.$transaction(async (tx) => {
    await tx.page.update({ where: { id: pageId }, data })

    if (pageType === PageType.TEXT) {
      await enqueueOutboxEventIgnoreConflict(tx, {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: pageId,
        workspaceId,
        delayMs: 5 * 60 * 1000,
      })
    }
  })
}
```

- [ ] **Step 2: Run tests — should pass**

```bash
cd apps/yjs && pnpm test
```

Expected: 3 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/yjs/src/persistence.ts apps/yjs/src/persistence.spec.ts
git commit -m "feat(yjs): outbox insert + excalidraw snapshot + atomic tx"
```

---

### Task 26: AuthContext + onStoreDocument forwards workspaceId

**Files:**
- Modify: `apps/yjs/src/index.ts`

- [ ] **Step 1: Update AuthContext type and onStoreDocument call**

In `apps/yjs/src/index.ts`:

1. Change the `AuthContext` type:
```ts
type AuthContext = { userId: string; pageType: PageType; workspaceId: string }
```

2. In `onAuthenticate`, extract `workspaceId` from `canAccessPage` result:
```ts
const access = await canAccessPage(userId, documentName)
if (!access) {
  log.warn("page access denied", { userId, pageId: documentName })
  throw new Error("Forbidden")
}
log.info("authenticated", {
  userId, pageId: documentName, pageType: access.pageType, workspaceId: access.workspaceId,
})
const ctx: AuthContext = {
  userId, pageType: access.pageType, workspaceId: access.workspaceId,
}
return ctx
```

3. In `onStoreDocument`, pass `workspaceId`:
```ts
async onStoreDocument({ documentName, document, context }) {
  const { pageType, workspaceId } = context as AuthContext
  if (!pageType || !workspaceId) {
    throw new Error("missing pageType/workspaceId in onStoreDocument context")
  }
  await storePageDocument({ pageId: documentName, workspaceId, document, pageType })
},
```

- [ ] **Step 2: Type check**

```bash
cd apps/yjs && pnpm check-types
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/yjs/src/index.ts
git commit -m "feat(yjs): propagate workspaceId through AuthContext and onStoreDocument"
```

---

### Phase 3 Completion

- [ ] **Run yjs + db tests**

```bash
cd apps/yjs && pnpm test
pnpm --filter @repo/db check-types
```

Expected: all green.

---

## Phase 4 — client-side initial content loading

### Task 27: Return `contentYjs` base64 from tRPC page.getById

**Files:**
- Modify: `packages/trpc/src/routers/page.ts:72-102` (the `getById` procedure)

Current state: `getById` returns `Promise<Page>` — the Prisma `Page` type including `contentYjs: Bytes | null` (Buffer). We need to transform it to a base64 string for clean JSON transport and simple client decode via `atob`.

- [ ] **Step 1: Change the return type**

Edit the `getById` procedure. Replace its `.query(...)` body so the function returns a mapped object:

```ts
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const page = await ctx.prisma.page.findFirst({
        where: {
          id: input.id,
          workspace: { members: { some: { userId: ctx.user.id } } },
        },
        select: {
          id: true,
          workspaceId: true,
          parentId: true,
          type: true,
          ownership: true,
          title: true,
          icon: true,
          content: true,
          contentYjs: true,
          archived: true,
          prevPageId: true,
          deletedAt: true,
          createdById: true,
          updatedById: true,
          createdAt: true,
          updatedAt: true,
        },
      })
      if (!page) throw new TRPCError({ code: "NOT_FOUND", message: "Страница не найдена" })
      return {
        ...page,
        contentYjs: page.contentYjs
          ? Buffer.from(page.contentYjs).toString("base64")
          : null,
      }
    }),
```

Also drop the explicit `Promise<Page>` return-type annotation on the method signature (line 74) — the return shape now differs from `Page` (contentYjs is string, not Bytes).

- [ ] **Step 2: Build trpc + db consumers**

```bash
pnpm --filter @repo/trpc check-types
pnpm --filter web check-types
```

Expected: no type errors. Web already consumes `page.contentYjs` in Task 28 below, so the type change propagates automatically.

- [ ] **Step 3: Commit**

```bash
git add packages/trpc/src/routers/page.ts
git commit -m "feat(trpc): return contentYjs as base64 from page.getById"
```

---

### Task 28: PageRenderer passes initialContentYjs

**Files:**
- Modify: `apps/web/src/components/page/page-renderer.tsx` (update `PageInput` type + pass prop)
- Modify: `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx` (forward `contentYjs`)

- [ ] **Step 1: Extend PageInput and pass to children**

In `apps/web/src/components/page/page-renderer.tsx`, update the `PageInput` type:

```ts
type PageInput = {
  id: string
  type: PageType
  contentYjs: string | null
}
```

Then destructure it where `page.id`/`page.type` are used, and thread `page.contentYjs` into both the TEXT branch and the EXCALIDRAW branch:

```tsx
if (page.type === "EXCALIDRAW") {
  return (
    <Board
      pageId={page.id}
      initialContentYjs={page.contentYjs}
      yjsUrl={yjsUrl}
      yjsToken={fetchYjsToken}
      uploadHandler={uploadHandler}
      user={user}
    />
  )
}
```

```tsx
if (page.type === "TEXT") {
  return (
    <>
      <AnyNoteEditor
        pageId={page.id}
        workspaceId={workspaceId}
        initialContentYjs={page.contentYjs}
        yjsUrl={yjsUrl}
        yjsToken={fetchYjsToken}
        user={user}
        uploadHandler={uploadHandler}
        pageSearch={pageSearch}
        onNavigateToPage={onNavigateToPage}
        onReady={handleEditorReady}
        onRequestBlockMove={handleRequestBlockMove}
      />
      {/* BlockMoveDialog... existing */}
    </>
  )
}
```

- [ ] **Step 2: Update the RSC page to forward contentYjs**

In `apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx`, change the `<PageRenderer page={...} />` invocation to include `contentYjs`:

```tsx
<PageRenderer
  page={{ id: page.id, type: page.type, contentYjs: page.contentYjs }}
  workspaceId={workspaceId}
  user={{ id: session.user.id, name: displayName, color: colorFor(session.user.id) }}
/>
```

- [ ] **Step 3: Type check**

```bash
pnpm --filter web check-types
```

Expected: passes once the editor and Board components also accept the new prop (Tasks 29 and 30 immediately after — may fail until those are done. If blocking, make `initialContentYjs` optional in the type signature and ship Tasks 29/30 back-to-back in the same PR).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/page/page-renderer.tsx "apps/web/src/app/(protected)/workspaces/[workspaceId]/pages/[pageId]/page.tsx"
git commit -m "feat(web): thread contentYjs through PageRenderer to editor/board"
```

---

### Task 29: Seed Y.Doc in @repo/editor

**Files:**
- Modify: `packages/editor/src/types.ts` (add prop to `AnyNoteEditorProps`)
- Modify: `packages/editor/src/anynote-editor.tsx` (seed Y.Doc in useEffect)

- [ ] **Step 1: Add prop to AnyNoteEditorProps**

In `packages/editor/src/types.ts`, add `initialContentYjs` to `AnyNoteEditorProps`:

```ts
export type AnyNoteEditorProps = {
  pageId: string
  workspaceId: string
  initialContentYjs?: string | null
  yjsUrl: string
  yjsToken: () => Promise<string>
  user: AnyNoteEditorUser
  // ...existing fields
}
```

- [ ] **Step 2: Seed Y.Doc in useEffect**

In `packages/editor/src/anynote-editor.tsx`, modify the `AnyNoteEditor` component (outer function):

1. Destructure the new prop:
```tsx
const { pageId, yjsUrl, yjsToken, initialContentYjs } = props
```

2. Replace the useEffect body to apply the seed BEFORE creating the provider:
```tsx
useEffect(() => {
  const ydoc = new Y.Doc()
  if (initialContentYjs) {
    const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
    Y.applyUpdate(ydoc, bytes)
  }
  const provider = new HocuspocusProvider({
    url: yjsUrl,
    name: pageId,
    document: ydoc,
    token: yjsToken,
  })
  setResources({ ydoc, provider })
  return () => {
    setResources(null)
    setTimeout(() => {
      provider.destroy()
      ydoc.destroy()
    }, 300)
  }
}, [pageId, yjsUrl, yjsToken, initialContentYjs])
```

State-vector wiring: `Y.applyUpdate(ydoc, bytes)` replays the server-authored update with its original clientID → the server's sync-handshake sees the client is already at that vector and ships only the delta since.

- [ ] **Step 3: Verify build**

```bash
pnpm --filter @repo/editor check-types
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/editor/src/types.ts packages/editor/src/anynote-editor.tsx
git commit -m "feat(editor): seed Y.Doc from initialContentYjs before provider connects"
```

---

### Task 30: Seed Y.Doc in @repo/excalidraw

**Files:**
- Modify: `packages/excalidraw/src/use-excalidraw-yjs.ts`
- Modify: `packages/excalidraw/src/board.tsx` / `board-inner.tsx` / `types.ts` to accept the prop

- [ ] **Step 1: Add initialContentYjs to types**

In `packages/excalidraw/src/types.ts`, add to `BoardProps`:

```ts
initialContentYjs?: string | null
```

- [ ] **Step 2: Thread through Board → BoardInner**

In `packages/excalidraw/src/board.tsx`, pass it through `{...props}` (already does via spread). Verify in `board-inner.tsx` the prop is destructured.

- [ ] **Step 3: Seed Y.Doc in use-excalidraw-yjs**

In `packages/excalidraw/src/use-excalidraw-yjs.ts`, change the hook signature and useEffect:

```ts
export function useExcalidrawYjs(args: {
  pageId: string
  yjsUrl: string
  yjsToken: () => Promise<string>
  initialContentYjs?: string | null
}): YjsResources | null {
  const { pageId, yjsUrl, yjsToken, initialContentYjs } = args
  const [resources, setResources] = useState<YjsResources | null>(null)

  useEffect(() => {
    const ydoc = new Y.Doc()
    if (initialContentYjs) {
      const bytes = Uint8Array.from(atob(initialContentYjs), (c) => c.charCodeAt(0))
      Y.applyUpdate(ydoc, bytes)
    }
    const yElements = ydoc.getArray<Y.Map<unknown>>("elements")
    const yAssets = ydoc.getMap<unknown>("assets")
    const provider = new HocuspocusProvider({
      url: yjsUrl,
      name: pageId,
      document: ydoc,
      token: yjsToken,
    })
    setResources({ ydoc, provider, yElements, yAssets })
    return () => {
      setResources(null)
      setTimeout(() => {
        provider.destroy()
        ydoc.destroy()
      }, 300)
    }
  }, [pageId, yjsUrl, yjsToken, initialContentYjs])

  return resources
}
```

- [ ] **Step 4: Pass initialContentYjs from BoardInner**

In `packages/excalidraw/src/board-inner.tsx`, accept `initialContentYjs` via props and pass to the hook:

```tsx
const resources = useExcalidrawYjs({
  pageId, yjsUrl, yjsToken, initialContentYjs,
})
```

- [ ] **Step 5: Verify build**

```bash
pnpm --filter @repo/excalidraw check-types
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/excalidraw/
git commit -m "feat(excalidraw): seed Y.Doc from initialContentYjs before provider connects"
```

---

### Phase 4 Completion

- [ ] **Full type check across workspace**

```bash
pnpm check-types
```

Expected: all packages green.

---

## Phase 5 — apps/engines: slim down + new outbox→vectorization cron

### Task 31: Delete old indexer/search files

**Files (delete):**
- `apps/engines/src/apps/indexer/services/embedding-client.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/services/page-chunker.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/services/processing-client.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/queue/` (entire directory)
- `apps/engines/src/apps/indexer/cron/outbox-drainer.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/indexer/cron/outbox-cron.service.ts` (+ `.spec.ts`)
- `apps/engines/src/apps/search/` (entire directory)
- `apps/engines/src/infra/qdrant/` (entire directory)
- `apps/engines/src/infra/ollama/` (entire directory)

- [ ] **Step 1: Delete**

```bash
rm -rf \
  apps/engines/src/apps/indexer/services/embedding-client.service.ts \
  apps/engines/src/apps/indexer/services/embedding-client.service.spec.ts \
  apps/engines/src/apps/indexer/services/page-chunker.service.ts \
  apps/engines/src/apps/indexer/services/page-chunker.service.spec.ts \
  apps/engines/src/apps/indexer/services/processing-client.service.ts \
  apps/engines/src/apps/indexer/services/processing-client.service.spec.ts \
  apps/engines/src/apps/indexer/services/qdrant-writer.service.ts \
  apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts \
  apps/engines/src/apps/indexer/services/reindex-on-boot.service.ts \
  apps/engines/src/apps/indexer/services/reindex-on-boot.service.spec.ts \
  apps/engines/src/apps/indexer/queue \
  apps/engines/src/apps/indexer/cron/outbox-drainer.service.ts \
  apps/engines/src/apps/indexer/cron/outbox-drainer.service.spec.ts \
  apps/engines/src/apps/indexer/cron/outbox-cron.service.ts \
  apps/engines/src/apps/indexer/cron/outbox-cron.service.spec.ts \
  apps/engines/src/apps/search \
  apps/engines/src/infra/qdrant \
  apps/engines/src/infra/ollama
```

- [ ] **Step 2: Don't build yet** — `indexer.module.ts` is now broken. Tasks 32–35 fix it.

- [ ] **Step 3: Commit (partial breakage expected — build doesn't pass here)**

```bash
git add -A apps/engines/src/
git commit -m "refactor(engines): delete legacy indexer/search/qdrant/ollama modules"
```

Note: commit order matters for bisect; at this commit the module compile fails. The next tasks restore it.

---

### Task 32: Update engines package.json — drop deps

**Files:**
- Modify: `apps/engines/package.json`

- [ ] **Step 1: Remove deps**

Edit `apps/engines/package.json` `dependencies` and remove:
- `"@nestjs/bullmq"`
- `"bullmq"`
- `"ioredis"`
- `"@qdrant/js-client-rest"`

Keep `"axios"` for now — check Task 33 if it's actually used elsewhere.

- [ ] **Step 2: Check if axios is used elsewhere in engines**

```bash
grep -rn "from \"axios\"\|require(\"axios\")" apps/engines/src/ 2>/dev/null
```

If no hits remain after Task 31 deletions, also remove `"axios"` from dependencies.

- [ ] **Step 3: Install**

```bash
pnpm install
```

- [ ] **Step 4: Commit**

```bash
git add apps/engines/package.json pnpm-lock.yaml
git commit -m "chore(engines): drop bullmq/ioredis/qdrant-client/ollama/axios deps"
```

---

### Task 33: PageContentReader — block walking

**Files:**
- Create: `apps/engines/src/apps/indexer/services/page-content-reader.service.ts`
- Create: `apps/engines/src/apps/indexer/services/page-content-reader.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/apps/indexer/services/page-content-reader.service.spec.ts`:

```ts
import { describe, expect, it } from "@jest/globals"

import { PageContentReader, type TiptapNode } from "./page-content-reader.service.js"

describe("PageContentReader", () => {
  const reader = new PageContentReader()

  it("returns [] for null/undefined/non-doc", () => {
    expect(reader.blocksFromDoc(null as unknown as TiptapNode)).toEqual([])
    expect(reader.blocksFromDoc({ type: "paragraph" })).toEqual([])
  })

  it("collects text from a single paragraph", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 0, content: "Hello" },
    ])
  })

  it("preserves blockNumber even when some blocks are skipped", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        { type: "heading", content: [{ type: "text", text: "Title" }] },
        { type: "paragraph", content: [{ type: "text", text: "A" }] },
        { type: "image", attrs: {} },
        { type: "paragraph", content: [{ type: "text", text: "B" }] },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 1, content: "A" },
      { blockNumber: 3, content: "B" },
    ])
  })

  it("skips empty blocks", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        { type: "paragraph", content: [] },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
        { type: "paragraph", content: [{ type: "text", text: "hit" }] },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 2, content: "hit" },
    ])
  })

  it("recursively collects text from callout, skipping nested image/heading", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        {
          type: "callout",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "keep" }] },
            { type: "image", attrs: {} },
            { type: "heading", content: [{ type: "text", text: "drop" }] },
            { type: "paragraph", content: [{ type: "text", text: "also keep" }] },
          ],
        },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 0, content: "keep  also keep" },
    ])
  })

  it("joins inline text nodes with space", () => {
    const doc: TiptapNode = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "foo" },
            { type: "text", text: "bar" },
          ],
        },
      ],
    }
    expect(reader.blocksFromDoc(doc)).toEqual([
      { blockNumber: 0, content: "foo bar" },
    ])
  })
})
```

- [ ] **Step 2: Run — should fail**

```bash
cd apps/engines && pnpm test page-content-reader
```

Expected: FAIL — module missing.

- [ ] **Step 3: Implement PageContentReader**

Create `apps/engines/src/apps/indexer/services/page-content-reader.service.ts`:

```ts
import { Injectable } from "@nestjs/common"

export type TiptapNode = {
  type: string
  text?: string
  content?: TiptapNode[]
  [k: string]: unknown
}

const SKIP = new Set(["heading", "hiddenText", "image", "fileAttachment"])

@Injectable()
export class PageContentReader {
  blocksFromDoc(doc: TiptapNode | null | undefined): Array<{ blockNumber: number; content: string }> {
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
}

function collectText(node: TiptapNode): string {
  if (SKIP.has(node.type)) return ""
  if (node.type === "text") return node.text ?? ""
  if (!Array.isArray(node.content)) return ""
  return node.content.map(collectText).join(" ")
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/engines && pnpm test page-content-reader
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/services/page-content-reader.service.ts apps/engines/src/apps/indexer/services/page-content-reader.service.spec.ts
git commit -m "feat(engines): add PageContentReader (block-level text extraction)"
```

---

### Task 34: AgentsClient (HTTP to agents /vectorization)

**Files:**
- Create: `apps/engines/src/apps/indexer/services/agents-client.service.ts`
- Create: `apps/engines/src/apps/indexer/services/agents-client.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/apps/indexer/services/agents-client.service.spec.ts`:

```ts
import { describe, expect, it, jest, beforeEach, afterEach } from "@jest/globals"

import { AgentsClient } from "./agents-client.service.js"

describe("AgentsClient", () => {
  const originalFetch = globalThis.fetch
  beforeEach(() => {
    process.env.AGENTS_SERVICE_URL = "http://agents:8080"
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("POSTs payload to /vectorization and resolves on 2xx", async () => {
    const mockFetch = jest.fn(async () => new Response("{}", { status: 200 }))
    globalThis.fetch = mockFetch as unknown as typeof fetch
    const client = new AgentsClient()
    await client.vectorize({
      pageId: "p", workspaceId: "w", title: "", pageType: "TEXT", contents: [],
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("http://agents:8080/vectorization")
    expect(init.method).toBe("POST")
  })

  it("throws on 5xx with readable message", async () => {
    globalThis.fetch = jest.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    const client = new AgentsClient()
    await expect(
      client.vectorize({ pageId: "p", workspaceId: "w", title: "", pageType: "TEXT", contents: [] })
    ).rejects.toThrow(/500.*boom/)
  })
})
```

- [ ] **Step 2: Run — should fail**

```bash
cd apps/engines && pnpm test agents-client
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/services/agents-client.service.ts`:

```ts
import { Injectable } from "@nestjs/common"

export type VectorizationPayload = {
  pageId: string
  workspaceId: string
  title: string
  pageType: string
  contents: Array<{ blockNumber: number; content: string }>
}

@Injectable()
export class AgentsClient {
  private readonly baseUrl: string
  private readonly timeoutMs = 30_000

  constructor() {
    this.baseUrl = process.env.AGENTS_SERVICE_URL ?? "http://localhost:8080"
  }

  async vectorize(payload: VectorizationPayload): Promise<void> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(`${this.baseUrl}/vectorization`, {
        method: "POST",
        headers: { "content-type": "application/json" },
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
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd apps/engines && pnpm test agents-client
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/services/agents-client.service.ts apps/engines/src/apps/indexer/services/agents-client.service.spec.ts
git commit -m "feat(engines): add AgentsClient for /vectorization HTTP calls"
```

---

### Task 35: VectorizationCronService + new IndexerModule

**Files:**
- Create: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`
- Create: `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts`
- Replace: `apps/engines/src/apps/indexer/indexer.module.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/apps/indexer/cron/vectorization-cron.service.spec.ts`:

```ts
import { describe, expect, it, jest } from "@jest/globals"

import { AgentsClient } from "../services/agents-client.service.js"
import { PageContentReader } from "../services/page-content-reader.service.js"
import { VectorizationCronService } from "./vectorization-cron.service.js"

function makePrismaMock(opts: { rows: unknown[]; page: unknown }) {
  const executeRaw = jest.fn(async () => 1)
  const findUnique = jest.fn(async () => opts.page)
  const queryRaw = jest.fn(async () => opts.rows)
  const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw }
  const transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx))
  return {
    $transaction: transaction,
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    page: { findUnique },
    __mocks: { executeRaw, findUnique, queryRaw, transaction },
  }
}

describe("VectorizationCronService", () => {
  it("no-op when no rows", async () => {
    const prisma = makePrismaMock({ rows: [], page: null })
    const agents = { vectorize: jest.fn(async () => undefined) } as unknown as AgentsClient
    const reader = new PageContentReader()
    const svc = new VectorizationCronService(prisma as never, reader, agents)
    await svc.tick()
    expect(agents.vectorize).not.toHaveBeenCalled()
  })

  it("calls agents for TEXT page with blocks", async () => {
    const rows = [{ id: BigInt(1), page_id: "p1", workspace_id: "w1" }]
    const page = {
      id: "p1", type: "TEXT", deletedAt: null, title: "T",
      content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] },
      workspaceId: "w1",
    }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = { vectorize } as unknown as AgentsClient
    const reader = new PageContentReader()
    const svc = new VectorizationCronService(prisma as never, reader, agents)
    await svc.tick()
    expect(vectorize).toHaveBeenCalledTimes(1)
    const arg = (vectorize.mock.calls[0] as unknown as [{ contents: unknown[] }])[0]
    expect(arg.contents).toHaveLength(1)
  })

  it("calls agents with empty contents when page is deleted/non-TEXT", async () => {
    const rows = [{ id: BigInt(2), page_id: "p2", workspace_id: "w2" }]
    const page = { id: "p2", type: "TEXT", deletedAt: new Date(), title: "", content: null, workspaceId: "w2" }
    const prisma = makePrismaMock({ rows, page })
    const vectorize = jest.fn(async () => undefined)
    const agents = { vectorize } as unknown as AgentsClient
    const svc = new VectorizationCronService(prisma as never, new PageContentReader(), agents)
    await svc.tick()
    expect(vectorize).toHaveBeenCalledWith(expect.objectContaining({
      pageId: "p2", workspaceId: "w2", contents: [],
    }))
  })
})
```

- [ ] **Step 2: Run — should fail**

```bash
cd apps/engines && pnpm test vectorization-cron
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/cron/vectorization-cron.service.ts`:

```ts
import { randomUUID } from "node:crypto"

import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers.js"
import { AgentsClient } from "../services/agents-client.service.js"
import { PageContentReader, type TiptapNode } from "../services/page-content-reader.service.js"

type Row = { id: bigint; page_id: string; workspace_id: string }

@Injectable()
export class VectorizationCronService implements OnModuleInit {
  private readonly log = new Logger(VectorizationCronService.name)
  private readonly workerId: string
  private readonly batch: number
  private readonly maxAttempts: number

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reader: PageContentReader,
    private readonly agents: AgentsClient,
  ) {
    this.workerId = `engines-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
    this.batch = Number(process.env.INDEXER_BATCH ?? 10)
    this.maxAttempts = Number(process.env.INDEXER_MAX_ATTEMPTS ?? 5)
  }

  onModuleInit(): void {
    this.log.log(
      `VectorizationCron ready; worker=${this.workerId} batch=${this.batch}`,
    )
  }

  @Cron(process.env.INDEXER_CRON_EXPRESSION ?? "*/30 * * * * *")
  async tick(): Promise<void> {
    const rows = await this.claimBatch()
    if (rows.length === 0) return
    await this.processBatch(rows)
  }

  private async claimBatch(): Promise<Row[]> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`
        SELECT id, aggregate_id AS page_id, workspace_id
        FROM outbox_events
        WHERE event_type = 'page.upserted'
          AND aggregate_type = 'page'
          AND status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${this.batch}
        FOR UPDATE SKIP LOCKED
      `)
      if (rows.length === 0) return rows
      const ids = rows.map((r) => r.id)
      await tx.$executeRaw(Prisma.sql`
        UPDATE outbox_events
        SET status='PROCESSING', locked_at=now(), locked_by=${this.workerId}
        WHERE id IN (${Prisma.join(ids)})
      `)
      return rows
    })
  }

  private async processBatch(rows: Row[]): Promise<void> {
    for (const row of rows) {
      try {
        const page = await this.prisma.page.findUnique({
          where: { id: row.page_id },
          select: {
            id: true, type: true, deletedAt: true, title: true,
            content: true, workspaceId: true,
          },
        })
        const isEligible = page && !page.deletedAt && page.type === "TEXT"
        const contents = isEligible
          ? this.reader.blocksFromDoc(page.content as TiptapNode | null)
          : []
        await this.agents.vectorize({
          pageId: row.page_id,
          workspaceId: row.workspace_id,
          title: page?.title ?? "",
          pageType: "TEXT",
          contents,
        })
        await this.markDone(row.id)
      } catch (err) {
        this.log.error(`Indexing failed for page ${row.page_id}: ${(err as Error).message}`)
        await this.markFailedOrRetry(row.id, err as Error)
      }
    }
  }

  private async markDone(outboxId: bigint): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status='DONE', processed_at=now(), locked_at=NULL, locked_by=NULL
      WHERE id = ${outboxId}
    `)
  }

  private async markFailedOrRetry(outboxId: bigint, err: Error): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET
        attempts = attempts + 1,
        last_error = ${err.message},
        status = CASE WHEN attempts + 1 >= ${this.maxAttempts}
                     THEN 'FAILED'::"OutboxEventStatus"
                     ELSE 'PENDING'::"OutboxEventStatus" END,
        next_attempt_at = now() + (LEAST(300, POWER(2, attempts + 1) * 10) * interval '1 second'),
        locked_at = NULL,
        locked_by = NULL
      WHERE id = ${outboxId}
    `)
  }
}
```

- [ ] **Step 4: Replace IndexerModule**

Replace `apps/engines/src/apps/indexer/indexer.module.ts`:

```ts
import { Module } from "@nestjs/common"

import { VectorizationCronService } from "./cron/vectorization-cron.service.js"
import { AgentsClient } from "./services/agents-client.service.js"
import { PageContentReader } from "./services/page-content-reader.service.js"

@Module({
  providers: [VectorizationCronService, AgentsClient, PageContentReader],
})
export class IndexerModule {}
```

- [ ] **Step 5: Run tests — should pass**

```bash
cd apps/engines && pnpm test vectorization-cron
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/indexer/
git commit -m "feat(engines): new VectorizationCronService + lean IndexerModule"
```

---

### Task 36: Update AppModule — remove SearchModule / BullMQ / Qdrant / Ollama

**Files:**
- Modify: `apps/engines/src/app.module.ts`

- [ ] **Step 1: Replace AppModule**

Replace `apps/engines/src/app.module.ts`:

```ts
import { Module } from "@nestjs/common"
import { ConfigModule } from "@nestjs/config"
import { ScheduleModule } from "@nestjs/schedule"

import { IndexerModule } from "./apps/indexer/indexer.module.js"
import { McpModule } from "./apps/mcp/mcp.module.js"
import { HealthModule } from "./health/health.module.js"
import { DbModule } from "./infra/db/db.module.js"

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DbModule,
    IndexerModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Update Swagger tags in main.ts**

In `apps/engines/src/main.ts`, remove `.addTag("search")` and `.addTag("indexer")` from the `DocumentBuilder`. Keep `.addTag("health")` and `.addTag("mcp")`.

- [ ] **Step 3: Build engines**

```bash
pnpm --filter engines build
```

Expected: clean build, no errors.

- [ ] **Step 4: Run engines tests**

```bash
cd apps/engines && pnpm test
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/app.module.ts apps/engines/src/main.ts
git commit -m "refactor(engines): drop SearchModule/BullMQ/Qdrant/Ollama from AppModule"
```

---

### Phase 5 Completion

- [ ] **Full workspace check**

```bash
pnpm check-types && pnpm --filter engines test
```

Expected: clean.

---

## Phase 6 — apps/web: remove rag-search

### Task 37: Delete rag-search.ts + tests

**Files (delete):**
- `apps/web/src/lib/chat/rag-search.ts`
- `apps/web/src/lib/chat/rag-search.test.ts` (if exists)

- [ ] **Step 1: Delete**

```bash
rm -f apps/web/src/lib/chat/rag-search.ts apps/web/src/lib/chat/rag-search.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A apps/web/src/lib/chat/
git commit -m "refactor(web): remove rag-search.ts (agents does retrieval internally)"
```

---

### Task 38: Remove `rag` from agents-payload + generate route

**Files:**
- Modify: `apps/web/src/lib/chat/agents-payload.ts`
- Modify: `apps/web/src/app/api/agents/generate/route.ts`
- Modify: `apps/web/src/lib/chat/agents-payload.test.ts` (if exists)

- [ ] **Step 1: Remove `rag` from agents-payload builder**

Edit `apps/web/src/lib/chat/agents-payload.ts`:

1. Remove the `RagDocument` type export (if defined here).
2. Remove the `rag` arg from the `buildAgentsPayload` signature.
3. Remove the line that serializes `rag: { documents: args.rag }` from the returned object.

- [ ] **Step 2: Remove searchRagDocuments call**

Edit `apps/web/src/app/api/agents/generate/route.ts`:

1. Remove the import of `searchRagDocuments` and `RagDocument`.
2. Remove the block that calls `searchRagDocuments(...)` and constructs the `rag` array.
3. In the `buildAgentsPayload({...})` call, remove the `rag: ...` argument.

- [ ] **Step 3: Update agents-payload.test.ts (if it exists)**

```bash
ls apps/web/src/lib/chat/agents-payload.test.ts 2>/dev/null
```

If present, remove any test cases that assert the `rag` field is serialized.

- [ ] **Step 4: Type check + lint**

```bash
pnpm --filter web check-types
pnpm --filter web lint
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/chat/agents-payload.ts apps/web/src/app/api/agents/generate/route.ts apps/web/src/lib/chat/
git commit -m "refactor(web): drop rag from agents-payload and generate route"
```

---

### Phase 6 Completion

- [ ] **Full build**

```bash
pnpm build
```

Expected: green everywhere.

---

## Phase 7 — E2E tests + backfill CLI

### Task 39: wait-until helper

**Files:**
- Create: `apps/e2e/helpers/wait-until.ts` (if absent)

- [ ] **Step 1: Check if already exists**

```bash
ls apps/e2e/helpers/ 2>/dev/null
```

If `wait-until.ts` exists, skip this task.

- [ ] **Step 2: Create helper**

Create `apps/e2e/helpers/wait-until.ts`:

```ts
export async function waitUntil(
  fn: () => Promise<boolean>,
  opts: { timeout: number; pollMs?: number; label?: string } = { timeout: 30_000 },
): Promise<void> {
  const { timeout, pollMs = 500, label = "condition" } = opts
  const start = Date.now()
  let lastErr: unknown
  while (Date.now() - start < timeout) {
    try {
      if (await fn()) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(
    `waitUntil timeout (${timeout}ms) for ${label}${lastErr ? ": " + String(lastErr) : ""}`,
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/e2e/helpers/wait-until.ts
git commit -m "test(e2e): add waitUntil polling helper"
```

---

### Task 40: qdrant-helpers — scroll by pageId + blockNumber

**Files:**
- Create: `apps/e2e/helpers/qdrant-helpers.ts`

- [ ] **Step 1: Create helper**

Create `apps/e2e/helpers/qdrant-helpers.ts`:

```ts
export async function qdrantHasPointForBlock(
  pageId: string,
  blockNumber: number,
  opts: { baseUrl?: string } = {},
): Promise<boolean> {
  const baseUrl = opts.baseUrl ?? "http://localhost:6333"
  const res = await fetch(`${baseUrl}/collections/pages/points/scroll`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      filter: {
        must: [
          { key: "pageId", match: { value: pageId } },
          { key: "blockNumber", match: { value: blockNumber } },
        ],
      },
      limit: 1,
      with_payload: false,
      with_vector: false,
    }),
  })
  if (!res.ok) return false
  const body = (await res.json()) as { result?: { points?: unknown[] } }
  return (body.result?.points?.length ?? 0) > 0
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/e2e/helpers/qdrant-helpers.ts
git commit -m "test(e2e): add qdrantHasPointForBlock helper"
```

---

### Task 41: Inspect existing E2E user-setup pattern

**Context:** There is **no** `apps/e2e/helpers/` directory. Every existing E2E spec (`rag.spec.ts`, `chat-page.spec.ts`, `files.spec.ts`, etc.) follows the same pattern: **register via the sign-up UI** (so better-auth hashes the password for us), then use `prisma` directly for workspace/AI-settings/page/outbox setup. Task 42 follows this pattern — no new helper files needed, everything lives in the spec file.

- [ ] **Step 1: Confirm the pattern by reading `apps/e2e/rag.spec.ts` and `apps/e2e/chat-page.spec.ts`**

```bash
head -200 apps/e2e/rag.spec.ts
```

Expected: a `beforeAll` that (a) loads `.env` manually, (b) imports prisma from `packages/db`, followed by a test that signs up through `/sign-up`, then uses prisma directly.

- [ ] **Step 2: Verify `aiProvider` and `aiModel` are seeded locally**

```bash
pnpm --filter @repo/db prisma:seed
```

Expected: output mentions GigaChat + GigaChat-2 (or whichever provider/model the existing chat tests use).

No new code in this task — it's a knowledge-gathering step so Task 42 can be written correctly.

---

### Task 42: Rewrite rag.spec.ts → rag-block-links.spec.ts

**Files:**
- Delete: `apps/e2e/rag.spec.ts`
- Create: `apps/e2e/rag-block-links.spec.ts`

- [ ] **Step 1: Read the existing rag.spec.ts one more time to copy-adapt**

```bash
cat apps/e2e/rag.spec.ts
```

Save the `DATABASE_URL` loading block and the sign-up flow — both reused verbatim.

- [ ] **Step 2: Delete the old file**

```bash
rm apps/e2e/rag.spec.ts
```

- [ ] **Step 3: Create the new spec**

Create `apps/e2e/rag-block-links.spec.ts`:

```ts
import { expect, test } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { qdrantHasPointForBlock } from "./helpers/qdrant-helpers"
import { waitUntil } from "./helpers/wait-until"

let RoleType: { OWNER: string }
let prisma: {
  $disconnect: () => Promise<void>
  user: {
    findUniqueOrThrow: (args: unknown) => Promise<{ id: string }>
  }
  workspace: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  workspaceMember: {
    create: (args: unknown) => Promise<unknown>
  }
  workspaceAiSettings: {
    create: (args: unknown) => Promise<unknown>
  }
  aiProvider: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>
  }
  aiModel: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>
  }
  page: {
    create: (args: unknown) => Promise<{ id: string }>
    delete: (args: unknown) => Promise<unknown>
  }
  outboxEvent: {
    create: (args: unknown) => Promise<unknown>
    findFirst: (args: unknown) => Promise<{ status: string } | null>
  }
  chat: {
    create: (args: unknown) => Promise<{ id: string }>
  }
}

test.use({ locale: "en-US", timezoneId: "America/New_York" })
test.setTimeout(180_000)

test.beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    const envPath = join(process.cwd(), ".env")
    const envFile = readFileSync(envPath, "utf8")
    const databaseUrl = envFile
      .split("\n").map((l) => l.trim())
      .find((l) => l.startsWith("DATABASE_URL="))
      ?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "")
    if (!databaseUrl) throw new Error("DATABASE_URL not configured in .env")
    process.env.DATABASE_URL = databaseUrl
  }
  const db = await import("../../packages/db/src/index")
  RoleType = db.RoleType
  prisma = db.prisma
})

test.afterAll(async () => {
  if (prisma) await prisma.$disconnect()
})

const password = "SuperSecure123!"
const MARKER = "Бразильский Медведь"
const QUERY = "Как называется наш корпоративный кофе?"

test("assistant cites page with block-anchor link", async ({ page: browser }) => {
  const email = `rag-anchor+${Date.now()}@example.com`

  // --- Register via UI (better-auth hashes credentials) ---
  await browser.goto("/sign-up")
  await browser.getByRole("textbox", { name: "Email" }).fill(email)
  await browser.getByRole("textbox", { name: "Фамилия" }).fill("Тестов")
  await browser.getByRole("textbox", { name: "Имя" }).fill("РАГ")
  await browser.getByRole("textbox", { name: /^пароль$/i }).fill(password)
  await browser.getByRole("textbox", { name: "Повторите пароль" }).fill(password)
  await browser.getByRole("button", { name: "Зарегистрироваться" }).click()
  await browser.waitForURL(/\/workspaces\/new/)

  // --- Wait for user row to exist, then seed workspace + page via Prisma ---
  await expect.poll(async () => prisma.user.findUniqueOrThrow({
    where: { email }, select: { id: true },
  }).catch(() => null), { timeout: 10_000, intervals: [200, 500, 1000] }).toBeTruthy()

  const user = await prisma.user.findUniqueOrThrow({
    where: { email }, select: { id: true },
  })

  const workspace = await prisma.workspace.create({
    data: { name: `RAG anchor ${Date.now()}`, createdById: user.id },
    select: { id: true },
  })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: user.id, role: RoleType.OWNER },
  })

  const provider = await prisma.aiProvider.findFirst({ where: { slug: "gigachat" } })
  const model = await prisma.aiModel.findFirst({ where: { slug: "GigaChat-2" } })
  if (!provider || !model) {
    throw new Error("GigaChat provider/model not seeded; run `pnpm --filter @repo/db prisma:seed`")
  }
  await prisma.workspaceAiSettings.create({
    data: {
      workspaceId: workspace.id, defaultModelId: model.id,
      temperature: 0.3, topP: 0.9, systemPrompt: null,
    },
  })

  // --- Tiptap doc: block 0 = paragraph, 1 = heading (SKIP), 2 = paragraph with MARKER ---
  const pageRow = await prisma.page.create({
    data: {
      workspaceId: workspace.id,
      title: "Корпоративные напитки",
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Документ о напитках в офисе." }] },
          { type: "heading",   content: [{ type: "text", text: "Кофе" }] },
          { type: "paragraph", content: [{ type: "text", text: `Корпоративный кофе нашей компании называется "${MARKER}".` }] },
        ],
      },
      createdById: user.id, updatedById: user.id,
    },
    select: { id: true },
  })

  // --- Bypass 5-min quiet-period for E2E: next_attempt_at = now() ---
  await prisma.outboxEvent.create({
    data: {
      eventType: "page.upserted", aggregateType: "page",
      aggregateId: pageRow.id, workspaceId: workspace.id, payload: {},
      // next_attempt_at defaults to now() in Prisma schema → picked up immediately
    },
  })

  // --- Wait for engines cron → agents vectorization → outbox DONE ---
  await waitUntil(async () => {
    const row = await prisma.outboxEvent.findFirst({
      where: { aggregateId: pageRow.id, eventType: "page.upserted" },
      orderBy: { createdAt: "desc" },
    })
    return row?.status === "DONE"
  }, { timeout: 90_000, pollMs: 1000, label: "outbox page.upserted → DONE" })

  // --- Verify Qdrant has a point for block #2 (where MARKER lives) ---
  expect(await qdrantHasPointForBlock(pageRow.id, 2)).toBe(true)

  // --- Create a chat via Prisma (matches existing rag.spec.ts pattern) ---
  const chat = await prisma.chat.create({
    data: { workspaceId: workspace.id, createdById: user.id },
    select: { id: true },
  })

  await browser.goto(`/workspaces/${workspace.id}/chats/${chat.id}`)
  const composer = browser.getByTestId("chat-composer-textarea")
  await expect(composer).toBeVisible()
  await composer.fill(QUERY)
  await browser.getByRole("button", { name: "Send" }).click()

  // --- Poll until the marker appears in any assistant article ---
  await expect.poll(
    async () =>
      browser.locator('[role="article"]').allInnerTexts()
        .then((chunks) => chunks.join("\n")),
    { timeout: 120_000, intervals: [1000, 2000] },
  ).toContain(MARKER)

  // --- Assert the block-anchor link exists in the DOM ---
  const anchor = browser.locator(
    `a[href="/workspaces/${workspace.id}/pages/${pageRow.id}#2"]`,
  )
  await expect(anchor).toBeVisible({ timeout: 10_000 })

  // --- Cleanup ---
  await prisma.page.delete({ where: { id: pageRow.id } }).catch(() => undefined)
  await prisma.workspace.delete({ where: { id: workspace.id } }).catch(() => undefined)
})
```

- [ ] **Step 4: Run the E2E (docker + dev servers must be up, Ollama must have nomic-embed-text)**

```bash
pnpm exec playwright test apps/e2e/rag-block-links.spec.ts
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/e2e/rag-block-links.spec.ts apps/e2e/rag.spec.ts
git commit -m "test(e2e): rag-block-links replaces rag.spec — asserts block-anchor link in answer"
```

---

### Task 43: Backfill CLI for engines

**Files:**
- Create: `apps/engines/src/cli/backfill-reindex.ts`
- Modify: `apps/engines/package.json`

- [ ] **Step 1: Create CLI entry**

Create `apps/engines/src/cli/backfill-reindex.ts`:

```ts
import "reflect-metadata"
import "dotenv/config"

import { PrismaClient, Prisma } from "@repo/db"

async function main() {
  const prisma = new PrismaClient()
  try {
    const pages = await prisma.page.findMany({
      where: { type: "TEXT", deletedAt: null },
      select: { id: true, workspaceId: true },
    })
    let inserted = 0
    for (const page of pages) {
      const rows = await prisma.$executeRaw(Prisma.sql`
        INSERT INTO outbox_events
          (event_type, aggregate_type, aggregate_id, workspace_id, payload, status, next_attempt_at)
        VALUES
          ('page.upserted', 'page', ${page.id}::uuid, ${page.workspaceId}::uuid, '{}'::jsonb,
           'PENDING', now())
        ON CONFLICT DO NOTHING
      `)
      if (rows > 0) inserted++
    }
    console.log(`Enqueued ${inserted}/${pages.length} pages for reindex`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

- [ ] **Step 2: Add script to package.json**

Edit `apps/engines/package.json` `scripts`:

```json
    "backfill:reindex": "tsx --env-file=../../.env src/cli/backfill-reindex.ts"
```

Ensure `tsx` is in `devDependencies`:

```json
    "tsx": "^4.21.0"
```

(Run `pnpm install` if `tsx` wasn't present.)

- [ ] **Step 3: Smoke run**

```bash
pnpm --filter engines backfill:reindex
```

Expected: `Enqueued N/M pages for reindex` output, no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/src/cli/backfill-reindex.ts apps/engines/package.json pnpm-lock.yaml
git commit -m "feat(engines): add backfill:reindex CLI"
```

---

### Task 44: README pre-flight for RAG + backfill instructions

**Files:**
- Modify: `README.md` (repo root) or `docs/rag-setup.md` if README is already congested

- [ ] **Step 1: Add RAG setup section to README**

Append to `README.md` (or create `docs/rag-setup.md` and link from README):

```markdown
## RAG / vectorization setup

Vectorization runs as a cron in `apps/engines` that calls `POST /vectorization`
in `apps/agents`. Qdrant (`pages` collection, cosine, 768 dims) and Ollama
(`nomic-embed-text`) must be up before starting the services.

### Pre-flight checklist

1. `docker compose up -d` — brings up Postgres, Qdrant, Ollama.
2. `ollama pull nomic-embed-text` — pull the embedding model into your local Ollama.
3. `pnpm --filter @repo/db prisma:db-push` — apply schema if first run.
4. `pnpm dev` — start web, yjs, engines, agents.

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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: RAG pre-flight + backfill + rollback instructions"
```

---

### Phase 7 Completion

- [ ] **Run E2E once more from clean state**

```bash
docker compose up -d && pnpm exec playwright test apps/e2e/rag-block-links.spec.ts
```

Expected: green.

---

## Phase 8 — env / turbo / docs cleanup

### Task 45: Update root .env.example + turbo.json globalEnv

**Files:**
- Modify: `.env.example` (repo root, create if absent)
- Modify: `turbo.json`

- [ ] **Step 1: .env.example — remove old, add new**

Edit `.env.example` (or the equivalent in the repo):

Remove these lines (if present):
```
QDRANT_URL=...
QDRANT_API_KEY=...
QDRANT_COLLECTION=...
OLLAMA_BASE_URL=...
EMBEDDING_MODEL=...
REDIS_URL=...
PROCESSING_SERVICE_URL=...
ENGINES_SERVICE_URL=...
INDEXER_DRAINER_BATCH=...
INDEXER_DRAINER_INTERVAL_MS=...
INDEXER_REINDEX_ON_BOOT=...
INDEXER_QUIET_PERIOD_MINUTES=...
```

Add:
```
# --- Qdrant (agents service) ---
QDRANT__HOST=localhost
QDRANT__PORT=6333
QDRANT__PROTOCOL=http
QDRANT__AUTH__TOKEN=
QDRANT__COLLECTION_NAME=pages

# --- Ollama (agents service) ---
OLLAMA__HOST=localhost
OLLAMA__PORT=11434
OLLAMA__PROTOCOL=http
OLLAMA__EMBEDDING_MODEL=nomic-embed-text

# --- Engines cron ---
INDEXER_CRON_EXPRESSION=*/30 * * * * *
INDEXER_MAX_ATTEMPTS=5
INDEXER_BATCH=10
```

Keep existing `AGENTS_SERVICE_URL`, `DATABASE_URL`, `BETTER_AUTH_*`, `S3_*`, `NEXT_PUBLIC_YJS_URL`, `YJS_PORT`, `BETTER_AUTH_JWT_AUDIENCE`, `NEXT_PUBLIC_BASE_URL`.

- [ ] **Step 2: Update turbo.json globalEnv**

Edit `turbo.json` `globalEnv` array:
- Remove the old keys (see list above).
- Add the new `QDRANT__*` and `OLLAMA__*` keys, plus `INDEXER_BATCH` if missing.

- [ ] **Step 3: Verify turbo re-hashes**

```bash
pnpm exec turbo run build --dry=json | jq '.tasks[0].hash' | head -1
```

Expected: non-empty hash (the config parses).

- [ ] **Step 4: Commit**

```bash
git add .env.example turbo.json
git commit -m "chore: sync env.example + turbo globalEnv with new qdrant/ollama settings"
```

---

### Task 46: Remove Redis from compose if unused + final doc tidy

**Files:**
- Modify: `compose.yml` (only if Redis is truly unused)
- Modify: `CLAUDE.md` if outdated

- [ ] **Step 1: Verify Redis is unused**

```bash
grep -rn "REDIS_URL\|ioredis\|bullmq" apps/ packages/ 2>/dev/null | grep -v -E "\.lock|node_modules|dist|\.next"
```

Expected: zero hits. If any real code still references Redis, leave compose.yml alone.

- [ ] **Step 2: Drop Redis from compose.yml**

Edit `compose.yml`: delete the `redis:` service block and any `depends_on: [redis]` references.

- [ ] **Step 3: Update CLAUDE.md if it still mentions Redis/BullMQ/search-pages**

```bash
grep -n "Redis\|BullMQ\|search/pages" CLAUDE.md 2>/dev/null
```

For each outdated mention: remove or update the line. Do NOT rewrite the file.

- [ ] **Step 4: Update requests.http files**

In `apps/agents/requests.http`: remove any `POST /processing/normalize` block, add a `POST /vectorization` block with example payload:

```http
POST http://localhost:8080/vectorization
Content-Type: application/json

{
  "pageId": "00000000-0000-0000-0000-000000000001",
  "workspaceId": "00000000-0000-0000-0000-000000000002",
  "title": "Sample page",
  "pageType": "TEXT",
  "contents": [{ "blockNumber": 0, "content": "hello world" }]
}
```

In `apps/engines/requests.http`: remove any `/search/pages` or old `/indexer/*` blocks. Keep MCP + health blocks as-is.

- [ ] **Step 5: Commit**

```bash
git add compose.yml CLAUDE.md apps/agents/requests.http apps/engines/requests.http
git commit -m "chore: drop unused Redis service, refresh CLAUDE.md + requests.http"
```

---

### Phase 8 Completion

- [ ] **Full workspace health**

```bash
docker compose up -d
pnpm install
pnpm check-types
pnpm lint
pnpm build
pnpm --filter agents test -m "not integration"
pnpm --filter engines test
pnpm --filter yjs test
```

Expected: all green.

- [ ] **Final E2E smoke**

```bash
pnpm exec playwright test apps/e2e/rag-block-links.spec.ts
```

Expected: green.

---

## Final Self-Review Checklist (run before closing the plan)

- [ ] Every spec section (1–9 in the design doc) has a matching task.
- [ ] Every file listed in "Удаляем целиком" (spec 3.1) has a delete step (Task 31).
- [ ] Every new file listed in the spec (VectorizationRepository, VectorStoreRepository, ChunkerService, VectorizePageUseCase, RagRetrievalService, PageContentReader, AgentsClient, VectorizationCronService, enqueueOutboxEventIgnoreConflict, VectorsProvider, rag-block-links.spec.ts, backfill-reindex.ts, wait-until.ts, qdrant-helpers.ts) has a create step.
- [ ] Every env change in the spec (Section 6.2, Environment variables summary) is in Task 45.
- [ ] Every test file in the spec (unit + integration + E2E) has a write step.
- [ ] Template changes (Task 17) produce the exact citation string from the spec.
- [ ] `blockNumber` handling in PageContentReader preserves index even on skipped blocks (Task 33, test case 3).
- [ ] Idempotency: VectorizePageUseCase calls `delete_by_page` before upsert (Task 9 test 1).
- [ ] Dedup: RagRetrievalService dedupes by `(pageId, blockNumber)` (Task 16 test 2).

---

## End of plan
