"""POST /processing/normalize route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import NormalizeRequest, NormalizeResponse
from .use_cases import NormalizeTextUseCase

router = APIRouter(prefix="/processing", tags=["Processing"])


@router.post("/normalize", response_model=NormalizeResponse)
@inject
async def normalize(
    payload: NormalizeRequest,
    use_case: FromDishka[NormalizeTextUseCase],
) -> NormalizeResponse:
    return use_case(payload)
