# apps/engines NestJS Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge `apps/engines` (Python MCP) and `apps/indexer` (Python outbox worker) into one NestJS 11 service at `apps/engines`, and add a new Python `processing` module inside `apps/agents` for text normalization.

**Architecture:** Two NestJS modules inside `apps/engines/src/apps/`:
- `indexer` — `@nestjs/schedule` cron + `@nestjs/bullmq` consumer + PageChunker → ProcessingClient → Ollama → QdrantWriter.
- `mcp` — `@rekog/mcp-nest` server exposing 15 tools for pages, files, skills, agents, stats.

`apps/agents/agents/apps/processing` exposes `POST /processing/normalize` via FastAPI/Dishka using spaCy `ru_core_news_sm`/`en_core_web_sm` + `langdetect`. `apps/engines` indexer calls it before embedding each chunk.

**Tech Stack:** NestJS 11, `@nestjs/schedule`, `@nestjs/bullmq`, `bullmq`, `ioredis`, `@rekog/mcp-nest`, `@qdrant/js-client-rest`, `@repo/db` (Prisma), `@repo/storage` (S3), Jest, spaCy, langdetect.

**Spec:** `docs/superpowers/specs/2026-04-20-engines-nestjs-unification-design.md`

---

## Phase 0 — DB Migration

### Task 0.1: Add partial unique index to outbox_events

> This repo uses `prisma db push` (no `migrations/` directory). Prisma schema
> syntax cannot express partial unique indexes, so we ship the index as a
> raw SQL file applied via `prisma db execute`. `db push` preserves indexes
> not declared in the schema.

**Files:**
- Create: `packages/db/prisma/sql/2026-04-20-outbox-active-unique.sql`
- Modify: `packages/db/package.json` (add convenience script)

- [ ] **Step 1: Ensure `pnpm install` and baseline is green**

```bash
cd /Users/victor/Projects/anynote
pnpm install
pnpm --filter @repo/db prisma:db-push
```

Expected: `The database is already in sync with the Prisma schema`.

- [ ] **Step 2: Create SQL file**

Create `packages/db/prisma/sql/2026-04-20-outbox-active-unique.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "outbox_events_active_unique"
  ON "outbox_events" ("aggregate_type", "aggregate_id", "event_type")
  WHERE status IN ('PENDING', 'PROCESSING');
```

- [ ] **Step 3: Add convenience script**

Edit `packages/db/package.json`, inside `"scripts"`:
```json
"prisma:apply-sql": "prisma db execute --file"
```

- [ ] **Step 4: Apply**

```bash
pnpm --filter @repo/db prisma:apply-sql prisma/sql/2026-04-20-outbox-active-unique.sql
```

Expected: `Script executed successfully.`

- [ ] **Step 5: Verify index exists**

```bash
docker compose exec -T postgres psql -U user -d anynote -c "\d outbox_events" | grep -i "active_unique"
```

Expected: line containing `"outbox_events_active_unique" UNIQUE, btree (aggregate_type, aggregate_id, event_type) WHERE status = ANY (ARRAY['PENDING'::"OutboxEventStatus", 'PROCESSING'::"OutboxEventStatus"])`.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/sql/ packages/db/package.json
git commit -m "feat(db): add partial unique index on active outbox events

Prevents duplicate active indexing events for the same page, allowing
cron + event-driven enqueue to coexist via ON CONFLICT DO NOTHING.
Shipped as raw SQL because Prisma schema syntax cannot express partial
unique indexes; applied via new prisma:apply-sql script."
```

---

## Phase 1 — apps/agents Processing Module

### Task 1.1: Add spaCy + langdetect dependencies

**Files:**
- Modify: `apps/agents/pyproject.toml`
- Modify: `apps/agents/Dockerfile`

- [ ] **Step 1: Add deps to pyproject.toml**

In `[project.dependencies]` array add:
```toml
"spacy>=3.7,<4",
"langdetect>=1.0",
```

- [ ] **Step 2: Install**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv sync
```

Expected: `spacy` and `langdetect` installed.

- [ ] **Step 3: Download spaCy models locally**

```bash
uv run python -m spacy download ru_core_news_sm
uv run python -m spacy download en_core_web_sm
```

Each is ~15–50 MB download.

- [ ] **Step 4: Add model download to Dockerfile**

Find the line that runs `uv sync` in `apps/agents/Dockerfile`. Add immediately after:
```dockerfile
RUN uv run python -m spacy download ru_core_news_sm \
 && uv run python -m spacy download en_core_web_sm
```

- [ ] **Step 5: Commit**

```bash
git add apps/agents/pyproject.toml apps/agents/uv.lock apps/agents/Dockerfile
git commit -m "build(agents): add spacy + langdetect for processing module"
```

### Task 1.2: Create processing module skeleton

**Files:**
- Create: `apps/agents/agents/apps/processing/__init__.py`
- Create: `apps/agents/agents/apps/processing/schemas.py`
- Create: `apps/agents/agents/apps/processing/errors.py`
- Create: `apps/agents/agents/apps/processing/services/__init__.py`

- [ ] **Step 1: Create empty package files**

```bash
mkdir -p apps/agents/agents/apps/processing/services
touch apps/agents/agents/apps/processing/__init__.py
touch apps/agents/agents/apps/processing/services/__init__.py
```

- [ ] **Step 2: Write schemas.py**

```python
"""Processing module request/response schemas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Language = Literal["ru", "en", "auto"]
DetectedLanguage = Literal["ru", "en"]


class NormalizeRequest(BaseModel):
    text: str = Field(..., description="Raw text to normalize.")
    language: Language = Field("auto", description="Source language or 'auto'.")


class NormalizeResponse(BaseModel):
    normalized: str = Field(..., description="Pipeline output ready for embedding.")
    language: DetectedLanguage = Field(..., description="Language used for pipeline.")
```

- [ ] **Step 3: Write errors.py**

```python
"""Processing module error taxonomy."""

from __future__ import annotations

from agents.exceptions import AgentException


class ProcessingException(AgentException):
    """Base class for processing module failures."""

    code = "PROCESSING_ERROR"
    http_status = 500


class UnsupportedLanguageError(ProcessingException):
    code = "UNSUPPORTED_LANGUAGE"
    http_status = 400
```

- [ ] **Step 4: Commit**

```bash
git add apps/agents/agents/apps/processing/
git commit -m "feat(agents): scaffold processing module skeleton"
```

### Task 1.3: LanguageDetector service — TDD

**Files:**
- Create: `apps/agents/tests/processing/__init__.py`
- Create: `apps/agents/tests/processing/test_language_detector.py`
- Create: `apps/agents/agents/apps/processing/services/language_detector.py`

- [ ] **Step 1: Write failing tests**

Create `apps/agents/tests/processing/__init__.py` (empty).

Create `apps/agents/tests/processing/test_language_detector.py`:
```python
"""Tests for LanguageDetector."""

from __future__ import annotations

import pytest

from agents.apps.processing.services.language_detector import LanguageDetector


@pytest.fixture
def detector() -> LanguageDetector:
    return LanguageDetector()


def test_detects_russian(detector: LanguageDetector) -> None:
    assert detector.detect("Привет мир, это тестовое сообщение") == "ru"


def test_detects_english(detector: LanguageDetector) -> None:
    assert detector.detect("Hello world this is a test message") == "en"


def test_empty_defaults_to_ru(detector: LanguageDetector) -> None:
    assert detector.detect("") == "ru"


def test_non_supported_falls_back_to_ru(detector: LanguageDetector) -> None:
    # Japanese / Chinese glyphs detected but not in {ru,en} → fallback.
    assert detector.detect("こんにちは世界") == "ru"
```

- [ ] **Step 2: Run — verify fail**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run pytest tests/processing/test_language_detector.py -v
```

Expected: `ModuleNotFoundError: No module named 'agents.apps.processing.services.language_detector'`.

- [ ] **Step 3: Implement**

Create `apps/agents/agents/apps/processing/services/language_detector.py`:
```python
"""Language detection wrapper around langdetect."""

from __future__ import annotations

from typing import Literal

from langdetect import DetectorFactory, LangDetectException, detect

DetectorFactory.seed = 0  # deterministic results

DetectedLanguage = Literal["ru", "en"]


class LanguageDetector:
    """Detects language of a text chunk.

    Returns only "ru" or "en"; anything else falls back to "ru" because
    the indexer's downstream pipeline (spaCy) only has models for those.
    """

    def detect(self, text: str) -> DetectedLanguage:
        if not text.strip():
            return "ru"
        try:
            detected = detect(text)
        except LangDetectException:
            return "ru"
        if detected == "en":
            return "en"
        return "ru"
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/processing/test_language_detector.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/services/language_detector.py apps/agents/tests/processing/
git commit -m "feat(agents/processing): add language detector"
```

### Task 1.4: NormalizerService (RU) — TDD

**Files:**
- Create: `apps/agents/tests/processing/test_normalizer.py`
- Create: `apps/agents/agents/apps/processing/services/normalizer.py`

- [ ] **Step 1: Write failing tests**

Create `apps/agents/tests/processing/test_normalizer.py`:
```python
"""Tests for NormalizerService."""

from __future__ import annotations

import pytest

from agents.apps.processing.services.normalizer import NormalizerService


@pytest.fixture(scope="module")
def normalizer() -> NormalizerService:
    return NormalizerService()


