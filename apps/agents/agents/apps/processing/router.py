"""POST /vectorization route."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import VectorizationRequestSchema, VectorizationResponseSchema
from .use_cases import VectorizePageUseCase

router = APIRouter(prefix='/vectorization', tags=['Vectorization'])


@router.post('', response_model=VectorizationResponseSchema)
@inject
async def vectorize(
    payload: VectorizationRequestSchema,
    use_case: FromDishka[VectorizePageUseCase],
) -> VectorizationResponseSchema:
    return await use_case(payload)
