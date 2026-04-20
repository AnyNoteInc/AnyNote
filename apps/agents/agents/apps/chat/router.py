"""FastAPI router for chat generation."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter, Depends
from sse_starlette.sse import EventSourceResponse

from agents.apps.chat.schemas import GenerateRequest
from agents.apps.chat.use_cases import GenerateStreamUseCase
from agents.entrypoints.rest.auth import require_bearer

router = APIRouter(prefix="/api/v1")


@router.post("/generate", dependencies=[Depends(require_bearer)])
@inject
async def generate(
    body: GenerateRequest,
    use_case: FromDishka[GenerateStreamUseCase],
) -> EventSourceResponse:
    return EventSourceResponse(use_case.stream(body), ping=15)
