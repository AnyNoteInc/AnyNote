from typing import Any

import pytest
from agents.apps.agent.schemas import AgentState
from agents.apps.agent.services.graph_streaming import GraphStreamingService
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import START, StateGraph

from tests.apps.agent.factories import make_state


@pytest.mark.asyncio
async def test_only_executor_tokens_become_token_events() -> None:
    answer_model = GenericFakeChatModel(messages=iter([AIMessage(content='Hello world')]))
    other_model = GenericFakeChatModel(messages=iter([AIMessage(content='internal reasoning')]))

    async def executor(state: AgentState) -> dict[str, Any]:
        await answer_model.ainvoke('q')
        return {}

    async def critic(state: AgentState) -> dict[str, Any]:
        await other_model.ainvoke('q')
        return {}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_node('critic', critic)
    g.add_edge(START, 'executor')
    g.add_edge('executor', 'critic')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(user_message='hi')
    config: RunnableConfig = {'configurable': {'thread_id': 'tok'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    token_text = ''.join(e.text or '' for e in events if e.type == 'token')
    assert token_text == 'Hello world'
    assert 'internal' not in token_text


@pytest.mark.asyncio
async def test_final_answer_not_emitted_twice() -> None:
    answer_model = GenericFakeChatModel(messages=iter([AIMessage(content='Answer A')]))

    async def executor(state: AgentState) -> dict[str, Any]:
        ai = await answer_model.ainvoke('q')
        return {'final_answer': ai.content, 'current_step_id': None}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_edge(START, 'executor')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(user_message='hi')
    config: RunnableConfig = {'configurable': {'thread_id': 'once'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    # Tokens stream as multiple chunks; concatenate to verify the full answer
    # arrives exactly once (no duplicate from _yield_final_events).
    token_text = ''.join(e.text or '' for e in events if e.type == 'token')
    assert token_text == 'Answer A'


@pytest.mark.asyncio
async def test_fallback_emits_answer_when_no_tokens_streamed() -> None:
    def executor(state: AgentState) -> dict[str, Any]:
        return {'final_answer': 'Fallback answer', 'current_step_id': None}

    g = StateGraph(AgentState)
    g.add_node('executor', executor)
    g.add_edge(START, 'executor')
    compiled = g.compile(checkpointer=MemorySaver())

    initial = make_state(user_message='hi')
    config: RunnableConfig = {'configurable': {'thread_id': 'fallback'}}

    events = [e async for e in GraphStreamingService().stream(compiled, initial, config, initial)]
    token_chunks = [e.text for e in events if e.type == 'token']
    assert token_chunks == ['Fallback answer']