def test_russian_basic_lemmatization(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Быстрые собаки бегают по лесу.", "ru")
    assert lang == "ru"
    # lemmas: быстрый, собака, бегать, лес ("по" is stopword)
    assert "быстрый" in out.split()
    assert "собака" in out.split()
    assert "бегать" in out.split()
    assert "лес" in out.split()
    assert "по" not in out.split()


def test_russian_stopwords_removed(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("и в на но или что это", "ru")
    assert out == ""


def test_empty_input_returns_empty(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("", "ru")
    assert out == ""


def test_only_punctuation_returns_empty(normalizer: NormalizerService) -> None:
    out, _ = normalizer.normalize("!!! ??? ...", "ru")
    assert out == ""


def test_unicode_normalization(normalizer: NormalizerService) -> None:
    # Combining diacritics → NFC form
    raw = "cafe\u0301"  # "café" decomposed
    out, _ = normalizer.normalize(raw, "en")
    # After NFC + lowercase + spaCy pipeline, at minimum we get a non-empty result
    assert "café" in out or "cafe" in out or len(out) > 0


def test_short_tokens_dropped(normalizer: NormalizerService) -> None:
    # Russian "я" (1 char, "I") should be dropped by len<2 filter even though
    # it's not in every stopword list.
    out, _ = normalizer.normalize("я", "ru")
    assert out == ""


def test_auto_detect_russian(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Здравствуйте, это тест", "auto")
    assert lang == "ru"
    assert len(out) > 0
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/processing/test_normalizer.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Create `apps/agents/agents/apps/processing/services/normalizer.py`:
```python
"""Text normalization pipeline: NFC → lower → strip → lemmatize → stopwords → short-token filter."""

from __future__ import annotations

import re
import unicodedata
from typing import Literal

import spacy
from spacy.language import Language

from agents.apps.processing.services.language_detector import LanguageDetector

_PIPELINE_NAMES = {
    "ru": "ru_core_news_sm",
    "en": "en_core_web_sm",
}

_SERVICE_CHARS_RE = re.compile(r"[^\w\s]|_", re.UNICODE)
_WHITESPACE_RE = re.compile(r"\s+")

RequestedLanguage = Literal["ru", "en", "auto"]


class NormalizerService:
    """spaCy-backed text normalizer. Loads both models on construction."""

    def __init__(self) -> None:
        self._pipelines: dict[str, Language] = {
            lang: spacy.load(model_name)
            for lang, model_name in _PIPELINE_NAMES.items()
        }
        self._detector = LanguageDetector()

    def normalize(self, text: str, language: RequestedLanguage) -> tuple[str, Literal["ru", "en"]]:
        """Run the full normalization pipeline.

        Returns (normalized_text, effective_language).
        """
        if not text:
            return ("", "ru" if language == "auto" else language)

        # 1. Unicode NFC
        text = unicodedata.normalize("NFC", text)
        # 2. Lowercase
        text = text.lower()
        # 3. Remove service chars (punctuation, underscores) → space
        text = _SERVICE_CHARS_RE.sub(" ", text)
        # 4. Collapse whitespace
        text = _WHITESPACE_RE.sub(" ", text).strip()

        if not text:
            return ("", "ru" if language == "auto" else language)

        # 5. Language detection if auto
        effective_lang: Literal["ru", "en"]
        if language == "auto":
            effective_lang = self._detector.detect(text)
        else:
            effective_lang = language

        nlp = self._pipelines[effective_lang]

        # 6–8. Tokenize + lemmatize + filter stopwords/punct/short
        doc = nlp(text)
        lemmas: list[str] = []
        for token in doc:
            if token.is_stop or token.is_punct or token.is_space:
                continue
            lemma = token.lemma_.strip()
            if len(lemma) < 2:
                continue
            lemmas.append(lemma)

        return (" ".join(lemmas), effective_lang)
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/processing/test_normalizer.py -v
```

Expected: 7 passed. First run may take several seconds because spaCy loads both models.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/services/normalizer.py apps/agents/tests/processing/test_normalizer.py
git commit -m "feat(agents/processing): add spacy-backed normalizer"
```

### Task 1.5: NormalizerService (EN) additional tests

**Files:**
- Modify: `apps/agents/tests/processing/test_normalizer.py`

- [ ] **Step 1: Append EN tests**

Add to bottom of `test_normalizer.py`:
```python
def test_english_basic_lemmatization(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("The quick brown foxes were running quickly", "en")
    assert lang == "en"
    tokens = out.split()
    assert "quick" in tokens
    assert "brown" in tokens
    assert "fox" in tokens
    assert "run" in tokens
    # stopwords filtered
    assert "the" not in tokens
    assert "were" not in tokens


def test_auto_detect_english(normalizer: NormalizerService) -> None:
    out, lang = normalizer.normalize("Quick brown foxes jump over lazy dogs", "auto")
    assert lang == "en"
    assert len(out.split()) >= 3
```

- [ ] **Step 2: Run — verify pass**

```bash
uv run pytest tests/processing/test_normalizer.py -v
```

Expected: 9 passed.

- [ ] **Step 3: Commit**

```bash
git add apps/agents/tests/processing/test_normalizer.py
git commit -m "test(agents/processing): cover english lemmatization"
```

### Task 1.6: Dishka provider

**Files:**
- Create: `apps/agents/agents/apps/processing/depends.py`
- Create: `apps/agents/tests/processing/test_depends.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/processing/test_depends.py`:
```python
"""Contract test — processing provider resolves service."""

from __future__ import annotations

import pytest
from dishka import make_async_container

from agents.apps.processing.depends import ProcessingProvider
from agents.apps.processing.services.normalizer import NormalizerService
from agents.settings import Settings


@pytest.mark.asyncio
async def test_provider_resolves_normalizer() -> None:
    container = make_async_container(
        ProcessingProvider(),
        context={Settings: Settings()},
    )
    try:
        async with container() as request_container:
            normalizer = await request_container.get(NormalizerService)
            assert isinstance(normalizer, NormalizerService)
    finally:
        await container.close()
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/processing/test_depends.py -v
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Create `apps/agents/agents/apps/processing/depends.py`:
```python
"""Dishka providers for the processing module."""

from __future__ import annotations

from dishka import Provider, Scope, provide

from agents.apps.processing.services.language_detector import LanguageDetector
from agents.apps.processing.services.normalizer import NormalizerService


class ProcessingProvider(Provider):
    """APP-scoped provider: both services hold loaded NLP models and are reused."""

    scope = Scope.APP

    @provide
    def language_detector(self) -> LanguageDetector:
        return LanguageDetector()

    @provide
    def normalizer(self) -> NormalizerService:
        return NormalizerService()
```

- [ ] **Step 4: Run — verify pass**

```bash
uv run pytest tests/processing/test_depends.py -v
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/agents/agents/apps/processing/depends.py apps/agents/tests/processing/test_depends.py
git commit -m "feat(agents/processing): add dishka provider"
```

### Task 1.7: Router + app registration

**Files:**
- Create: `apps/agents/agents/apps/processing/router.py`
- Create: `apps/agents/tests/processing/test_router.py`
- Modify: `apps/agents/agents/entrypoints/rest/router.py`
- Modify: `apps/agents/agents/main.py`

- [ ] **Step 1: Write failing test**

Create `apps/agents/tests/processing/test_router.py`:
```python
"""HTTP contract test for /processing/normalize."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from agents.main import create_app


@pytest.fixture(scope="module")
def client() -> TestClient:
    app = create_app()
    return TestClient(app)


def test_normalize_endpoint_returns_normalized_text(client: TestClient) -> None:
    response = client.post(
        "/processing/normalize",
        json={"text": "Быстрые собаки бегают.", "language": "ru"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "ru"
    assert isinstance(body["normalized"], str)
    assert "собака" in body["normalized"].split()


def test_normalize_endpoint_auto_detects(client: TestClient) -> None:
    response = client.post(
        "/processing/normalize",
        json={"text": "Quick brown fox jumps over lazy dog", "language": "auto"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["language"] == "en"
    assert "fox" in body["normalized"].split()


def test_normalize_endpoint_rejects_invalid_body(client: TestClient) -> None:
    response = client.post("/processing/normalize", json={})
    assert response.status_code == 422
```

- [ ] **Step 2: Run — verify fail**

```bash
uv run pytest tests/processing/test_router.py -v
```

Expected: `404 Not Found` (route not mounted).

- [ ] **Step 3: Create router.py**

Create `apps/agents/agents/apps/processing/router.py`:
```python
"""POST /processing/normalize route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.processing.schemas import NormalizeRequest, NormalizeResponse
from agents.apps.processing.services.normalizer import NormalizerService

processing_router = APIRouter(prefix="/processing", tags=["processing"])


@processing_router.post("/normalize", response_model=NormalizeResponse)
@inject
async def normalize(
    payload: NormalizeRequest,
    normalizer: FromDishka[NormalizerService],
) -> NormalizeResponse:
    normalized, language = normalizer.normalize(payload.text, payload.language)
    return NormalizeResponse(normalized=normalized, language=language)
```

- [ ] **Step 4: Register router**

Modify `apps/agents/agents/entrypoints/rest/router.py` — add import and include:
```python
from agents.apps.processing.router import processing_router
# ...
api_router.include_router(processing_router)
```

- [ ] **Step 5: Register provider**

Modify `apps/agents/agents/main.py` — add import for `ProcessingProvider` and include it in `make_async_container`:
```python
from agents.apps.processing.depends import ProcessingProvider
# ...
container = make_async_container(
    AppProvider(),
    AppSingletonsProvider(),
    ProcessingProvider(),
    context={Settings: settings},
)
```

- [ ] **Step 6: Run — verify pass**

```bash
uv run pytest tests/processing/ -v
```

Expected: all processing tests pass (12+ cases).

- [ ] **Step 7: Run full agents test suite — verify no regression**

```bash
uv run pytest -v
```

Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add apps/agents/agents/apps/processing/router.py \
        apps/agents/agents/entrypoints/rest/router.py \
        apps/agents/agents/main.py \
        apps/agents/tests/processing/test_router.py
git commit -m "feat(agents/processing): mount POST /processing/normalize"
```

### Task 1.8: Verify linting + typing

- [ ] **Step 1: Run mypy + ruff**

```bash
cd /Users/victor/Projects/anynote/apps/agents
uv run mypy agents tests
uv run ruff check agents tests
```

Expected: clean. Fix any errors (usually import ordering, missing annotations).

- [ ] **Step 2: Commit fixes if any**

```bash
git add -A
git commit -m "chore(agents/processing): satisfy ruff + mypy"
```

---

## Phase 2 — Remove Old Python Apps, Scaffold NestJS

### Task 2.1: Delete old Python services

**Files:**
- Delete: `apps/indexer/` (entire directory)
- Delete: `apps/engines/engines/`, `apps/engines/pyproject.toml`, `apps/engines/uv.lock`, `apps/engines/tests/`, `apps/engines/Dockerfile`, `apps/engines/Makefile`, `apps/engines/README.md`

- [ ] **Step 1: Remove apps/indexer**

```bash
cd /Users/victor/Projects/anynote
rm -rf apps/indexer
```

- [ ] **Step 2: Wipe Python parts of apps/engines**

```bash
cd /Users/victor/Projects/anynote/apps/engines
rm -rf engines pyproject.toml uv.lock tests Dockerfile Makefile README.md package.json
```

- [ ] **Step 3: Verify directory is empty**

```bash
ls -A apps/engines/
```

Expected: only hidden cache dirs (`.turbo`) or nothing.

- [ ] **Step 4: Remove indexer from compose.yml**

Edit `compose.yml` — delete the entire `indexer:` service block (lines starting with `indexer:` until next top-level key like `volumes:`).

- [ ] **Step 5: Commit deletion**

```bash
git add apps/indexer apps/engines compose.yml
git commit -m "chore: remove old Python apps/indexer and apps/engines

Preparing for NestJS rewrite at apps/engines. No functional change;
compose.yml indexer service removed."
```

### Task 2.2: Scaffold NestJS project

**Files:**
- Create: `apps/engines/package.json`
- Create: `apps/engines/tsconfig.json`
- Create: `apps/engines/tsconfig.build.json`
- Create: `apps/engines/nest-cli.json`
- Create: `apps/engines/.eslintrc.json`
- Create: `apps/engines/.gitignore`
- Create: `apps/engines/jest.config.ts`
- Create: `apps/engines/src/main.ts`
- Create: `apps/engines/src/app.module.ts`

- [ ] **Step 1: Write package.json**

Create `apps/engines/package.json`:
```json
{
  "name": "engines",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "check-types": "tsc --noEmit",
    "lint": "eslint \"src/**/*.ts\" --max-warnings 0",
    "test": "jest",
    "test-int": "jest --config jest.integration.config.ts"
  },
  "dependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "@nestjs/platform-express": "^11.0.0",
    "@nestjs/schedule": "^4.1.0",
    "@nestjs/bullmq": "^11.0.0",
    "@rekog/mcp-nest": "^1.5.0",
    "@qdrant/js-client-rest": "^1.12.0",
    "@repo/db": "workspace:*",
    "@repo/storage": "workspace:*",
    "axios": "^1.7.0",
    "bullmq": "^5.25.0",
    "cron": "^3.2.0",
    "ioredis": "^5.4.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@nestjs/cli": "^11.0.0",
    "@nestjs/schematics": "^11.0.0",
    "@nestjs/testing": "^11.0.0",
    "@types/express": "^5.0.0",
    "@types/jest": "^29.5.14",
    "@types/node": "^22.10.0",
    "@types/supertest": "^6.0.2",
    "eslint": "^9.17.0",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.2.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Write tsconfig.json**

Create `apps/engines/tsconfig.json`:
```json
{
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "target": "ES2023",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": false,
    "resolveJsonModule": true,
    "paths": {
      "@src/*": ["src/*"]
    }
  },
  "include": ["src/**/*", "test/**/*"]
}
```

- [ ] **Step 3: Write tsconfig.build.json**

Create `apps/engines/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "**/*test.ts"]
}
```

- [ ] **Step 4: Write nest-cli.json**

Create `apps/engines/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 5: Write .eslintrc.json**

Create `apps/engines/.eslintrc.json`:
```json
{
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "project": "tsconfig.json",
    "sourceType": "module"
  },
  "extends": ["eslint:recommended"],
  "root": true,
  "env": {
    "node": true,
    "jest": true
  },
  "rules": {}
}
```

- [ ] **Step 6: Write .gitignore**

Create `apps/engines/.gitignore`:
```
dist/
node_modules/
*.log
.turbo/
coverage/
```

- [ ] **Step 7: Write jest.config.ts**

Create `apps/engines/jest.config.ts`:
```ts
import type { Config } from "jest"

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["<rootDir>/test/integration/"],
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  collectCoverageFrom: ["src/**/*.ts"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@src/(.*)$": "<rootDir>/src/$1",
  },
}

export default config
```

- [ ] **Step 8: Write src/main.ts**

Create `apps/engines/src/main.ts`:
```ts
import "reflect-metadata"

import { NestFactory } from "@nestjs/core"

import { AppModule } from "./app.module"

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "warn", "error"] })
  const port = Number(process.env.ENGINES_PORT ?? 8082)
  await app.listen(port)
}

bootstrap()
```

- [ ] **Step 9: Write minimal src/app.module.ts**

Create `apps/engines/src/app.module.ts`:
```ts
import { Module } from "@nestjs/common"

@Module({
  imports: [],
  controllers: [],
  providers: [],
})
export class AppModule {}
```

- [ ] **Step 10: Install dependencies**

```bash
cd /Users/victor/Projects/anynote
pnpm install
```

Expected: `engines` package added to workspace, no missing peer deps errors.

- [ ] **Step 11: Verify build compiles**

```bash
pnpm --filter engines build
```

Expected: `dist/main.js` generated, no errors.

- [ ] **Step 12: Run dev server smoke**

```bash
pnpm --filter engines dev &
sleep 3
curl -sf http://localhost:8082 || echo "server up but no route"
kill %1
```

Expected: server boots (`Nest application successfully started`). 404 from curl is fine — we have no routes yet.

- [ ] **Step 13: Commit scaffold**

```bash
git add apps/engines/package.json apps/engines/tsconfig.json apps/engines/tsconfig.build.json \
        apps/engines/nest-cli.json apps/engines/.eslintrc.json apps/engines/.gitignore \
        apps/engines/jest.config.ts apps/engines/src/main.ts apps/engines/src/app.module.ts \
        pnpm-lock.yaml
git commit -m "feat(engines): scaffold nestjs 11 application"
```

### Task 2.3: Health controller + test

**Files:**
- Create: `apps/engines/src/health/health.controller.ts`
- Create: `apps/engines/src/health/health.module.ts`
- Create: `apps/engines/src/health/health.controller.spec.ts`
- Modify: `apps/engines/src/app.module.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/health/health.controller.spec.ts`:
```ts
import { Test, TestingModule } from "@nestjs/testing"

import { HealthController } from "./health.controller"

