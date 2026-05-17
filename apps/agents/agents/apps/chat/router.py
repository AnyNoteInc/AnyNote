from typing import Annotated

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Header
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.use_cases import GenerateStreamUseCase

from .schemas import QueryRequestSchema, UserContextSchema
from .utils import (
    serialize_server_event as serialize_server_event,
)
from .utils import (
    serialize_server_events,
)

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post('/generate', response_model=None, response_class=EventSourceResponse)
@inject
async def generate(
    query_reqyest: QueryRequestSchema,
    generate_stream_use_case: FromDishka[GenerateStreamUseCase],
    user_context: Annotated[UserContextSchema, Header()],
) -> EventSourceResponse:
    return EventSourceResponse(
        serialize_server_events(generate_stream_use_case(query_reqyest, user_context)),
        ping=15,
    )
