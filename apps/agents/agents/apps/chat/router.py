"""FastAPI router for chat generation."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.schemas import QueryRequestSchema
from agents.apps.chat.use_cases import GenerateStreamUseCase

router = APIRouter()


@router.post('/generate')
@inject
async def generate(
    query_reqyest: QueryRequestSchema,
    use_case: FromDishka[GenerateStreamUseCase],
) -> EventSourceResponse:
    return EventSourceResponse(use_case(query_reqyest), ping=15)