describe("HealthController", () => {
  let controller: HealthController

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile()
    controller = moduleRef.get(HealthController)
  })

  it("returns ok status", () => {
    expect(controller.health()).toEqual({ status: "ok" })
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test
```

Expected: `Cannot find module './health.controller'`.

- [ ] **Step 3: Implement controller**

Create `apps/engines/src/health/health.controller.ts`:
```ts
import { Controller, Get } from "@nestjs/common"

@Controller("health")
export class HealthController {
  @Get()
  health() {
    return { status: "ok" }
  }
}
```

Create `apps/engines/src/health/health.module.ts`:
```ts
import { Module } from "@nestjs/common"

import { HealthController } from "./health.controller"

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 4: Wire into AppModule**

Modify `apps/engines/src/app.module.ts`:
```ts
import { Module } from "@nestjs/common"

import { HealthModule } from "./health/health.module"

@Module({
  imports: [HealthModule],
})
export class AppModule {}
```

- [ ] **Step 5: Run — verify pass**

```bash
pnpm --filter engines test
```

Expected: 1 passing.

- [ ] **Step 6: Manual smoke**

```bash
pnpm --filter engines dev &
sleep 3
curl -s http://localhost:8082/health
kill %1
```

Expected: `{"status":"ok"}`.

- [ ] **Step 7: Commit**

```bash
git add apps/engines/src/
git commit -m "feat(engines): add /health endpoint"
```

### Task 2.4: Infra — DB module (Prisma DI)

**Files:**
- Create: `apps/engines/src/infra/db/db.module.ts`
- Create: `apps/engines/src/infra/db/db.providers.ts`
- Create: `apps/engines/src/infra/db/db.module.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/infra/db/db.module.spec.ts`:
```ts
import { Test } from "@nestjs/testing"

import { DbModule } from "./db.module"
import { PRISMA } from "./db.providers"

describe("DbModule", () => {
  it("exposes PRISMA provider", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DbModule],
    }).compile()
    const prisma = moduleRef.get(PRISMA)
    expect(prisma).toBeDefined()
    expect(typeof prisma.$connect).toBe("function")
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- db.module.spec
```

Expected: `Cannot find module './db.providers'`.

- [ ] **Step 3: Implement providers**

Create `apps/engines/src/infra/db/db.providers.ts`:
```ts
import type { FactoryProvider } from "@nestjs/common"
import { prisma, PrismaClient } from "@repo/db"

export const PRISMA = Symbol("PRISMA_CLIENT")

export const prismaProvider: FactoryProvider<PrismaClient> = {
  provide: PRISMA,
  useFactory: () => prisma,
}
```

Create `apps/engines/src/infra/db/db.module.ts`:
```ts
import { Global, Module } from "@nestjs/common"

import { prismaProvider } from "./db.providers"

@Global()
@Module({
  providers: [prismaProvider],
  exports: [prismaProvider],
})
export class DbModule {}
```

- [ ] **Step 4: Wire into AppModule**

Modify `apps/engines/src/app.module.ts`:
```ts
import { Module } from "@nestjs/common"

import { DbModule } from "./infra/db/db.module"
import { HealthModule } from "./health/health.module"

@Module({
  imports: [DbModule, HealthModule],
})
export class AppModule {}
```

- [ ] **Step 5: Run — verify pass**

```bash
pnpm --filter engines test
```

Expected: 2 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/infra/db apps/engines/src/app.module.ts
git commit -m "feat(engines/infra): add global db module exposing @repo/db singleton"
```

### Task 2.5: Infra — Qdrant module

**Files:**
- Create: `apps/engines/src/infra/qdrant/qdrant.module.ts`
- Create: `apps/engines/src/infra/qdrant/qdrant.service.ts`
- Create: `apps/engines/src/infra/qdrant/qdrant.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/infra/qdrant/qdrant.service.spec.ts`:
```ts
import { QdrantService } from "./qdrant.service"

describe("QdrantService", () => {
  it("constructs with url + apiKey from env", () => {
    process.env.QDRANT_URL = "http://localhost:6333"
    process.env.QDRANT_API_KEY = "dev"
    const svc = new QdrantService()
    expect(svc.client).toBeDefined()
  })

  it("uses QDRANT_COLLECTION env var", () => {
    process.env.QDRANT_COLLECTION = "custom"
    const svc = new QdrantService()
    expect(svc.collection).toBe("custom")
  })

  it("defaults collection to page_chunks", () => {
    delete process.env.QDRANT_COLLECTION
    const svc = new QdrantService()
    expect(svc.collection).toBe("page_chunks")
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- qdrant.service.spec
```

Expected: `Cannot find module './qdrant.service'`.

- [ ] **Step 3: Implement**

Create `apps/engines/src/infra/qdrant/qdrant.service.ts`:
```ts
import { Injectable } from "@nestjs/common"
import { QdrantClient } from "@qdrant/js-client-rest"

@Injectable()
export class QdrantService {
  readonly client: QdrantClient
  readonly collection: string

  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL ?? "http://localhost:6333",
      apiKey: process.env.QDRANT_API_KEY,
    })
    this.collection = process.env.QDRANT_COLLECTION ?? "page_chunks"
  }
}
```

Create `apps/engines/src/infra/qdrant/qdrant.module.ts`:
```ts
import { Global, Module } from "@nestjs/common"

import { QdrantService } from "./qdrant.service"

@Global()
@Module({
  providers: [QdrantService],
  exports: [QdrantService],
})
export class QdrantModule {}
```

- [ ] **Step 4: Wire into AppModule**

```ts
import { QdrantModule } from "./infra/qdrant/qdrant.module"

@Module({
  imports: [DbModule, QdrantModule, HealthModule],
})
export class AppModule {}
```

- [ ] **Step 5: Run — verify pass**

```bash
pnpm --filter engines test
```

Expected: 5 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/infra/qdrant apps/engines/src/app.module.ts
git commit -m "feat(engines/infra): add qdrant module"
```

### Task 2.6: Infra — Ollama module

**Files:**
- Create: `apps/engines/src/infra/ollama/ollama.module.ts`
- Create: `apps/engines/src/infra/ollama/ollama.service.ts`
- Create: `apps/engines/src/infra/ollama/ollama.service.spec.ts`

- [ ] **Step 1: Write failing test**

Create `apps/engines/src/infra/ollama/ollama.service.spec.ts`:
```ts
import axios from "axios"

import { OllamaService } from "./ollama.service"

jest.mock("axios")
const mockedAxios = axios as jest.Mocked<typeof axios>

describe("OllamaService", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    process.env.OLLAMA_BASE_URL = "http://ollama.test:11434"
    process.env.EMBEDDING_MODEL = "nomic-embed-text"
  })

  it("embeds text via /api/embeddings", async () => {
    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockResolvedValue({ data: { embedding: [0.1, 0.2, 0.3] } }),
    } as unknown as ReturnType<typeof axios.create>)

    const svc = new OllamaService()
    const vec = await svc.embed("hello")

    expect(vec).toEqual([0.1, 0.2, 0.3])
  })

  it("throws if response missing embedding", async () => {
    mockedAxios.create.mockReturnValue({
      post: jest.fn().mockResolvedValue({ data: {} }),
    } as unknown as ReturnType<typeof axios.create>)

    const svc = new OllamaService()
    await expect(svc.embed("hello")).rejects.toThrow(/empty/i)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- ollama.service.spec
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/engines/src/infra/ollama/ollama.service.ts`:
```ts
import { Injectable, Logger } from "@nestjs/common"
import axios, { AxiosInstance } from "axios"

@Injectable()
export class OllamaService {
  private readonly log = new Logger(OllamaService.name)
  private readonly http: AxiosInstance
  private readonly model: string

  constructor() {
    this.http = axios.create({
      baseURL: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      timeout: 30000,
    })
    this.model = process.env.EMBEDDING_MODEL ?? "nomic-embed-text"
  }

  async embed(text: string): Promise<number[]> {
    const res = await this.http.post<{ embedding?: number[] }>("/api/embeddings", {
      model: this.model,
      prompt: text,
    })
    const embedding = res.data.embedding
    if (!embedding || embedding.length === 0) {
      throw new Error("Ollama returned empty embedding")
    }
    return embedding
  }
}
```

Create `apps/engines/src/infra/ollama/ollama.module.ts`:
```ts
import { Global, Module } from "@nestjs/common"

import { OllamaService } from "./ollama.service"

@Global()
@Module({
  providers: [OllamaService],
  exports: [OllamaService],
})
export class OllamaModule {}
```

- [ ] **Step 4: Wire into AppModule**

Add `OllamaModule` to imports.

- [ ] **Step 5: Run — verify pass**

```bash
pnpm --filter engines test
```

Expected: 7 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/infra/ollama apps/engines/src/app.module.ts
git commit -m "feat(engines/infra): add ollama embedding module"
```

---

## Phase 3 — Indexer Module

### Task 3.1: PageChunker service

**Files:**
- Create: `apps/engines/src/apps/indexer/services/page-chunker.service.ts`
- Create: `apps/engines/src/apps/indexer/services/page-chunker.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/services/page-chunker.service.spec.ts`:
```ts
import { PageChunker } from "./page-chunker.service"

describe("PageChunker", () => {
  const chunker = new PageChunker()

  it("returns empty array for null doc", () => {
    expect(chunker.chunksFromDoc(null)).toEqual([])
  })

  it("returns empty array for doc without content", () => {
    expect(chunker.chunksFromDoc({ type: "doc" })).toEqual([])
  })

  it("extracts one chunk per first-level node", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] },
        { type: "paragraph", content: [{ type: "text", text: "Second paragraph." }] },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual([
      "First paragraph.",
      "A heading",
      "Second paragraph.",
    ])
  })

  it("joins nested text leaves inside one first-level node", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            { type: "text", text: "world", marks: [{ type: "bold" }] },
            { type: "text", text: "!" },
          ],
        },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["Hello   world   !"])
  })

  it("walks deeply nested content (bulletList → listItem → paragraph → text)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item A" }] },
              ],
            },
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Item B" }] },
              ],
            },
          ],
        },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["Item A Item B"])
  })

  it("skips empty first-level nodes", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "valid" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "   " }] },
        { type: "paragraph", content: [{ type: "text", text: "also valid" }] },
      ],
    }
    expect(chunker.chunksFromDoc(doc)).toEqual(["valid", "also valid"])
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- page-chunker
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/services/page-chunker.service.ts`:
```ts
import { Injectable } from "@nestjs/common"

export type TiptapNode = {
  type: string
  text?: string
  content?: TiptapNode[]
  [k: string]: unknown
}

export type TiptapDoc = {
  type: "doc"
  content?: TiptapNode[]
} | null | undefined

@Injectable()
export class PageChunker {
  chunksFromDoc(doc: TiptapDoc): string[] {
    if (!doc || !Array.isArray(doc.content)) return []
    return doc.content
      .map((node) => this.collectText(node).trim())
      .filter((s) => s.length > 0)
  }

