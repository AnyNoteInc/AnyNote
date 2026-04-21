
from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.schemas import QueryRequestSchema
from agents.apps.chat.use_cases import GenerateStreamUseCase

router = APIRouter(prefix="/chat", tags=["Chat"])


@router.post('/generate', response_model=None, response_class=EventSourceResponse)
@inject
async def generate(
    query_reqyest: QueryRequestSchema,
    use_case: FromDishka[GenerateStreamUseCase],
) -> EventSourceResponse:
    return EventSourceResponse(use_case(query_reqyest), ping=15)
