from collections.abc import AsyncIterator
from json import dumps
from typing import Annotated

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Header
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.use_cases import GenerateStreamUseCase

from .schemas import QueryRequestSchema, ServerEvent, UserContextSchema

router = APIRouter(prefix="/chat", tags=["Chat"])


def serialize_server_event(event: ServerEvent) -> dict[str, str]:
    return {
        'data': dumps(
            event.model_dump(mode='json', exclude_none=True),
            ensure_ascii=False,
            separators=(',', ':'),
        ),
    }


async def serialize_server_events(events: AsyncIterator[ServerEvent]) -> AsyncIterator[dict[str, str]]:
    async for event in events:
        yield serialize_server_event(event)


@router.post('/generate', response_model=None, response_class=EventSourceResponse)
@inject
async def generate(
    query_reqyest: QueryRequestSchema,
    generate_stream_use_case: FromDishka[GenerateStreamUseCase],
    user_context: Annotated[UserContextSchema, Header()]
) -> EventSourceResponse:
    return EventSourceResponse(
        serialize_server_events(generate_stream_use_case(query_reqyest, user_context)),
        ping=15,
    )