  private collectText(node: TiptapNode): string {
    if (node.type === "text") return node.text ?? ""
    if (!Array.isArray(node.content)) return ""
    return node.content.map((c) => this.collectText(c)).join(" ")
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- page-chunker
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/services/page-chunker.service.ts \
        apps/engines/src/apps/indexer/services/page-chunker.service.spec.ts
git commit -m "feat(engines/indexer): add page chunker service"
```

### Task 3.2: ProcessingClient service

**Files:**
- Create: `apps/engines/src/apps/indexer/services/processing-client.service.ts`
- Create: `apps/engines/src/apps/indexer/services/processing-client.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/services/processing-client.service.spec.ts`:
```ts
import axios from "axios"

import { ProcessingClient } from "./processing-client.service"

jest.mock("axios")
const mockedAxios = axios as jest.Mocked<typeof axios>

describe("ProcessingClient", () => {
  const mockPost = jest.fn()

  beforeEach(() => {
    jest.resetAllMocks()
    process.env.PROCESSING_SERVICE_URL = "http://agents.test:8080"
    mockedAxios.create.mockReturnValue({ post: mockPost } as unknown as ReturnType<typeof axios.create>)
  })

  it("posts text and returns normalized string", async () => {
    mockPost.mockResolvedValue({ data: { normalized: "тест", language: "ru" } })
    const client = new ProcessingClient()
    const out = await client.normalize("Тестовый текст", "auto")
    expect(out).toBe("тест")
    expect(mockPost).toHaveBeenCalledWith("/processing/normalize", {
      text: "Тестовый текст",
      language: "auto",
    })
  })

  it("returns empty string when normalized is empty", async () => {
    mockPost.mockResolvedValue({ data: { normalized: "", language: "ru" } })
    const client = new ProcessingClient()
    expect(await client.normalize("!!!", "ru")).toBe("")
  })

  it("throws after retries on 5xx", async () => {
    mockPost.mockRejectedValue({ response: { status: 500 } })
    const client = new ProcessingClient()
    await expect(client.normalize("x", "ru")).rejects.toBeDefined()
    expect(mockPost).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- processing-client
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/services/processing-client.service.ts`:
```ts
import { Injectable, Logger } from "@nestjs/common"
import axios, { AxiosInstance } from "axios"

export type ProcessingLanguage = "ru" | "en" | "auto"

type NormalizeResponse = {
  normalized: string
  language: "ru" | "en"
}

@Injectable()
export class ProcessingClient {
  private readonly log = new Logger(ProcessingClient.name)
  private readonly http: AxiosInstance

  constructor() {
    this.http = axios.create({
      baseURL: process.env.PROCESSING_SERVICE_URL ?? "http://localhost:8080",
      timeout: 10000,
    })
  }

  async normalize(text: string, language: ProcessingLanguage): Promise<string> {
    const maxAttempts = 3
    let lastError: unknown
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await this.http.post<NormalizeResponse>("/processing/normalize", {
          text,
          language,
        })
        return res.data.normalized
      } catch (err) {
        lastError = err
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 200 * 2 ** (attempt - 1)))
        }
      }
    }
    throw lastError
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- processing-client
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/services/processing-client.service.ts \
        apps/engines/src/apps/indexer/services/processing-client.service.spec.ts
git commit -m "feat(engines/indexer): add processing service http client"
```

### Task 3.3: QdrantWriter service

**Files:**
- Create: `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts`
- Create: `apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts`:
```ts
import { QdrantService } from "../../../infra/qdrant/qdrant.service"
import { QdrantWriter } from "./qdrant-writer.service"

describe("QdrantWriter", () => {
  const fakeClient = {
    delete: jest.fn(),
    upsert: jest.fn(),
    getCollections: jest.fn(),
    createCollection: jest.fn(),
  }
  const qdrantService = {
    client: fakeClient,
    collection: "page_chunks",
  } as unknown as QdrantService

  let writer: QdrantWriter

  beforeEach(() => {
    jest.resetAllMocks()
    writer = new QdrantWriter(qdrantService)
  })

  describe("deleteByPageId", () => {
    it("calls delete with filter on pageId", async () => {
      fakeClient.delete.mockResolvedValue({})
      await writer.deleteByPageId("page-1")
      expect(fakeClient.delete).toHaveBeenCalledWith("page_chunks", {
        filter: {
          must: [{ key: "pageId", match: { value: "page-1" } }],
        },
      })
    })
  })

  describe("upsert", () => {
    it("passes through points list", async () => {
      fakeClient.upsert.mockResolvedValue({})
      const points = [
        { id: "a", vector: [0.1, 0.2], payload: { pageId: "p", workspaceId: "w", chunkIndex: 0 } },
      ]
      await writer.upsert(points)
      expect(fakeClient.upsert).toHaveBeenCalledWith("page_chunks", { points })
    })

    it("is a no-op for empty points", async () => {
      await writer.upsert([])
      expect(fakeClient.upsert).not.toHaveBeenCalled()
    })
  })

  describe("ensureCollection", () => {
    it("creates collection if missing", async () => {
      fakeClient.getCollections.mockResolvedValue({ collections: [] })
      await writer.ensureCollection()
      expect(fakeClient.createCollection).toHaveBeenCalledWith("page_chunks", {
        vectors: { size: 768, distance: "Cosine" },
      })
    })

    it("skips if collection exists", async () => {
      fakeClient.getCollections.mockResolvedValue({
        collections: [{ name: "page_chunks" }],
      })
      await writer.ensureCollection()
      expect(fakeClient.createCollection).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- qdrant-writer
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/services/qdrant-writer.service.ts`:
```ts
import { Injectable, Logger } from "@nestjs/common"

import { QdrantService } from "../../../infra/qdrant/qdrant.service"

export type QdrantPoint = {
  id: string
  vector: number[]
  payload: {
    pageId: string
    workspaceId: string
    chunkIndex: number
  }
}

const VECTOR_SIZE = 768

@Injectable()
export class QdrantWriter {
  private readonly log = new Logger(QdrantWriter.name)

  constructor(private readonly qdrant: QdrantService) {}

  async ensureCollection(): Promise<void> {
    const existing = await this.qdrant.client.getCollections()
    const exists = existing.collections?.some((c) => c.name === this.qdrant.collection)
    if (exists) return
    await this.qdrant.client.createCollection(this.qdrant.collection, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    })
    this.log.log(`Created Qdrant collection ${this.qdrant.collection}`)
  }

  async deleteByPageId(pageId: string): Promise<void> {
    await this.qdrant.client.delete(this.qdrant.collection, {
      filter: {
        must: [{ key: "pageId", match: { value: pageId } }],
      },
    })
  }

  async upsert(points: QdrantPoint[]): Promise<void> {
    if (points.length === 0) return
    await this.qdrant.client.upsert(this.qdrant.collection, { points })
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- qdrant-writer
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/services/qdrant-writer.service.ts \
        apps/engines/src/apps/indexer/services/qdrant-writer.service.spec.ts
git commit -m "feat(engines/indexer): add qdrant writer service"
```

### Task 3.4: OutboxCronService

**Files:**
- Create: `apps/engines/src/apps/indexer/cron/outbox-cron.service.ts`
- Create: `apps/engines/src/apps/indexer/cron/outbox-cron.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/cron/outbox-cron.service.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"

import { OutboxCronService } from "./outbox-cron.service"

describe("OutboxCronService", () => {
  const mockPrisma = {
    page: {
      findMany: jest.fn(),
    },
    $executeRaw: jest.fn(),
  } as unknown as PrismaClient

  let service: OutboxCronService

  beforeEach(() => {
    jest.resetAllMocks()
    process.env.INDEXER_QUIET_PERIOD_MINUTES = "5"
    service = new OutboxCronService(mockPrisma)
  })

  it("queries only TEXT pages idle for 5+ minutes", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([])

    await service.tick()

    expect(mockPrisma.page.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: "TEXT",
        ownership: "TEXT",
        deletedAt: null,
        updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
      }),
      select: { id: true, workspaceId: true },
      take: 500,
    })
  })

  it("upserts outbox row per page with ON CONFLICT DO NOTHING", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([
      { id: "p1", workspaceId: "w1" },
      { id: "p2", workspaceId: "w1" },
    ])
    ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1)

    const inserted = await service.tick()

    expect(inserted).toBe(2)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(2)
  })

  it("returns 0 when no eligible pages", async () => {
    ;(mockPrisma.page.findMany as jest.Mock).mockResolvedValue([])
    expect(await service.tick()).toBe(0)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- outbox-cron
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/cron/outbox-cron.service.ts`:
```ts
import { Inject, Injectable, Logger } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers"

@Injectable()
export class OutboxCronService {
  private readonly log = new Logger(OutboxCronService.name)
  private readonly quietPeriodMs: number

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {
    this.quietPeriodMs = Number(process.env.INDEXER_QUIET_PERIOD_MINUTES ?? 5) * 60_000
  }

  @Cron(process.env.INDEXER_CRON_EXPRESSION ?? "*/1 * * * *")
  async tick(): Promise<number> {
    const cutoff = new Date(Date.now() - this.quietPeriodMs)

    const pages = await this.prisma.page.findMany({
      where: {
        type: "TEXT",
        ownership: "TEXT",
        deletedAt: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, workspaceId: true },
      take: 500,
    })

    if (pages.length === 0) return 0

    let inserted = 0
    for (const page of pages) {
      const rows = await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, workspace_id, payload, status)
        VALUES ('page.upserted', 'page', ${page.id}::uuid, ${page.workspaceId}::uuid, '{}'::jsonb, 'PENDING')
        ON CONFLICT DO NOTHING
      `)
      if (rows > 0) inserted++
    }
    if (inserted > 0) this.log.log(`Enqueued ${inserted} page(s) for reindex`)
    return inserted
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- outbox-cron
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/cron/
git commit -m "feat(engines/indexer): add outbox cron scanning idle pages"
```

### Task 3.5: OutboxDrainerService

**Files:**
- Create: `apps/engines/src/apps/indexer/cron/outbox-drainer.service.ts`
- Create: `apps/engines/src/apps/indexer/cron/outbox-drainer.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/cron/outbox-drainer.service.spec.ts`:
```ts
import type { Queue } from "bullmq"
import type { PrismaClient } from "@repo/db"

import { OutboxDrainerService } from "./outbox-drainer.service"

describe("OutboxDrainerService", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  } as unknown as PrismaClient

  const mockQueue = {
    add: jest.fn(),
  } as unknown as Queue

  let service: OutboxDrainerService

  beforeEach(() => {
    jest.resetAllMocks()
    process.env.INDEXER_DRAINER_BATCH = "50"
    service = new OutboxDrainerService(mockPrisma, mockQueue)
  })

  it("claims batch and enqueues jobs", async () => {
    const rows = [
      { id: 1n, page_id: "p1", workspace_id: "w1" },
      { id: 2n, page_id: "p2", workspace_id: "w1" },
    ]
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
      ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce(rows)
      ;(mockPrisma.$executeRaw as jest.Mock).mockResolvedValue(1)
      return fn(mockPrisma)
    })
    ;(mockQueue.add as jest.Mock).mockResolvedValue({})

    const claimed = await service.drain()

    expect(claimed).toBe(2)
    expect(mockQueue.add).toHaveBeenCalledTimes(2)
    expect(mockQueue.add).toHaveBeenNthCalledWith(
      1,
      "index-page",
      { outboxId: "1", pageId: "p1", workspaceId: "w1" },
      expect.any(Object),
    )
  })

  it("returns 0 when no pending rows", async () => {
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
      ;(mockPrisma.$queryRaw as jest.Mock).mockResolvedValueOnce([])
      return fn(mockPrisma)
    })
    expect(await service.drain()).toBe(0)
    expect(mockQueue.add).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- outbox-drainer
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/indexer/cron/outbox-drainer.service.ts`:
```ts
import { randomUUID } from "node:crypto"

import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common"
import { InjectQueue } from "@nestjs/bullmq"
import { Interval } from "@nestjs/schedule"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"
import type { Queue } from "bullmq"

import { PRISMA } from "../../../infra/db/db.providers"

const INDEXING_QUEUE = "indexing"

type ClaimedRow = {
  id: bigint
  page_id: string
  workspace_id: string
}

@Injectable()
export class OutboxDrainerService implements OnModuleInit {
  private readonly log = new Logger(OutboxDrainerService.name)
  private readonly batch: number
  private readonly workerId: string

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @InjectQueue(INDEXING_QUEUE) private readonly queue: Queue,
  ) {
    this.batch = Number(process.env.INDEXER_DRAINER_BATCH ?? 50)
    this.workerId = `engines-${process.env.HOSTNAME ?? randomUUID().slice(0, 8)}`
  }

  onModuleInit(): void {
    this.log.log(`OutboxDrainer ready; worker=${this.workerId} batch=${this.batch}`)
  }

  @Interval(Number(process.env.INDEXER_DRAINER_INTERVAL_MS ?? 5000))
  async drain(): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedRow[]>(Prisma.sql`
        SELECT id, aggregate_id as page_id, workspace_id
        FROM outbox_events
        WHERE event_type = 'page.upserted'
          AND aggregate_type = 'page'
          AND status = 'PENDING'
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at
        LIMIT ${this.batch}
        FOR UPDATE SKIP LOCKED
      `)

      if (rows.length === 0) return 0

      for (const row of rows) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE outbox_events
          SET status = 'PROCESSING', locked_at = now(), locked_by = ${this.workerId}
          WHERE id = ${row.id}
        `)
        await this.queue.add(
          "index-page",
          { outboxId: row.id.toString(), pageId: row.page_id, workspaceId: row.workspace_id },
          { jobId: `outbox-${row.id}`, removeOnComplete: true, removeOnFail: 100 },
        )
      }
      this.log.log(`Drained ${rows.length} outbox row(s) → BullMQ`)
      return rows.length
    })
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- outbox-drainer
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/indexer/cron/outbox-drainer.service.ts \
        apps/engines/src/apps/indexer/cron/outbox-drainer.service.spec.ts
git commit -m "feat(engines/indexer): add outbox → bullmq drainer"
```

### Task 3.6: IndexingProcessor

**Files:**
- Create: `apps/engines/src/apps/indexer/queue/indexing.processor.ts`
- Create: `apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/indexer/queue/indexing.processor.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"
import type { Job } from "bullmq"

import { EmbeddingClient } from "../services/embedding-client.service"
import { PageChunker } from "../services/page-chunker.service"
import { ProcessingClient } from "../services/processing-client.service"
import { QdrantWriter } from "../services/qdrant-writer.service"
import { IndexingProcessor } from "./indexing.processor"

describe("IndexingProcessor", () => {
  const mockPrisma = {
    page: { findUnique: jest.fn() },
    $executeRaw: jest.fn(),
  } as unknown as PrismaClient
  const mockChunker = { chunksFromDoc: jest.fn() } as unknown as PageChunker
  const mockProcessing = { normalize: jest.fn() } as unknown as ProcessingClient
  const mockEmbed = { embed: jest.fn() } as unknown as EmbeddingClient
  const mockQdrant = {
    deleteByPageId: jest.fn(),
    upsert: jest.fn(),
    ensureCollection: jest.fn(),
  } as unknown as QdrantWriter

  let processor: IndexingProcessor

  const makeJob = (data: object): Job => ({ data } as Job)

  beforeEach(() => {
    jest.resetAllMocks()
    processor = new IndexingProcessor(mockPrisma, mockChunker, mockProcessing, mockEmbed, mockQdrant)
  })

  it("deletes points and returns when page is missing", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue(null)

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalledWith("p1")
    expect(mockChunker.chunksFromDoc).not.toHaveBeenCalled()
    expect(mockPrisma.$executeRaw).toHaveBeenCalled() // marks DONE
  })

  it("skips wrong page types but still deletes old points", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "EXCALIDRAW",
      ownership: "TEXT",
      deletedAt: null,
      content: {},
    })

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalled()
    expect(mockChunker.chunksFromDoc).not.toHaveBeenCalled()
  })

  it("processes chunks end-to-end when page is valid", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "TEXT",
      ownership: "TEXT",
      deletedAt: null,
      content: { type: "doc", content: [] },
      workspaceId: "w1",
    })
    ;(mockChunker.chunksFromDoc as jest.Mock).mockReturnValue(["chunk a", "chunk b"])
    ;(mockProcessing.normalize as jest.Mock)
      .mockResolvedValueOnce("a")
      .mockResolvedValueOnce("b")
    ;(mockEmbed.embed as jest.Mock)
      .mockResolvedValueOnce([0.1, 0.2])
      .mockResolvedValueOnce([0.3, 0.4])

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockQdrant.deleteByPageId).toHaveBeenCalledWith("p1")
    expect(mockQdrant.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ vector: [0.1, 0.2], payload: { pageId: "p1", workspaceId: "w1", chunkIndex: 0 } }),
      expect.objectContaining({ vector: [0.3, 0.4], payload: { pageId: "p1", workspaceId: "w1", chunkIndex: 1 } }),
    ])
  })

  it("drops empty normalized chunks", async () => {
    ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
      id: "p1",
      type: "TEXT",
      ownership: "TEXT",
      deletedAt: null,
      content: { type: "doc", content: [] },
      workspaceId: "w1",
    })
    ;(mockChunker.chunksFromDoc as jest.Mock).mockReturnValue(["!!", "real"])
    ;(mockProcessing.normalize as jest.Mock)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("real")
    ;(mockEmbed.embed as jest.Mock).mockResolvedValueOnce([0.5])

    await processor.process(makeJob({ outboxId: "1", pageId: "p1", workspaceId: "w1" }))

    expect(mockEmbed.embed).toHaveBeenCalledTimes(1)
    expect(mockQdrant.upsert).toHaveBeenCalledWith([
      expect.objectContaining({ vector: [0.5], payload: expect.objectContaining({ chunkIndex: 1 }) }),
    ])
  })
})
```

- [ ] **Step 2: Create EmbeddingClient wrapper**

Create `apps/engines/src/apps/indexer/services/embedding-client.service.ts`:
```ts
import { Injectable } from "@nestjs/common"

import { OllamaService } from "../../../infra/ollama/ollama.service"

@Injectable()
export class EmbeddingClient {
  constructor(private readonly ollama: OllamaService) {}

  embed(text: string): Promise<number[]> {
    return this.ollama.embed(text)
  }
}
```

- [ ] **Step 3: Run — verify fail**

```bash
pnpm --filter engines test -- indexing.processor
```

Expected: module not found.

- [ ] **Step 4: Implement processor**

Create `apps/engines/src/apps/indexer/queue/indexing.processor.ts`:
```ts
import { createHash } from "node:crypto"

import { Inject, Logger } from "@nestjs/common"
import { Processor, WorkerHost } from "@nestjs/bullmq"
import type { PrismaClient } from "@repo/db"
import { Prisma } from "@repo/db"
import type { Job } from "bullmq"

import { PRISMA } from "../../../infra/db/db.providers"
import { EmbeddingClient } from "../services/embedding-client.service"
import { PageChunker } from "../services/page-chunker.service"
import { ProcessingClient } from "../services/processing-client.service"
import { QdrantPoint, QdrantWriter } from "../services/qdrant-writer.service"

const INDEXING_QUEUE = "indexing"

export type IndexPageJob = {
  outboxId: string
  pageId: string
  workspaceId: string
}

@Processor(INDEXING_QUEUE)
export class IndexingProcessor extends WorkerHost {
  private readonly log = new Logger(IndexingProcessor.name)

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly chunker: PageChunker,
    private readonly processing: ProcessingClient,
    private readonly embedding: EmbeddingClient,
    private readonly qdrant: QdrantWriter,
  ) {
    super()
  }

  async process(job: Job<IndexPageJob>): Promise<void> {
    const { outboxId, pageId, workspaceId } = job.data
    try {
      const page = await this.prisma.page.findUnique({
        where: { id: pageId },
        select: {
          id: true,
          type: true,
          ownership: true,
          deletedAt: true,
          content: true,
          workspaceId: true,
        },
      })

      await this.qdrant.deleteByPageId(pageId)

      if (
        !page ||
        page.deletedAt ||
        page.type !== "TEXT" ||
        page.ownership !== "TEXT" ||
        !page.content
      ) {
        await this.markDone(outboxId)
        return
      }

      const chunks = this.chunker.chunksFromDoc(page.content as unknown as Parameters<PageChunker["chunksFromDoc"]>[0])
      if (chunks.length === 0) {
        await this.markDone(outboxId)
        return
      }

      const points: QdrantPoint[] = []
      for (let i = 0; i < chunks.length; i++) {
        const normalized = await this.processing.normalize(chunks[i], "auto")
        if (!normalized) continue
        const vector = await this.embedding.embed(normalized)
        points.push({
          id: pointId(pageId, i),
          vector,
          payload: { pageId, workspaceId, chunkIndex: i },
        })
      }

      await this.qdrant.upsert(points)
      await this.markDone(outboxId)
    } catch (err) {
      this.log.error(`Indexing failed for page ${pageId}: ${(err as Error).message}`)
      await this.markFailedOrRetry(outboxId, err as Error)
      throw err
    }
  }

  private async markDone(outboxId: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET status = 'DONE', processed_at = now(), locked_at = NULL, locked_by = NULL
      WHERE id = ${BigInt(outboxId)}
    `)
  }

  private async markFailedOrRetry(outboxId: string, err: Error): Promise<void> {
    const maxAttempts = Number(process.env.INDEXER_MAX_ATTEMPTS ?? 5)
    const rows = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE outbox_events
      SET
        attempts = attempts + 1,
        last_error = ${err.message},
        status = CASE WHEN attempts + 1 >= ${maxAttempts} THEN 'FAILED'::"OutboxEventStatus" ELSE 'PENDING'::"OutboxEventStatus" END,
        next_attempt_at = now() + (LEAST(300, POWER(2, attempts + 1) * 10) * interval '1 second'),
        locked_at = NULL,
        locked_by = NULL
      WHERE id = ${BigInt(outboxId)}
    `)
    void rows
  }
}

function pointId(pageId: string, chunkIndex: number): string {
  const h = createHash("sha256").update(`${pageId}:${chunkIndex}`).digest("hex")
  // UUID v4 layout derived from hash to fit Qdrant's accepted id format
  return (
    h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32)
  )
}
```

- [ ] **Step 5: Run — verify pass**

```bash
pnpm --filter engines test -- indexing.processor
```

Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/indexer/queue apps/engines/src/apps/indexer/services/embedding-client.service.ts
git commit -m "feat(engines/indexer): add bullmq indexing processor"
```

### Task 3.7: IndexerModule wiring

**Files:**
- Create: `apps/engines/src/apps/indexer/indexer.module.ts`
- Modify: `apps/engines/src/app.module.ts`

- [ ] **Step 1: Write IndexerModule**

