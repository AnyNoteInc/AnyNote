from unittest.mock import AsyncMock

import pytest
from agents.apps.agent.enums import AgentMemoryScope
from agents.apps.agent.services.internal_tools import (
    make_recall_memory_tool,
    make_save_memory_tool,
    make_search_pages_tool,
)

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_save_memory_tool_appends_to_state() -> None:
    pending: list = []
    tool = make_save_memory_tool(pending)
    out = await tool.ainvoke({'scope': 'workspace', 'key': 'k', 'content': 'c'})
    assert 'recorded' in out.lower()
    assert pending[0].key == 'k'
    assert pending[0].scope == AgentMemoryScope.WORKSPACE


@pytest.mark.asyncio
async def test_recall_memory_tool_returns_top_k() -> None:
    state = make_state()
    state.long_term_memories = []  # not used; tool searches externally
    fake_repo = AsyncMock()
    fake_repo.search = AsyncMock(return_value=[
        {'key': 'tone-formal', 'content': 'User prefers formal'},
    ])
    tool = make_recall_memory_tool(state, repo=fake_repo)
    out = await tool.ainvoke({'query': 'tone', 'k': 5})
    assert 'tone-formal' in out


@pytest.mark.asyncio
async def test_search_pages_tool_delegates_to_rag_service() -> None:
    fake_rag = AsyncMock()
    fake_rag.retrieve = AsyncMock(return_value=[])
    # Pass a truthy embedding sentinel so the guard is not hit
    tool = make_search_pages_tool(workspace_id='w1', embedding=object(), rag_service=fake_rag)
    out = await tool.ainvoke({'query': 'q', 'k': 10})
    fake_rag.retrieve.assert_awaited_once()
    assert 'no results' in out.lower() or out == '[]'


def test_save_memory_description_mentions_remember_keyword() -> None:
    pending: list = []
    tool = make_save_memory_tool(pending)
    description = (tool.description or '').lower()
    assert 'запомни' in description or 'сохрани' in description, description


def test_recall_memory_description_mentions_recall_keyword() -> None:
    tool = make_recall_memory_tool(make_state(), repo=AsyncMock())
    description = (tool.description or '').lower()
    assert 'вспомни' in description or 'найди' in description, description


def test_search_pages_description_mentions_workspace_search() -> None:
    tool = make_search_pages_tool(workspace_id='w', embedding=object(), rag_service=AsyncMock())
    description = (tool.description or '').lower()
    assert 'страниц' in description, description
