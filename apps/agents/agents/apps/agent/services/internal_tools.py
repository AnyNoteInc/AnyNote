from __future__ import annotations

import json
from typing import Any, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agents.apps.agent.enums import AgentMemoryScope
from agents.apps.agent.schemas import AgentState, MemoryWriteSchema

# ── save_memory ──────────────────────────────────────────────────────────────

class _SaveMemoryArgs(BaseModel):
    scope: Literal['workspace', 'user'] = Field(
        ..., description='workspace — общий для всех; user — личный для текущего пользователя',
    )
    key: str = Field(
        ..., min_length=1, max_length=120,
        description='Короткий уникальный слаг для факта, например "tone-formal" или "любимый-напиток"',
    )
    content: str = Field(
        ..., min_length=1, max_length=2000,
        description='Сам факт в Markdown, до 2000 символов',
    )


def make_save_memory_tool(
    pending: list[MemoryWriteSchema],
    *,
    memory_client: Any | None = None,
    jwt: str | None = None,
    workspace_id: str | None = None,
    user_id: str | None = None,
) -> StructuredTool:
    """Build a save_memory tool.

    Behaviour: appends the write to ``pending`` so the memory_writer node sees
    it via state; AND — when ``memory_client`` is supplied — persists
    immediately so the write survives even if the critic verdict path doesn't
    propagate ``pending_memory_writes`` back through the graph state (which is
    the current v1 behaviour, see comment in run_agent.py).
    """
    async def call(**kwargs: Any) -> str:
        args = _SaveMemoryArgs(**kwargs)
        scope = AgentMemoryScope(args.scope)
        pending.append(MemoryWriteSchema(scope=scope, key=args.key, content=args.content))
        if memory_client and jwt and workspace_id and user_id:
            try:
                await memory_client.write_batch(
                    jwt=jwt,
                    entries=[{
                        'workspaceId': workspace_id,
                        'userId': user_id,
                        'scope': scope.value.upper(),
                        'key': args.key,
                        'content': args.content,
                    }],
                )
                return f'Memory saved: {args.key}'
            except Exception as exc:
                return f'Memory recorded locally (persist failed: {exc}).'
        return f'Memory recorded: {args.key} (deferred persist).'

    return StructuredTool.from_function(
        coroutine=call,
        name='save_memory',
        description=(
            'Сохраняет долгосрочный факт о пользователе или рабочем '
            'пространстве (виден во всех будущих чатах). Вызывай когда '
            'пользователь говорит "запомни", "сохрани на будущее", '
            '"запиши факт", "не забывай что". scope="workspace" — общий '
            'для всех участников; scope="user" — личный для текущего '
            'пользователя. key — короткий слаг (≤120 симв.), content — '
            'факт в markdown (≤2000 симв.).'
        ),
        args_schema=_SaveMemoryArgs,
    )


# ── recall_memory ────────────────────────────────────────────────────────────

class _RecallMemoryArgs(BaseModel):
    query: str = Field(..., description='Поисковая фраза по сохранённым фактам')
    k: int = Field(default=5, ge=1, le=20, description='Сколько фактов вернуть (1-20)')


def make_recall_memory_tool(state: AgentState, *, repo: Any) -> StructuredTool:
    async def call(**kwargs: Any) -> str:
        args = _RecallMemoryArgs(**kwargs)
        rows = await repo.search(
            workspace_id=str(state.context.workspace_id),
            user_id=str(state.context.user_id),
            query=args.query,
            k=args.k,
        )
        if not rows:
            return 'No matching memory rows.'
        return json.dumps(rows, ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=call,
        name='recall_memory',
        description=(
            'Ищет ранее сохранённые факты воркспейса/пользователя по '
            'лексическому запросу. Вызывай когда нужно "вспомни что я '
            'говорил про X", "найди мой ранее сохранённый факт", "что мы '
            'знаем о Y". Возвращает до k=5 совпадений (1-20). Не путать '
            'со search_pages — здесь только короткие факты-памятки, не '
            'содержимое страниц.'
        ),
        args_schema=_RecallMemoryArgs,
    )


# ── search_pages ─────────────────────────────────────────────────────────────

class _SearchPagesArgs(BaseModel):
    query: str = Field(..., description='Поисковый запрос по смыслу содержимого страниц')
    k: int = Field(default=10, ge=1, le=30, description='Сколько блоков вернуть (1-30)')


def make_search_pages_tool(*, workspace_id: str, embedding: Any, rag_service: Any) -> StructuredTool:
    async def call(**kwargs: Any) -> str:
        args = _SearchPagesArgs(**kwargs)
        if embedding is None:
            return 'Embedding configuration missing; cannot search.'
        docs = await rag_service.retrieve(
            embedding=embedding,
            workspace_id=workspace_id,
            query=args.query,
            k=args.k,
            score_threshold=0.7,  # explicit RAG cutoff, parity with /v1/search default
        )
        if not docs:
            return 'No results.'
        return json.dumps([d.model_dump(mode='json') for d in docs], ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=call,
        name='search_pages',
        description=(
            'Семантический RAG-поиск по содержимому страниц рабочего '
            'пространства через embeddings. Вызывай когда пользователь '
            'спрашивает по смыслу — "найди заметки про X", "что я писал '
            'о Y", "где упоминается Z". Возвращает релевантные блоки с '
            'pageId, blockNumber, заголовком. Параметры: query (string), '
            'k (1-30, default 10).'
        ),
        args_schema=_SearchPagesArgs,
    )
