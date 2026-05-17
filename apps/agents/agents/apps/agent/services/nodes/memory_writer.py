from __future__ import annotations

import logging

from agents.apps.agent.enums import CriticVerdict
from agents.apps.agent.repositories.memory_writer_client import MemoryWriterClient
from agents.apps.agent.schemas import AgentState

log = logging.getLogger(__name__)


async def memory_writer_node(
    state: AgentState,
    *,
    memory_client: MemoryWriterClient,
    jwt: str,
) -> AgentState:
    writes = state.pending_memory_writes
    if state.critic_verdict == CriticVerdict.APPROVE and writes:
        await memory_client.write_batch(
            jwt=jwt,
            entries=[
                {
                    'workspaceId': str(state.context.workspace_id),
                    'userId': str(state.context.user_id),
                    'scope': w.scope.value.upper(),
                    'key': w.key,
                    'content': w.content,
                }
                for w in writes
            ],
        )
    return state.model_copy(update={'pending_memory_writes': []})
