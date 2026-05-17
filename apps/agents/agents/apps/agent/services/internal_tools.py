from __future__ import annotations

import json
from typing import Any, Literal

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agents.apps.agent.enums import AgentMemoryScope
from agents.apps.agent.schemas import AgentState, MemoryWrite


# ── save_memory ──────────────────────────────────────────────────────────────

class _SaveMemoryArgs(BaseModel):
    scope: Literal['workspace', 'user'] = Field(...)
    key: str = Field(..., min_length=1, max_length=120)
    content: str = Field(..., min_length=1, max_length=2000)


def make_save_memory_tool(pending: list[MemoryWrite]) -> StructuredTool:
    async def call(**kwargs: Any) -> str:
        args = _SaveMemoryArgs(**kwargs)
        pending.append(MemoryWrite(
            scope=AgentMemoryScope(args.scope),
            key=args.key,
            content=args.content,
        ))
        return f'Memory recorded: {args.key} (will persist if the answer is approved).'

    return StructuredTool.from_function(
        coroutine=call,
        name='save_memory',
        description=(
            'Record a durable fact for this workspace or user. Persisted '
            'only after the critic approves the final answer.'
        ),
        args_schema=_SaveMemoryArgs,
    )


# ── recall_memory ────────────────────────────────────────────────────────────

class _RecallMemoryArgs(BaseModel):
    query: str
    k: int = Field(default=5, ge=1, le=20)


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
        description='Look up durable workspace/user facts by lexical query.',
        args_schema=_RecallMemoryArgs,
    )


# ── search_pages ─────────────────────────────────────────────────────────────

class _SearchPagesArgs(BaseModel):
    query: str
    k: int = Field(default=10, ge=1, le=30)


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
        )
        if not docs:
            return 'No results.'
        return json.dumps([d.model_dump(mode='json') for d in docs], ensure_ascii=False)

    return StructuredTool.from_function(
        coroutine=call,
        name='search_pages',
        description=(
            'Semantic RAG search over the workspace. Returns matching '
            'block excerpts with pageId, blockNumber, title.'
        ),
        args_schema=_SearchPagesArgs,
    )
