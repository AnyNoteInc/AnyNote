"""POST /processing/normalize route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import NormalizeRequestSchema, NormalizeResponseSchema
from .use_cases import NormalizeTextUseCase

router = APIRouter(prefix="/processing", tags=["Processing"])


@router.post("/normalize", response_model=NormalizeResponseSchema)
@inject
async def normalize(
    payload: NormalizeRequestSchema,
    use_case: FromDishka[NormalizeTextUseCase],
) -> NormalizeResponseSchema:
    return use_case(payload)
