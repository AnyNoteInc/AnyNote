from unittest.mock import AsyncMock

import pytest

from agents.apps.agent.enums import AgentMemoryScope, CriticVerdict
from agents.apps.agent.schemas import MemoryWrite
from agents.apps.agent.services.nodes.memory_writer import memory_writer_node
from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_memory_writer_persists_pending_writes_on_approve():
    fake_client = AsyncMock()
    state = make_state()
    state = state.model_copy(update={
        'critic_verdict': CriticVerdict.APPROVE,
        'pending_memory_writes': [
            MemoryWrite(scope=AgentMemoryScope.WORKSPACE, key='k', content='c'),
        ],
    })
    out = await memory_writer_node(state, memory_client=fake_client, jwt='jwt')
    fake_client.write_batch.assert_awaited_once()
    assert out.pending_memory_writes == []


@pytest.mark.asyncio
async def test_memory_writer_skips_on_reject():
    fake_client = AsyncMock()
    state = make_state()
    state = state.model_copy(update={
        'critic_verdict': CriticVerdict.REJECT,
        'pending_memory_writes': [
            MemoryWrite(scope=AgentMemoryScope.USER, key='k', content='c'),
        ],
    })
    out = await memory_writer_node(state, memory_client=fake_client, jwt='jwt')
    fake_client.write_batch.assert_not_awaited()
    # writes are discarded on reject
    assert out.pending_memory_writes == []
