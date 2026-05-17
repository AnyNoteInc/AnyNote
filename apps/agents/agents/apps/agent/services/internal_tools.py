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


def make_save_memory_tool(
    pending: list[MemoryWrite],
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
        pending.append(MemoryWrite(scope=scope, key=args.key, content=args.content))
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
            'Record a durable fact for this workspace or user (visible across '
            'future chats). scope is "workspace" or "user". key is a short '
            'slug; content is the fact in markdown (up to 2000 chars).'
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