Create `apps/engines/src/apps/indexer/indexer.module.ts`:
```ts
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"

import { OutboxCronService } from "./cron/outbox-cron.service"
import { OutboxDrainerService } from "./cron/outbox-drainer.service"
import { IndexingProcessor } from "./queue/indexing.processor"
import { EmbeddingClient } from "./services/embedding-client.service"
import { PageChunker } from "./services/page-chunker.service"
import { ProcessingClient } from "./services/processing-client.service"
import { QdrantWriter } from "./services/qdrant-writer.service"

@Module({
  imports: [
    BullModule.registerQueue({
      name: "indexing",
    }),
  ],
  providers: [
    OutboxCronService,
    OutboxDrainerService,
    IndexingProcessor,
    PageChunker,
    ProcessingClient,
    EmbeddingClient,
    QdrantWriter,
  ],
})
export class IndexerModule {}
```

- [ ] **Step 2: Wire BullModule forRoot into AppModule**

Modify `apps/engines/src/app.module.ts`:
```ts
import { BullModule } from "@nestjs/bullmq"
import { Module } from "@nestjs/common"
import { ScheduleModule } from "@nestjs/schedule"

import { IndexerModule } from "./apps/indexer/indexer.module"
import { HealthModule } from "./health/health.module"
import { DbModule } from "./infra/db/db.module"
import { OllamaModule } from "./infra/ollama/ollama.module"
import { QdrantModule } from "./infra/qdrant/qdrant.module"

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    }),
    DbModule,
    QdrantModule,
    OllamaModule,
    IndexerModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Run unit tests**

```bash
pnpm --filter engines test
```

Expected: all passing.

- [ ] **Step 4: Run check-types**

```bash
pnpm --filter engines check-types
```

Expected: no errors.

- [ ] **Step 5: Manual smoke — boot and observe cron**

```bash
docker compose up -d postgres redis qdrant ollama
pnpm --filter engines dev &
sleep 90
kill %1
```

Expected logs: `OutboxCronService` tick, `OutboxDrainer ready`, no crashes.

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/indexer/indexer.module.ts apps/engines/src/app.module.ts
git commit -m "feat(engines/indexer): wire indexer module into app"
```

---

## Phase 4 — MCP Module

### Task 4.1: MCP error taxonomy + exception filter

**Files:**
- Create: `apps/engines/src/apps/mcp/errors/mcp.errors.ts`
- Create: `apps/engines/src/apps/mcp/errors/mcp.errors.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/errors/mcp.errors.spec.ts`:
```ts
import {
  FileNotFoundError,
  FileTooLargeError,
  PageNotFoundError,
  UnsupportedMimeTypeError,
  WorkspaceAccessDeniedError,
} from "./mcp.errors"

describe("MCP errors", () => {
  it("WorkspaceAccessDeniedError → 403 WORKSPACE_ACCESS_DENIED", () => {
    const err = new WorkspaceAccessDeniedError("w1", "u1")
    expect(err.getStatus()).toBe(403)
    expect(err.getResponse()).toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" })
  })

  it("PageNotFoundError → 404", () => {
    expect(new PageNotFoundError("p1").getStatus()).toBe(404)
  })

  it("FileNotFoundError → 404", () => {
    expect(new FileNotFoundError("f1").getStatus()).toBe(404)
  })

  it("FileTooLargeError → 413 with limit in message", () => {
    const err = new FileTooLargeError(5_000_000, 1_048_576)
    expect(err.getStatus()).toBe(413)
    expect((err.getResponse() as { message: string }).message).toContain("attach")
  })

  it("UnsupportedMimeTypeError → 415", () => {
    expect(new UnsupportedMimeTypeError("text/exotic").getStatus()).toBe(415)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- mcp.errors
```

Expected: module not found.

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/errors/mcp.errors.ts`:
```ts
import { HttpException } from "@nestjs/common"

export class WorkspaceAccessDeniedError extends HttpException {
  constructor(workspaceId: string, userId: string) {
    super(
      {
        code: "WORKSPACE_ACCESS_DENIED",
        message: `User ${userId} is not a member of workspace ${workspaceId}`,
      },
      403,
    )
  }
}

export class PageNotFoundError extends HttpException {
  constructor(pageId: string) {
    super({ code: "PAGE_NOT_FOUND", message: `Page ${pageId} not found` }, 404)
  }
}

export class FileNotFoundError extends HttpException {
  constructor(fileId: string) {
    super({ code: "FILE_NOT_FOUND", message: `File ${fileId} not found` }, 404)
  }
}

export class FileTooLargeError extends HttpException {
  constructor(size: number, limit: number) {
    super(
      {
        code: "FILE_TOO_LARGE",
        message: `File size ${size} exceeds inline limit ${limit}. Upload via apps/web and use attachFileToPage instead.`,
      },
      413,
    )
  }
}

