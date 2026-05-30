"""Vectorization routes."""

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from .schemas import (
    PageWipeResponseSchema,
    VectorizationRequestSchema,
    VectorizationResponseSchema,
    WorkspaceWipeResponseSchema,
)
from .use_cases import DeletePageVectorsUseCase, DeleteWorkspaceVectorsUseCase, VectorizePageUseCase

router = APIRouter(prefix='/vectorization', tags=['Vectorization'])


@router.post('')
@inject
async def vectorize(
    payload: VectorizationRequestSchema,
    use_case: FromDishka[VectorizePageUseCase],
) -> VectorizationResponseSchema:
    return await use_case(payload)


@router.delete('/pages/{page_id}')
@inject
async def delete_page_vectors(
    page_id: str,
    use_case: FromDishka[DeletePageVectorsUseCase],
) -> PageWipeResponseSchema:
    return await use_case(page_id)


@router.delete('/workspaces/{workspace_id}')
@inject
async def delete_workspace_vectors(
    workspace_id: str,
    use_case: FromDishka[DeleteWorkspaceVectorsUseCase],
) -> WorkspaceWipeResponseSchema:
    return await use_case(workspace_id)
