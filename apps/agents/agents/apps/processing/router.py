"""POST /processing/normalize route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.processing.schemas import NormalizeRequest, NormalizeResponse
from agents.apps.processing.services.normalizer import NormalizerService

processing_router = APIRouter(prefix="/processing", tags=["processing"])


@processing_router.post("/normalize", response_model=NormalizeResponse)
@inject
async def normalize(
    payload: NormalizeRequest,
    normalizer: FromDishka[NormalizerService],
) -> NormalizeResponse:
    normalized, language = normalizer.normalize(payload.text, payload.language)
    return NormalizeResponse(normalized=normalized, language=language)