export class UnsupportedMimeTypeError extends HttpException {
  constructor(mimeType: string) {
    super({ code: "UNSUPPORTED_MIME_TYPE", message: `MIME type ${mimeType} not supported` }, 415)
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- mcp.errors
```

Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/errors/
git commit -m "feat(engines/mcp): add error taxonomy"
```

### Task 4.2: McpTokenGuard

**Files:**
- Create: `apps/engines/src/apps/mcp/guards/mcp-token.guard.ts`
- Create: `apps/engines/src/apps/mcp/guards/mcp-token.guard.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/guards/mcp-token.guard.spec.ts`:
```ts
import type { ExecutionContext } from "@nestjs/common"

import { McpTokenGuard } from "./mcp-token.guard"

function makeCtx(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: authHeader ? { authorization: authHeader } : {} }),
    }),
  } as ExecutionContext
}

describe("McpTokenGuard", () => {
  beforeEach(() => {
    process.env.ENGINES_MCP_TOKEN = "sekret"
  })

  it("allows valid bearer token", () => {
    const guard = new McpTokenGuard()
    expect(guard.canActivate(makeCtx("Bearer sekret"))).toBe(true)
  })

  it("denies missing header", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx(undefined))).toThrow(/unauthorized/i)
  })

  it("denies wrong token", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx("Bearer nope"))).toThrow(/unauthorized/i)
  })

  it("denies missing Bearer prefix", () => {
    const guard = new McpTokenGuard()
    expect(() => guard.canActivate(makeCtx("sekret"))).toThrow(/unauthorized/i)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- mcp-token.guard
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/guards/mcp-token.guard.ts`:
```ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common"

@Injectable()
export class McpTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>()
    const header = req.headers.authorization
    const expected = process.env.ENGINES_MCP_TOKEN
    if (!expected) throw new UnauthorizedException("MCP token not configured")
    if (!header) throw new UnauthorizedException("Missing Authorization header")
    if (!header.startsWith("Bearer ")) throw new UnauthorizedException("Bearer prefix required")
    const token = header.slice(7)
    if (token !== expected) throw new UnauthorizedException("Invalid token")
    return true
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- mcp-token.guard
```

Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/guards/
git commit -m "feat(engines/mcp): add bearer token guard"
```

### Task 4.3: WorkspaceMemberGuard

**Files:**
- Create: `apps/engines/src/apps/mcp/guards/workspace-member.guard.ts`
- Create: `apps/engines/src/apps/mcp/guards/workspace-member.guard.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/guards/workspace-member.guard.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"

import { WorkspaceMemberGuard } from "./workspace-member.guard"

describe("WorkspaceMemberGuard", () => {
  const mockPrisma = {
    workspaceMember: { findUnique: jest.fn() },
  } as unknown as PrismaClient

  let guard: WorkspaceMemberGuard

  beforeEach(() => {
    jest.resetAllMocks()
    guard = new WorkspaceMemberGuard(mockPrisma)
  })

  it("allows when member exists", async () => {
    ;(mockPrisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue({ userId: "u1" })
    await expect(guard.assert("w1", "u1")).resolves.toBeUndefined()
  })

  it("throws WorkspaceAccessDeniedError when not a member", async () => {
    ;(mockPrisma.workspaceMember.findUnique as jest.Mock).mockResolvedValue(null)
    await expect(guard.assert("w1", "u1")).rejects.toThrow(/access/i)
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- workspace-member.guard
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/guards/workspace-member.guard.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers"
import { WorkspaceAccessDeniedError } from "../errors/mcp.errors"

@Injectable()
export class WorkspaceMemberGuard {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async assert(workspaceId: string, userId: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { userId: true },
    })
    if (!member) throw new WorkspaceAccessDeniedError(workspaceId, userId)
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- workspace-member.guard
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/guards/workspace-member.guard.ts \
        apps/engines/src/apps/mcp/guards/workspace-member.guard.spec.ts
git commit -m "feat(engines/mcp): add workspace member guard (plain service)"
```

### Task 4.4: MarkdownRendererService

**Files:**
- Create: `apps/engines/src/apps/mcp/services/markdown-renderer.service.ts`
- Create: `apps/engines/src/apps/mcp/services/markdown-renderer.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/services/markdown-renderer.service.spec.ts`:
```ts
import { MarkdownRenderer } from "./markdown-renderer.service"

describe("MarkdownRenderer", () => {
  const renderer = new MarkdownRenderer()

  it("renders empty doc as empty string", () => {
    expect(renderer.render({ type: "doc", content: [] })).toBe("")
  })

  it("renders paragraph", () => {
    expect(
      renderer.render({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
        ],
      }),
    ).toBe("Hello")
  })

  it("renders heading with correct level", () => {
    expect(
      renderer.render({
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
        ],
      }),
    ).toBe("## Title")
  })

  it("renders marks bold/italic/code/link", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "bold" }] },
            { type: "text", text: " y", marks: [{ type: "italic" }] },
            { type: "text", text: " z", marks: [{ type: "code" }] },
            {
              type: "text",
              text: " a",
              marks: [{ type: "link", attrs: { href: "https://x" } }],
            },
          ],
        },
      ],
    }
    const rendered = renderer.render(doc)
    expect(rendered).toContain("**x**")
    expect(rendered).toContain("_ y_")
    expect(rendered).toContain("` z`")
    expect(rendered).toContain("[ a](https://x)")
  })

  it("renders bullet list", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
          ],
        },
      ],
    }
    expect(renderer.render(doc)).toBe("- A\n- B")
  })

  it("renders ordered list", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "orderedList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "B" }] }] },
          ],
        },
      ],
    }
    expect(renderer.render(doc)).toBe("1. A\n2. B")
  })

  it("renders code block with language", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [{ type: "text", text: "const x = 1" }],
        },
      ],
    }
    expect(renderer.render(doc)).toBe("```ts\nconst x = 1\n```")
  })

  it("renders blockquote", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "quoted" }] }] },
      ],
    }
    expect(renderer.render(doc)).toBe("> quoted")
  })

  it("renders horizontal rule", () => {
    expect(renderer.render({ type: "doc", content: [{ type: "horizontalRule" }] })).toBe("---")
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- markdown-renderer
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/services/markdown-renderer.service.ts`:
```ts
import { Injectable } from "@nestjs/common"

type Node = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  content?: Node[]
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

type Doc = { type: "doc"; content?: Node[] }

@Injectable()
export class MarkdownRenderer {
  render(doc: Doc | null | undefined): string {
    if (!doc || !doc.content) return ""
    return doc.content.map((n) => this.renderNode(n)).join("\n\n").trimEnd()
  }

  private renderNode(node: Node): string {
    switch (node.type) {
      case "paragraph":
        return this.renderInline(node.content ?? [])
      case "heading": {
        const level = Math.max(1, Math.min(6, Number(node.attrs?.level ?? 1)))
        return `${"#".repeat(level)} ${this.renderInline(node.content ?? [])}`
      }
      case "bulletList":
        return (node.content ?? []).map((li) => `- ${this.renderListItem(li)}`).join("\n")
      case "orderedList":
        return (node.content ?? []).map((li, i) => `${i + 1}. ${this.renderListItem(li)}`).join("\n")
      case "blockquote":
        return (node.content ?? []).map((n) => `> ${this.renderNode(n)}`).join("\n")
      case "codeBlock": {
        const lang = typeof node.attrs?.language === "string" ? node.attrs.language : ""
        return "```" + lang + "\n" + (node.content?.map((c) => c.text ?? "").join("") ?? "") + "\n```"
      }
      case "horizontalRule":
        return "---"
      case "hardBreak":
        return "  \n"
      case "text":
        return this.renderText(node)
      default:
        return this.renderInline(node.content ?? [])
    }
  }

  private renderListItem(li: Node): string {
    return (li.content ?? []).map((n) => this.renderNode(n)).join(" ")
  }

  private renderInline(nodes: Node[]): string {
    return nodes.map((n) => this.renderNode(n)).join("")
  }

  private renderText(node: Node): string {
    let out = node.text ?? ""
    for (const mark of node.marks ?? []) {
      if (mark.type === "bold") out = `**${out}**`
      else if (mark.type === "italic") out = `_${out}_`
      else if (mark.type === "code") out = `\`${out}\``
      else if (mark.type === "link") {
        const href = typeof mark.attrs?.href === "string" ? mark.attrs.href : ""
        out = `[${out}](${href})`
      }
    }
    return out
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- markdown-renderer
```

Expected: 9 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/markdown-renderer.service.ts \
        apps/engines/src/apps/mcp/services/markdown-renderer.service.spec.ts
git commit -m "feat(engines/mcp): add tiptap → markdown renderer"
```

### Task 4.5: PageWriterService

**Files:**
- Create: `apps/engines/src/apps/mcp/services/page-writer.service.ts`
- Create: `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/services/page-writer.service.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"

import { PageWriter } from "./page-writer.service"

describe("PageWriter", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    page: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    outboxEvent: { create: jest.fn() },
  } as unknown as PrismaClient

  let writer: PageWriter

  beforeEach(() => {
    jest.resetAllMocks()
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: PrismaClient) => unknown) => fn(mockPrisma))
    writer = new PageWriter(mockPrisma)
  })

  describe("createPage", () => {
    it("creates page and enqueues outbox", async () => {
      ;(mockPrisma.page.create as jest.Mock).mockResolvedValue({ id: "p1" })

      const id = await writer.createPage({
        userId: "u1",
        workspaceId: "w1",
        title: "Test",
        ownership: "TEXT",
      })

      expect(id).toBe("p1")
      expect(mockPrisma.page.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: "w1",
          title: "Test",
          ownership: "TEXT",
          createdById: "u1",
          updatedById: "u1",
        }),
      })
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: "p1",
          workspaceId: "w1",
        }),
      })
    })
  })

  describe("updatePage", () => {
    it("rejects when page belongs to another workspace", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: "p1",
        workspaceId: "other",
      })
      await expect(
        writer.updatePage({ userId: "u1", workspaceId: "w1", pageId: "p1", title: "x" }),
      ).rejects.toThrow(/not found/i)
    })

    it("updates page and enqueues outbox", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "w1" })
      ;(mockPrisma.page.update as jest.Mock).mockResolvedValue({ id: "p1" })

      await writer.updatePage({ userId: "u1", workspaceId: "w1", pageId: "p1", title: "new" })

      expect(mockPrisma.page.update).toHaveBeenCalled()
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- page-writer
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/services/page-writer.service.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers"
import { PageNotFoundError } from "../errors/mcp.errors"

export type CreatePageInput = {
  userId: string
  workspaceId: string
  parentId?: string | null
  title: string
  ownership?: "TEXT" | "SKILL" | "AGENT"
}

export type UpdatePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  title?: string
  icon?: string | null
  content?: unknown
}

export type MovePageInput = {
  userId: string
  workspaceId: string
  pageId: string
  newParentId?: string | null
  prevPageId?: string | null
}

@Injectable()
export class PageWriter {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async createPage(input: CreatePageInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.create({
        data: {
          workspaceId: input.workspaceId,
          parentId: input.parentId ?? null,
          title: input.title,
          ownership: input.ownership ?? "TEXT",
          type: "TEXT",
          createdById: input.userId,
          updatedById: input.userId,
        },
        select: { id: true },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: page.id,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
      return page.id
    })
  }

  async updatePage(input: UpdatePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          title: input.title,
          icon: input.icon,
          content: input.content as never,
          updatedById: input.userId,
        },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }

  async movePage(input: MovePageInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      await tx.page.update({
        where: { id: input.pageId },
        data: {
          parentId: input.newParentId ?? null,
          prevPageId: input.prevPageId ?? null,
          updatedById: input.userId,
        },
      })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- page-writer
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/page-writer.service.ts \
        apps/engines/src/apps/mcp/services/page-writer.service.spec.ts
git commit -m "feat(engines/mcp): add page writer service"
```

### Task 4.6: FileUploaderService

**Files:**
- Create: `apps/engines/src/apps/mcp/services/file-uploader.service.ts`
- Create: `apps/engines/src/apps/mcp/services/file-uploader.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/services/file-uploader.service.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"
import type { StorageClient } from "@repo/storage"

import { FileUploader, IMAGE_MIME_TYPES } from "./file-uploader.service"

describe("FileUploader", () => {
  const mockPrisma = {
    $transaction: jest.fn(),
    file: { create: jest.fn(), findUnique: jest.fn() },
    pageFile: { create: jest.fn() },
    outboxEvent: { create: jest.fn() },
    page: { findUnique: jest.fn() },
  } as unknown as PrismaClient
  const mockStorage = { put: jest.fn() } as unknown as StorageClient

  let uploader: FileUploader

  beforeEach(() => {
    jest.resetAllMocks()
    process.env.UPLOAD_INLINE_MAX_BYTES = "1048576"
    ;(mockPrisma.$transaction as jest.Mock).mockImplementation(async (fn: (tx: PrismaClient) => unknown) => fn(mockPrisma))
    uploader = new FileUploader(mockPrisma, mockStorage)
  })

  describe("uploadInline", () => {
    it("rejects oversize file", async () => {
      const big = Buffer.alloc(2_000_000)
      await expect(
        uploader.uploadInline({
          userId: "u1",
          workspaceId: "w1",
          pageId: "p1",
          fileName: "a.bin",
          mimeType: "application/octet-stream",
          buffer: big,
          imageOnly: false,
        }),
      ).rejects.toThrow(/FILE_TOO_LARGE/i)
    })

    it("rejects non-image mime when imageOnly=true", async () => {
      await expect(
        uploader.uploadInline({
          userId: "u1",
          workspaceId: "w1",
          pageId: "p1",
          fileName: "a.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("x"),
          imageOnly: true,
        }),
      ).rejects.toThrow(/UNSUPPORTED_MIME_TYPE/i)
    })

    it("rejects when page not in workspace", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "other" })
      await expect(
        uploader.uploadInline({
          userId: "u1",
          workspaceId: "w1",
          pageId: "p1",
          fileName: "a.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("x"),
          imageOnly: false,
        }),
      ).rejects.toThrow(/PAGE_NOT_FOUND/i)
    })

    it("uploads and links small file", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "w1" })
      ;(mockPrisma.file.create as jest.Mock).mockResolvedValue({ id: "f1" })

      const id = await uploader.uploadInline({
        userId: "u1",
        workspaceId: "w1",
        pageId: "p1",
        fileName: "a.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("hello"),
        imageOnly: false,
      })

      expect(id).toBe("f1")
      expect(mockStorage.put).toHaveBeenCalled()
      expect(mockPrisma.pageFile.create).toHaveBeenCalled()
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })
  })

  describe("attach", () => {
    it("rejects cross-workspace attach", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "w1" })
      ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({ id: "f1", workspaceId: "other", mimeType: "text/plain" })
      await expect(
        uploader.attach({ userId: "u1", workspaceId: "w1", pageId: "p1", fileId: "f1", imageOnly: false }),
      ).rejects.toThrow(/FILE_NOT_FOUND/i)
    })

    it("links existing file", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({ id: "p1", workspaceId: "w1" })
      ;(mockPrisma.file.findUnique as jest.Mock).mockResolvedValue({ id: "f1", workspaceId: "w1", mimeType: "text/plain" })

      await uploader.attach({ userId: "u1", workspaceId: "w1", pageId: "p1", fileId: "f1", imageOnly: false })

      expect(mockPrisma.pageFile.create).toHaveBeenCalledWith({
        data: { pageId: "p1", fileId: "f1" },
      })
      expect(mockPrisma.outboxEvent.create).toHaveBeenCalled()
    })

    it("validates image mime on imageOnly attach", () => {
      expect(IMAGE_MIME_TYPES).toContain("image/png")
    })
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- file-uploader
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/services/file-uploader.service.ts`:
```ts
import { createHash } from "node:crypto"
import { extname } from "node:path"

import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"
import { storage, type StorageClient } from "@repo/storage"

import { PRISMA } from "../../../infra/db/db.providers"
import {
  FileNotFoundError,
  FileTooLargeError,
  PageNotFoundError,
  UnsupportedMimeTypeError,
} from "../errors/mcp.errors"

export const STORAGE = Symbol("STORAGE_CLIENT")

export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"]

export type UploadInlineInput = {
  userId: string
  workspaceId: string
  pageId: string
  fileName: string
  mimeType: string
  buffer: Buffer
  imageOnly: boolean
}

export type AttachInput = {
  userId: string
  workspaceId: string
  pageId: string
  fileId: string
  imageOnly: boolean
}

@Injectable()
export class FileUploader {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(STORAGE) private readonly storage: StorageClient = storage,
  ) {}

  async uploadInline(input: UploadInlineInput): Promise<string> {
    const limit = Number(process.env.UPLOAD_INLINE_MAX_BYTES ?? 1_048_576)
    if (input.buffer.length > limit) {
      throw new FileTooLargeError(input.buffer.length, limit)
    }
    if (input.imageOnly && !IMAGE_MIME_TYPES.includes(input.mimeType)) {
      throw new UnsupportedMimeTypeError(input.mimeType)
    }

    return this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }

      const hash = createHash("sha256").update(input.buffer).digest("hex")
      const ext = (extname(input.fileName).replace(/^\./, "") || "bin").slice(0, 16)

      const file = await tx.file.create({
        data: {
          userId: input.userId,
          workspaceId: input.workspaceId,
          name: input.fileName,
          ext,
          fileSize: BigInt(input.buffer.length),
          mimeType: input.mimeType,
          hash,
          path: "pending",
          status: "ACTIVE",
        },
        select: { id: true },
      })

      const key = `workspaces/${input.workspaceId}/files/${file.id}.${ext}`
      await this.storage.put(key, input.buffer, { contentType: input.mimeType, size: input.buffer.length })
      await tx.file.update({ where: { id: file.id }, data: { path: key } })

      await tx.pageFile.create({ data: { pageId: input.pageId, fileId: file.id } })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })

      return file.id
    })
  }

  async attach(input: AttachInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const page = await tx.page.findUnique({
        where: { id: input.pageId },
        select: { id: true, workspaceId: true },
      })
      if (!page || page.workspaceId !== input.workspaceId) {
        throw new PageNotFoundError(input.pageId)
      }
      const file = await tx.file.findUnique({
        where: { id: input.fileId },
        select: { id: true, workspaceId: true, mimeType: true },
      })
      if (!file || file.workspaceId !== input.workspaceId) {
        throw new FileNotFoundError(input.fileId)
      }
      if (input.imageOnly && !IMAGE_MIME_TYPES.includes(file.mimeType)) {
        throw new UnsupportedMimeTypeError(file.mimeType)
      }
      await tx.pageFile.create({ data: { pageId: input.pageId, fileId: input.fileId } })
      await tx.outboxEvent.create({
        data: {
          eventType: "page.upserted",
          aggregateType: "page",
          aggregateId: input.pageId,
          workspaceId: input.workspaceId,
          payload: {},
        },
      })
    })
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- file-uploader
```

Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/file-uploader.service.ts \
        apps/engines/src/apps/mcp/services/file-uploader.service.spec.ts
git commit -m "feat(engines/mcp): add file uploader service"
```

### Task 4.7: StatsService

**Files:**
- Create: `apps/engines/src/apps/mcp/services/stats.service.ts`
- Create: `apps/engines/src/apps/mcp/services/stats.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/engines/src/apps/mcp/services/stats.service.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"

import { StatsService } from "./stats.service"

describe("StatsService", () => {
  const mockPrisma = {
    workspaceMember: { findMany: jest.fn() },
    page: { groupBy: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  } as unknown as PrismaClient

  let svc: StatsService

  beforeEach(() => {
    jest.resetAllMocks()
    svc = new StatsService(mockPrisma)
  })

  describe("getWorkspaceStats", () => {
    it("aggregates members, pagesByType, totalPages", async () => {
      ;(mockPrisma.workspaceMember.findMany as jest.Mock).mockResolvedValue([
        { userId: "u1", role: "OWNER", user: { id: "u1", firstName: "Ann", lastName: "A", email: "a@a" } },
      ])
      ;(mockPrisma.page.groupBy as jest.Mock).mockResolvedValue([
        { type: "TEXT", _count: { _all: 3 } },
        { type: "EXCALIDRAW", _count: { _all: 1 } },
      ])
      ;(mockPrisma.page.count as jest.Mock).mockResolvedValue(4)

      const stats = await svc.getWorkspaceStats("w1")

      expect(stats).toEqual({
        members: [{ id: "u1", firstName: "Ann", lastName: "A", email: "a@a", role: "OWNER" }],
        pagesByType: { TEXT: 3, EXCALIDRAW: 1 },
        totalPages: 4,
      })
    })
  })

  describe("getPageStats", () => {
    it("returns page metadata", async () => {
      const created = new Date("2026-01-01")
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: "p1",
        workspaceId: "w1",
        type: "TEXT",
        ownership: "TEXT",
        createdAt: created,
        createdBy: { id: "u1", firstName: "Ann", lastName: "A", email: "a@a" },
      })

      const stats = await svc.getPageStats("p1", "w1")

      expect(stats.type).toBe("TEXT")
      expect(stats.createdAt).toEqual(created)
      expect(stats.createdBy?.id).toBe("u1")
    })

    it("throws when page in other workspace", async () => {
      ;(mockPrisma.page.findUnique as jest.Mock).mockResolvedValue({
        id: "p1",
        workspaceId: "other",
      })
      await expect(svc.getPageStats("p1", "w1")).rejects.toThrow(/not found/i)
    })
  })
})
```

- [ ] **Step 2: Run — verify fail**

```bash
pnpm --filter engines test -- stats.service
```

- [ ] **Step 3: Implement**

Create `apps/engines/src/apps/mcp/services/stats.service.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import type { PrismaClient } from "@repo/db"

import { PRISMA } from "../../../infra/db/db.providers"
import { PageNotFoundError } from "../errors/mcp.errors"

@Injectable()
export class StatsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async getWorkspaceStats(workspaceId: string) {
    const [members, grouped, totalPages] = await Promise.all([
      this.prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: {
          userId: true,
          role: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.page.groupBy({
        by: ["type"],
        where: { workspaceId, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.page.count({ where: { workspaceId, deletedAt: null } }),
    ])

    const pagesByType: Record<string, number> = {}
    for (const row of grouped) {
      pagesByType[row.type as string] = (row._count as { _all: number })._all
    }

    return {
      members: members.map((m) => ({
        id: m.user.id,
        firstName: m.user.firstName,
        lastName: m.user.lastName,
        email: m.user.email,
        role: m.role,
      })),
      pagesByType,
      totalPages,
    }
  }

  async getPageStats(pageId: string, workspaceId: string) {
    const page = await this.prisma.page.findUnique({
      where: { id: pageId },
      select: {
        id: true,
        workspaceId: true,
        type: true,
        ownership: true,
        createdAt: true,
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    })
    if (!page || page.workspaceId !== workspaceId) throw new PageNotFoundError(pageId)
    return {
      type: page.type,
      ownership: page.ownership,
      createdAt: page.createdAt,
      createdBy: page.createdBy,
    }
  }
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter engines test -- stats.service
```

Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/engines/src/apps/mcp/services/stats.service.ts \
        apps/engines/src/apps/mcp/services/stats.service.spec.ts
git commit -m "feat(engines/mcp): add stats service"
```

### Task 4.8: MCP tool classes

**Files:**
- Create: `apps/engines/src/apps/mcp/tools/page.tools.ts`
- Create: `apps/engines/src/apps/mcp/tools/page-file.tools.ts`
- Create: `apps/engines/src/apps/mcp/tools/workspace.tools.ts`
- Create: `apps/engines/src/apps/mcp/tools/tools.spec.ts`

> **Note on `@rekog/mcp-nest`:** tools are declared on `@Injectable()` providers via `@Tool({ name, description, parameters })` where `parameters` is a Zod schema. The library converts Zod to JSON Schema automatically. Method signature must accept the parsed args object and return any serializable value. See `node_modules/@rekog/mcp-nest/README.md` for details.

- [ ] **Step 1: Write page.tools.ts**

Create `apps/engines/src/apps/mcp/tools/page.tools.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers"
import { PageNotFoundError } from "../errors/mcp.errors"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard"
import { MarkdownRenderer } from "../services/markdown-renderer.service"
import { PageWriter } from "../services/page-writer.service"
import { StatsService } from "../services/stats.service"

const UserWorkspace = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

@Injectable()
export class PageTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly writer: PageWriter,
    private readonly renderer: MarkdownRenderer,
    private readonly stats: StatsService,
  ) {}

  @Tool({
    name: "createPage",
    description: "Create a new page in a workspace",
    parameters: UserWorkspace.extend({
      parentId: z.string().uuid().nullable().optional(),
      title: z.string().min(1).max(255),
      ownership: z.enum(["TEXT", "SKILL", "AGENT"]).default("TEXT"),
    }),
  })
  async createPage(args: z.infer<typeof UserWorkspace> & { title: string; parentId?: string | null; ownership?: "TEXT" | "SKILL" | "AGENT" }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const pageId = await this.writer.createPage({
      userId: args.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title: args.title,
      ownership: args.ownership,
    })
    return { pageId }
  }

  @Tool({
    name: "updatePage",
    description: "Update page title/icon/content",
    parameters: UserWorkspace.extend({
      pageId: z.string().uuid(),
      title: z.string().max(255).optional(),
      icon: z.string().nullable().optional(),
      content: z.unknown().optional(),
    }),
  })
  async updatePage(args: {
    userId: string
    workspaceId: string
    pageId: string
    title?: string
    icon?: string | null
    content?: unknown
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.writer.updatePage(args)
    return { ok: true as const }
  }

  @Tool({
    name: "movePage",
    description: "Move a page to a new parent or reorder",
    parameters: UserWorkspace.extend({
      pageId: z.string().uuid(),
      newParentId: z.string().uuid().nullable().optional(),
      prevPageId: z.string().uuid().nullable().optional(),
    }),
  })
  async movePage(args: {
    userId: string
    workspaceId: string
    pageId: string
    newParentId?: string | null
    prevPageId?: string | null
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.writer.movePage(args)
    return { ok: true as const }
  }

  @Tool({
    name: "getPageMarkdown",
    description: "Render page content as Markdown",
    parameters: UserWorkspace.extend({ pageId: z.string().uuid() }),
  })
  async getPageMarkdown(args: { userId: string; workspaceId: string; pageId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true, content: true },
    })
    if (!page || page.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.pageId)
    return { markdown: this.renderer.render(page.content as never) }
  }

  @Tool({
    name: "getPageStats",
    description: "Return page metadata (creator, creation date, type, ownership)",
    parameters: UserWorkspace.extend({ pageId: z.string().uuid() }),
  })
  async getPageStats(args: { userId: string; workspaceId: string; pageId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.stats.getPageStats(args.pageId, args.workspaceId)
  }
}
```

- [ ] **Step 2: Write page-file.tools.ts**

Create `apps/engines/src/apps/mcp/tools/page-file.tools.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers"
import { PageNotFoundError } from "../errors/mcp.errors"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard"
import { FileUploader } from "../services/file-uploader.service"

const UserWorkspace = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

const UploadInline = UserWorkspace.extend({
  pageId: z.string().uuid(),
  fileName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  contentBase64: z.string().min(1),
})

const Attach = UserWorkspace.extend({
  pageId: z.string().uuid(),
  fileId: z.string().uuid(),
})

@Injectable()
export class PageFileTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly uploader: FileUploader,
  ) {}

  @Tool({ name: "uploadFileToPage", description: "Upload a small file (≤1MB) to a page inline via base64", parameters: UploadInline })
  async uploadFileToPage(args: z.infer<typeof UploadInline>) {
    await this.guard.assert(args.workspaceId, args.userId)
    const buffer = Buffer.from(args.contentBase64, "base64")
    const fileId = await this.uploader.uploadInline({
      userId: args.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: false,
    })
    return { fileId }
  }

  @Tool({ name: "uploadImageToPage", description: "Upload a small image (≤1MB) to a page inline via base64", parameters: UploadInline })
  async uploadImageToPage(args: z.infer<typeof UploadInline>) {
    await this.guard.assert(args.workspaceId, args.userId)
    const buffer = Buffer.from(args.contentBase64, "base64")
    const fileId = await this.uploader.uploadInline({
      userId: args.userId,
      workspaceId: args.workspaceId,
      pageId: args.pageId,
      fileName: args.fileName,
      mimeType: args.mimeType,
      buffer,
      imageOnly: true,
    })
    return { fileId }
  }

  @Tool({ name: "attachFileToPage", description: "Attach an existing workspace file to a page by id", parameters: Attach })
  async attachFileToPage(args: z.infer<typeof Attach>) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.uploader.attach({ ...args, imageOnly: false })
    return { ok: true as const }
  }

  @Tool({ name: "attachImageToPage", description: "Attach an existing workspace image to a page by id", parameters: Attach })
  async attachImageToPage(args: z.infer<typeof Attach>) {
    await this.guard.assert(args.workspaceId, args.userId)
    await this.uploader.attach({ ...args, imageOnly: true })
    return { ok: true as const }
  }

  @Tool({
    name: "listPageFiles",
    description: "List files attached to a page",
    parameters: UserWorkspace.extend({ pageId: z.string().uuid() }),
  })
  async listPageFiles(args: { userId: string; workspaceId: string; pageId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const page = await this.prisma.page.findUnique({
      where: { id: args.pageId },
      select: { workspaceId: true },
    })
    if (!page || page.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.pageId)
    const files = await this.prisma.pageFile.findMany({
      where: { pageId: args.pageId },
      select: {
        file: {
          select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
        },
      },
    })
    return {
      files: files.map((f) => ({
        id: f.file.id,
        name: f.file.name,
        mimeType: f.file.mimeType,
        size: Number(f.file.fileSize),
        createdAt: f.file.createdAt,
      })),
    }
  }
}
```

- [ ] **Step 3: Write workspace.tools.ts**

Create `apps/engines/src/apps/mcp/tools/workspace.tools.ts`:
```ts
import { Inject, Injectable } from "@nestjs/common"
import { Tool } from "@rekog/mcp-nest"
import type { PrismaClient } from "@repo/db"
import { z } from "zod"

import { PRISMA } from "../../../infra/db/db.providers"
import { PageNotFoundError } from "../errors/mcp.errors"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard"
import { PageWriter } from "../services/page-writer.service"
import { StatsService } from "../services/stats.service"

const UserWorkspace = z.object({
  userId: z.string().uuid(),
  workspaceId: z.string().uuid(),
})

@Injectable()
export class WorkspaceTools {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly guard: WorkspaceMemberGuard,
    private readonly writer: PageWriter,
    private readonly stats: StatsService,
  ) {}

  @Tool({ name: "getWorkspaceStats", description: "Workspace members, pages-by-type, total pages", parameters: UserWorkspace })
  async getWorkspaceStats(args: { userId: string; workspaceId: string }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.stats.getWorkspaceStats(args.workspaceId)
  }

  @Tool({
    name: "listWorkspaceFiles",
    description: "List all files in a workspace",
    parameters: UserWorkspace.extend({
      limit: z.number().int().positive().max(200).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
  })
  async listWorkspaceFiles(args: { userId: string; workspaceId: string; limit: number; offset: number }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const files = await this.prisma.file.findMany({
      where: { workspaceId: args.workspaceId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: args.limit,
      skip: args.offset,
      select: { id: true, name: true, mimeType: true, fileSize: true, createdAt: true },
    })
    return {
      files: files.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: Number(f.fileSize),
        createdAt: f.createdAt,
      })),
    }
  }

  @Tool({
    name: "listSkills",
    description: "List skill pages (ownership=SKILL) in a workspace",
    parameters: UserWorkspace.extend({ limit: z.number().int().positive().max(200).default(50) }),
  })
  async listSkills(args: { userId: string; workspaceId: string; limit: number }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.listOwnershipPages(args.workspaceId, "SKILL", args.limit)
  }

  @Tool({
    name: "listAgents",
    description: "List agent pages (ownership=AGENT) in a workspace",
    parameters: UserWorkspace.extend({ limit: z.number().int().positive().max(200).default(50) }),
  })
  async listAgents(args: { userId: string; workspaceId: string; limit: number }) {
    await this.guard.assert(args.workspaceId, args.userId)
    return this.listOwnershipPages(args.workspaceId, "AGENT", args.limit)
  }

  @Tool({
    name: "createPageFromFile",
    description: "Create a page and attach an existing workspace file to it",
    parameters: UserWorkspace.extend({
      parentId: z.string().uuid().nullable().optional(),
      fileId: z.string().uuid(),
      title: z.string().min(1).max(255).optional(),
    }),
  })
  async createPageFromFile(args: {
    userId: string
    workspaceId: string
    parentId?: string | null
    fileId: string
    title?: string
  }) {
    await this.guard.assert(args.workspaceId, args.userId)
    const file = await this.prisma.file.findUnique({
      where: { id: args.fileId },
      select: { id: true, workspaceId: true, name: true },
    })
    if (!file || file.workspaceId !== args.workspaceId) throw new PageNotFoundError(args.fileId)
    const title = args.title ?? file.name
    const pageId = await this.writer.createPage({
      userId: args.userId,
      workspaceId: args.workspaceId,
      parentId: args.parentId,
      title,
      ownership: "TEXT",
    })
    await this.prisma.pageFile.create({ data: { pageId, fileId: args.fileId } })
    return { pageId }
  }

  private async listOwnershipPages(workspaceId: string, ownership: "SKILL" | "AGENT", limit: number) {
    const pages = await this.prisma.page.findMany({
      where: { workspaceId, ownership, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, icon: true, createdAt: true },
    })
    return { pages }
  }
}
```

- [ ] **Step 4: Write smoke tests for tool classes**

Create `apps/engines/src/apps/mcp/tools/tools.spec.ts`:
```ts
import type { PrismaClient } from "@repo/db"

import { WorkspaceAccessDeniedError } from "../errors/mcp.errors"
import { WorkspaceMemberGuard } from "../guards/workspace-member.guard"
import { FileUploader } from "../services/file-uploader.service"
import { MarkdownRenderer } from "../services/markdown-renderer.service"
import { PageWriter } from "../services/page-writer.service"
import { StatsService } from "../services/stats.service"
import { PageTools } from "./page.tools"
import { WorkspaceTools } from "./workspace.tools"

describe("Tools access control", () => {
  const mockPrisma = {
    workspaceMember: { findUnique: jest.fn().mockResolvedValue(null) },
  } as unknown as PrismaClient

  it("PageTools.createPage denies non-member", async () => {
    const guard = new WorkspaceMemberGuard(mockPrisma)
    const tools = new PageTools(
      mockPrisma,
      guard,
      {} as PageWriter,
      {} as MarkdownRenderer,
      {} as StatsService,
    )
    await expect(
      tools.createPage({
        userId: "u1",
        workspaceId: "w1",
        title: "x",
      }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })

  it("WorkspaceTools.getWorkspaceStats denies non-member", async () => {
    const guard = new WorkspaceMemberGuard(mockPrisma)
    const tools = new WorkspaceTools(
      mockPrisma,
      guard,
      {} as PageWriter,
      {} as StatsService,
    )
    await expect(
      tools.getWorkspaceStats({ userId: "u1", workspaceId: "w1" }),
    ).rejects.toBeInstanceOf(WorkspaceAccessDeniedError)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter engines test
```

Expected: all passing.

- [ ] **Step 6: Commit tools**

```bash
git add apps/engines/src/apps/mcp/tools
git commit -m "feat(engines/mcp): add 15 MCP tools with zod schemas"
```

### Task 4.9: McpModule wiring + global exception filter

**Files:**
- Create: `apps/engines/src/apps/mcp/mcp.module.ts`
- Create: `apps/engines/src/apps/mcp/errors/mcp-exception.filter.ts`
- Modify: `apps/engines/src/app.module.ts`
- Modify: `apps/engines/src/main.ts`

- [ ] **Step 1: Write MCP exception filter**

Create `apps/engines/src/apps/mcp/errors/mcp-exception.filter.ts`:
```ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common"
import type { Response } from "express"

@Catch(HttpException)
export class McpExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger(McpExceptionFilter.name)

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const res = ctx.getResponse<Response>()
    const status = exception.getStatus()
    const body = exception.getResponse()
    this.log.warn(`MCP error ${status}: ${JSON.stringify(body)}`)
    res.status(status).json(typeof body === "string" ? { message: body } : body)
  }
}
```

- [ ] **Step 2: Write McpModule**

Create `apps/engines/src/apps/mcp/mcp.module.ts`:
```ts
import { Module } from "@nestjs/common"
import { APP_FILTER, APP_GUARD } from "@nestjs/core"
import { McpModule as McpNestModule } from "@rekog/mcp-nest"

import { McpExceptionFilter } from "./errors/mcp-exception.filter"
import { McpTokenGuard } from "./guards/mcp-token.guard"
import { WorkspaceMemberGuard } from "./guards/workspace-member.guard"
import { FileUploader, STORAGE } from "./services/file-uploader.service"
import { MarkdownRenderer } from "./services/markdown-renderer.service"
import { PageWriter } from "./services/page-writer.service"
import { StatsService } from "./services/stats.service"
import { PageTools } from "./tools/page.tools"
import { PageFileTools } from "./tools/page-file.tools"
import { WorkspaceTools } from "./tools/workspace.tools"

import { storage } from "@repo/storage"

@Module({
  imports: [
    McpNestModule.forRoot({
      name: "anynote-engines",
      version: "0.1.0",
      transport: { type: "streamable-http", endpoint: "/mcp" },
      guards: [McpTokenGuard],
    }),
  ],
  providers: [
    McpTokenGuard,
    WorkspaceMemberGuard,
    MarkdownRenderer,
    PageWriter,
    FileUploader,
    StatsService,
    PageTools,
    PageFileTools,
    WorkspaceTools,
    { provide: STORAGE, useValue: storage },
    { provide: APP_FILTER, useClass: McpExceptionFilter },
  ],
})
export class McpModule {}
```

> Adjust `transport` options per the installed `@rekog/mcp-nest` version. If the library's option names differ, read its README: `node_modules/@rekog/mcp-nest/README.md`. The tool decorators themselves are stable across versions.

- [ ] **Step 3: Wire into AppModule**

Modify `apps/engines/src/app.module.ts`:
```ts
import { McpModule } from "./apps/mcp/mcp.module"

@Module({
  imports: [
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? "redis://localhost:6379",
      },
    }),
    DbModule,
    QdrantModule,
    OllamaModule,
    IndexerModule,
    McpModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter engines test
pnpm --filter engines check-types
```

Expected: all passing, no type errors.

- [ ] **Step 5: Manual smoke**

```bash
docker compose up -d postgres redis qdrant ollama
pnpm --filter engines dev &
sleep 5

# verify /health
curl -s http://localhost:8082/health

# verify /mcp rejects without auth
curl -s -X POST http://localhost:8082/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: 401 Unauthorized

# verify /mcp with token returns tool list
curl -s -X POST http://localhost:8082/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ENGINES_MCP_TOKEN:-dev-token}" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
# Expected: JSON with 15 tools in result.tools

kill %1
```

- [ ] **Step 6: Commit**

```bash
git add apps/engines/src/apps/mcp/mcp.module.ts \
        apps/engines/src/apps/mcp/errors/mcp-exception.filter.ts \
        apps/engines/src/app.module.ts
git commit -m "feat(engines/mcp): wire mcp module with 15 tools"
```

---

## Phase 5 — Env, Compose, Dockerfile, Integration Tests

### Task 5.1: Update env + turbo

**Files:**
- Modify: `.env.example` (repo root)
- Modify: `turbo.json` (repo root)

- [ ] **Step 1: Update turbo.json globalEnv**

In `turbo.json` add (or keep existing) env keys, and add the new ones after the existing engines keys:
```json
"ENGINES_PORT",
"ENGINES_MCP_TOKEN",
"ENGINES_MCP_URL",
"REDIS_URL",
"PROCESSING_SERVICE_URL",
"INDEXER_QUIET_PERIOD_MINUTES",
"INDEXER_CRON_EXPRESSION",
"INDEXER_DRAINER_INTERVAL_MS",
"INDEXER_DRAINER_BATCH",
"INDEXER_MAX_ATTEMPTS",
"UPLOAD_INLINE_MAX_BYTES",
```

Remove no-longer-used old Python indexer keys if present: `INDEXER_DATABASE_URL`, `INDEXER_QDRANT_URL`, `INDEXER_QDRANT_API_KEY`, `INDEXER_QDRANT_COLLECTION`, `INDEXER_POLL_INTERVAL_MS`, `INDEXER_BATCH`, `INDEXER_LOCK_TTL_MS`, `INDEXER_WORKER_ID`, `INDEXER_LOG_LEVEL`, `EMBEDDINGS_PROVIDER`, `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIM`.

Add `EMBEDDING_MODEL` (single key, used by new engines).

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:
```env
# Engines service (NestJS)
ENGINES_PORT=8082
ENGINES_MCP_TOKEN=dev-engines-token-change-me
ENGINES_MCP_URL=http://localhost:8082/mcp
REDIS_URL=redis://localhost:6379
PROCESSING_SERVICE_URL=http://localhost:8080
EMBEDDING_MODEL=nomic-embed-text
INDEXER_QUIET_PERIOD_MINUTES=5
INDEXER_CRON_EXPRESSION=*/1 * * * *
INDEXER_DRAINER_INTERVAL_MS=5000
INDEXER_DRAINER_BATCH=50
INDEXER_MAX_ATTEMPTS=5
UPLOAD_INLINE_MAX_BYTES=1048576
```

Remove entries for the now-deleted `INDEXER_*` and `EMBEDDINGS_*` keys that do not exist in the new stack.

- [ ] **Step 3: Commit**

```bash
git add turbo.json .env.example
git commit -m "chore: update env + turbo for new engines service"
```

### Task 5.2: compose.yml engines service

**Files:**
- Modify: `compose.yml`

- [ ] **Step 1: Add engines service block**

In `compose.yml`, immediately before the `volumes:` block, add:
```yaml
  engines:
    build:
      context: .
      dockerfile: apps/engines/Dockerfile
    profiles: ["worker"]
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      qdrant:
        condition: service_started
      ollama:
        condition: service_started
    environment:
      DATABASE_URL: postgresql://user:password@postgres:5432/anynote
      REDIS_URL: redis://redis:6379
      QDRANT_URL: http://qdrant:6333
      QDRANT_API_KEY: ${QDRANT_API_KEY:-dev-qdrant-key}
      QDRANT_COLLECTION: page_chunks
      OLLAMA_BASE_URL: http://ollama:11434
      EMBEDDING_MODEL: nomic-embed-text
      PROCESSING_SERVICE_URL: http://agents:8080
      ENGINES_MCP_TOKEN: ${ENGINES_MCP_TOKEN:-dev-engines-token-change-me}
      INDEXER_QUIET_PERIOD_MINUTES: "5"
      INDEXER_CRON_EXPRESSION: "*/1 * * * *"
      INDEXER_DRAINER_INTERVAL_MS: "5000"
    ports:
      - "8082:8082"
```

- [ ] **Step 2: Commit**

```bash
git add compose.yml
git commit -m "chore(compose): add engines service, remove indexer"
```

### Task 5.3: Engines Dockerfile

**Files:**
- Create: `apps/engines/Dockerfile`

- [ ] **Step 1: Write Dockerfile**

Create `apps/engines/Dockerfile`:
```dockerfile
# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS builder

WORKDIR /repo
RUN corepack enable

# Copy the full monorepo — engines depends on @repo/db workspace package
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/engines/package.json ./apps/engines/package.json
COPY packages ./packages
COPY apps/engines ./apps/engines

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/db prisma generate
RUN pnpm --filter engines build

FROM node:22-alpine AS runner
WORKDIR /app
RUN corepack enable

COPY --from=builder /repo/pnpm-lock.yaml /repo/pnpm-workspace.yaml /repo/package.json ./
COPY --from=builder /repo/apps/engines/package.json ./apps/engines/package.json
COPY --from=builder /repo/packages ./packages
COPY --from=builder /repo/apps/engines/dist ./apps/engines/dist
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/engines/node_modules ./apps/engines/node_modules

WORKDIR /app/apps/engines
EXPOSE 8082
CMD ["node", "dist/main.js"]
```

- [ ] **Step 2: Build image**

```bash
docker build -f apps/engines/Dockerfile -t engines:dev .
```

Expected: image builds successfully.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/Dockerfile
git commit -m "build(engines): add dockerfile"
```

### Task 5.4: Engines README

**Files:**
- Create: `apps/engines/README.md`

- [ ] **Step 1: Write README**

Create `apps/engines/README.md`:
```markdown
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
- `INDEXER_CRON_EXPRESSION` — reconciler schedule (default `*/1 * * * *`)
- `UPLOAD_INLINE_MAX_BYTES` — base64-upload ceiling (default 1 MiB)

## Tests

```bash
pnpm --filter engines test            # unit
pnpm --filter engines test-int        # integration (requires docker compose up)
```
```

- [ ] **Step 2: Commit**

```bash
git add apps/engines/README.md
git commit -m "docs(engines): add README"
```

### Task 5.5: Integration test harness + end-to-end indexing flow

**Files:**
- Create: `apps/engines/jest.integration.config.ts`
- Create: `apps/engines/test/integration/indexing.e2e.spec.ts`

- [ ] **Step 1: Write integration jest config**

Create `apps/engines/jest.integration.config.ts`:
```ts
import type { Config } from "jest"

const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: "test/integration/.*\\.e2e\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  testEnvironment: "node",
  testTimeout: 60000,
  moduleNameMapper: {
    "^@src/(.*)$": "<rootDir>/src/$1",
  },
}

export default config
```

- [ ] **Step 2: Write e2e indexing test**

Create `apps/engines/test/integration/indexing.e2e.spec.ts`:
```ts
import { NestFactory } from "@nestjs/core"
import type { INestApplication } from "@nestjs/common"
import { prisma } from "@repo/db"

import { AppModule } from "../../src/app.module"
import { OutboxDrainerService } from "../../src/apps/indexer/cron/outbox-drainer.service"
import { QdrantService } from "../../src/infra/qdrant/qdrant.service"
import { QdrantWriter } from "../../src/apps/indexer/services/qdrant-writer.service"

jest.setTimeout(60000)

describe("Indexing e2e", () => {
  let app: INestApplication
  let qdrant: QdrantService
  let drainer: OutboxDrainerService
  let writer: QdrantWriter

  let workspaceId: string
  let userId: string
  let pageId: string

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false })
    await app.init()
    qdrant = app.get(QdrantService)
    drainer = app.get(OutboxDrainerService)
    writer = app.get(QdrantWriter)
    await writer.ensureCollection()
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: "test-ws" } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: { firstName: "T", lastName: "U", email: `t-${workspaceId}@e.com`, emailVerified: true },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "OWNER" } })
  })

  afterEach(async () => {
    if (workspaceId) {
      await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    }
  })

  it("drains outbox to BullMQ and writes Qdrant points", async () => {
    const page = await prisma.page.create({
      data: {
        workspaceId,
        title: "Hello",
        content: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
        },
        createdById: userId,
        updatedById: userId,
      },
    })
    pageId = page.id

    await prisma.outboxEvent.create({
      data: {
        eventType: "page.upserted",
        aggregateType: "page",
        aggregateId: pageId,
        workspaceId,
        payload: {},
      },
    })

    // Manually invoke drainer (bypasses the 5s schedule)
    await drainer.drain()

    // Wait for BullMQ worker to process
    await new Promise((r) => setTimeout(r, 15000))

    const done = await prisma.outboxEvent.findFirst({
      where: { aggregateId: pageId, status: "DONE" },
    })
    expect(done).toBeTruthy()

    const points = await qdrant.client.scroll(qdrant.collection, {
      filter: { must: [{ key: "pageId", match: { value: pageId } }] },
      limit: 10,
    })
    expect(points.points.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run integration test**

Prerequisites:
```bash
docker compose up -d postgres redis qdrant ollama
docker compose exec -T ollama ollama pull nomic-embed-text
# start apps/agents separately on 8080 (provides /processing/normalize)
pnpm --filter agents dev &

# run the e2e
pnpm --filter engines test-int
```

Expected: `Indexing e2e › drains outbox ... passes`.

- [ ] **Step 4: Commit**

```bash
git add apps/engines/jest.integration.config.ts apps/engines/test/integration/
git commit -m "test(engines): add e2e indexing integration test"
```

### Task 5.6: MCP happy path integration test

**Files:**
- Create: `apps/engines/test/integration/mcp.e2e.spec.ts`

- [ ] **Step 1: Write e2e test**

Create `apps/engines/test/integration/mcp.e2e.spec.ts`:
```ts
import { NestFactory } from "@nestjs/core"
import type { INestApplication } from "@nestjs/common"
import request from "supertest"
import { prisma } from "@repo/db"

import { AppModule } from "../../src/app.module"

jest.setTimeout(30000)

describe("MCP e2e", () => {
  let app: INestApplication
  let http: ReturnType<typeof request>
  let workspaceId: string
  let userId: string

  beforeAll(async () => {
    process.env.ENGINES_MCP_TOKEN = "test-token"
    app = await NestFactory.create(AppModule, { logger: false })
    await app.init()
    await app.listen(0)
    const server = app.getHttpServer() as import("http").Server
    http = request(server)
  })

  afterAll(async () => {
    await app.close()
    await prisma.$disconnect()
  })

  beforeEach(async () => {
    const ws = await prisma.workspace.create({ data: { name: "mcp-test" } })
    workspaceId = ws.id
    const user = await prisma.user.create({
      data: { firstName: "M", lastName: "U", email: `mcp-${workspaceId}@e.com`, emailVerified: true },
    })
    userId = user.id
    await prisma.workspaceMember.create({ data: { workspaceId, userId, role: "OWNER" } })
  })

  afterEach(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } }).catch(() => undefined)
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  })

  it("rejects missing auth header with 401", async () => {
    const res = await http
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
    expect(res.status).toBe(401)
  })

  it("lists tools with valid auth", async () => {
    const res = await http
      .post("/mcp")
      .send({ jsonrpc: "2.0", method: "tools/list", id: 1 })
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer test-token")
    expect(res.status).toBe(200)
    expect(res.body.result?.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "createPage" })]),
    )
  })

  it("creates page via MCP tool call", async () => {
    const res = await http
      .post("/mcp")
      .send({
        jsonrpc: "2.0",
        method: "tools/call",
        id: 2,
        params: {
          name: "createPage",
          arguments: { userId, workspaceId, title: "MCP Page" },
        },
      })
      .set("Content-Type", "application/json")
      .set("Authorization", "Bearer test-token")
    expect(res.status).toBe(200)
    const content = res.body.result?.content?.[0]?.text ?? JSON.stringify(res.body)
    const payload = JSON.parse(content)
    expect(payload.pageId).toBeDefined()

    const created = await prisma.page.findUnique({ where: { id: payload.pageId } })
    expect(created?.title).toBe("MCP Page")
  })

  it("rejects non-member with WORKSPACE_ACCESS_DENIED", async () => {
    const otherUser = await prisma.user.create({
      data: { firstName: "X", lastName: "Y", email: `other-${workspaceId}@e.com`, emailVerified: true },
    })
    try {
      const res = await http
        .post("/mcp")
        .send({
          jsonrpc: "2.0",
          method: "tools/call",
          id: 3,
          params: {
            name: "createPage",
            arguments: { userId: otherUser.id, workspaceId, title: "Denied" },
          },
        })
        .set("Content-Type", "application/json")
        .set("Authorization", "Bearer test-token")
      // @rekog/mcp-nest surfaces the HttpException body; status may be 200 with error payload
      const bodyText = JSON.stringify(res.body)
      expect(bodyText).toMatch(/WORKSPACE_ACCESS_DENIED/)
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => undefined)
    }
  })
})
```

- [ ] **Step 2: Run**

```bash
pnpm --filter engines test-int
```

Expected: 4 e2e cases pass.

- [ ] **Step 3: Commit**

```bash
git add apps/engines/test/integration/mcp.e2e.spec.ts
git commit -m "test(engines/mcp): add mcp e2e integration test"
```

### Task 5.7: Full smoke test + final checks

- [ ] **Step 1: Run all monorepo gates**

```bash
cd /Users/victor/Projects/anynote
pnpm install
pnpm check-types
pnpm lint
pnpm build
pnpm test
```

Expected: all green, no references to removed `apps/indexer`.

- [ ] **Step 2: Boot full stack**

```bash
docker compose up -d postgres redis qdrant ollama minio
docker compose exec -T ollama ollama pull nomic-embed-text
pnpm --filter @repo/db prisma migrate deploy
pnpm --filter agents dev &     # terminal 1 — apps/agents on 8080
pnpm --filter engines dev &    # terminal 2 — new engines on 8082
pnpm --filter web dev &        # terminal 3 — web on 3000
```

- [ ] **Step 3: Smoke flow via web UI**

1. Open `http://localhost:3000`, sign in.
2. Create a workspace, create a `TEXT` page with content "The quick brown fox jumps over the lazy dog".
3. Wait ~10 seconds (web's on-write enqueue already drained).
4. Poll `outbox_events`:
   ```bash
   docker compose exec -T postgres psql -U user -d anynote -c "SELECT id, aggregate_id, status, processed_at FROM outbox_events ORDER BY id DESC LIMIT 5"
   ```
   Expected: your page's row shows `status='DONE'`.
5. Hit Qdrant scroll:
   ```bash
   curl -s -H "api-key: ${QDRANT_API_KEY:-dev-qdrant-key}" \
     "http://localhost:6333/collections/page_chunks/points/scroll" \
     -H "Content-Type: application/json" \
     -d '{"limit":5}'
   ```
   Expected: points with `payload.pageId` matching your page.
6. Call MCP `listSkills` from agents CLI (or curl):
   ```bash
   curl -s -X POST http://localhost:8082/mcp \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer ${ENGINES_MCP_TOKEN}" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"listSkills","arguments":{"userId":"<uuid>","workspaceId":"<uuid>","limit":10}}}'
   ```
   Expected: `{"pages":[...]}` (may be empty if no skill pages exist).

- [ ] **Step 4: Merge**

```bash
git log --oneline main..HEAD  # review commits on feature branch
git checkout main
git merge --no-ff feat/engines-nest-rewrite
git push origin main
```

- [ ] **Step 5: Cleanup**

```bash
git branch -d feat/engines-nest-rewrite
docker compose down
```

---

## Definition of Done

- [ ] `apps/engines` boots as NestJS 11 service, responds `200 OK` on `/health`.
- [ ] `POST /mcp` returns 15 tools; rejects requests without `Authorization: Bearer $ENGINES_MCP_TOKEN`.
- [ ] `OutboxCronService` and `OutboxDrainerService` visible in logs; cron fires every minute.
- [ ] Editing a `TEXT/TEXT` page in `apps/web` results in Qdrant points within ≤ `INDEXER_QUIET_PERIOD_MINUTES + drainer interval + processing time`.
- [ ] `apps/agents POST /processing/normalize` works for RU and EN samples.
- [ ] Old `apps/indexer/` and Python `apps/engines/engines/` directories removed. Git log shows clean replacement.
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm build`, `pnpm test` all green across the monorepo.
- [ ] Integration tests pass (`pnpm --filter engines test-int`).
- [ ] Partial unique index `outbox_events_active_unique` exists in Postgres.
