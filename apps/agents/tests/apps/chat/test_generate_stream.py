from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, cast
from uuid import uuid4

import pytest
from agents.apps.chat.enums import ModelProviderEnum
from agents.apps.chat.schemas import QueryRequestSchema, ServerEvent, UserContextSchema
from agents.apps.chat.services import GraphService
from agents.apps.chat.use_cases import GenerateStreamUseCase
from langchain_core.messages import ToolMessage


class StubGraph:
    async def astream(self, *_args: object, **_kwargs: object) -> AsyncIterator[dict[str, Any]]:
        yield {
            'type': 'updates',
            'data': {
                'tools': {
                    'messages': [
                        ToolMessage(
                            content=[
                                {'type': 'text', 'text': 'tool '},
                                {'type': 'text', 'text': 'output'},
                            ],
                            tool_call_id='call-1',
                        ),
                    ],
                },
            },
        }


class StubGraphService:
    def make_graph(self, _state: object) -> StubGraph:
        return StubGraph()


def make_query_request() -> QueryRequestSchema:
    return QueryRequestSchema.model_validate({
        'threadId': str(uuid4()),
        'model': {
            'provider': ModelProviderEnum.OPENAI,
            'name': 'gpt-test',
        },
        'systemPrompt': 'base system prompt',
        'instruction': {
            'citationsRequired': False,
        },
        'messages': [],
        'query': 'Latest question',
    })


@pytest.mark.asyncio
async def test_generate_stream_emits_completed_tool_message_as_token() -> None:
    use_case = GenerateStreamUseCase(graph_service=cast(GraphService, StubGraphService()))

    events = [
        event
        async for event in use_case(
            make_query_request(),
            UserContextSchema(x_user_id=uuid4(), x_workspace_id=uuid4()),
        )
    ]

    assert events == [
        ServerEvent.token('tool output'),
        ServerEvent.done(),
    ]
