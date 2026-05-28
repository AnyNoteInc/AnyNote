"""Page search HTTP routes."""

from __future__ import annotations

from dishka.integrations.fastapi import FromDishka, inject
from fastapi import APIRouter

from agents.apps.agent.services.rag_retrieval import RagRetrievalService

from .schemas import SearchRequestSchema, SearchResponseSchema, SearchResultSchema

router = APIRouter(prefix='/v1/search', tags=['Search'])


@router.post('', response_model=SearchResponseSchema)
@inject
async def search_pages(
    payload: SearchRequestSchema,
    rag: FromDishka[RagRetrievalService],
) -> SearchResponseSchema:
    docs = await rag.retrieve(
        embedding=payload.embedding,
        workspace_id=payload.workspace_id,
        query=payload.query,
        k=payload.limit,
        score_threshold=payload.score_threshold,
    )
    return SearchResponseSchema(
        results=[
            SearchResultSchema(
                page_id=doc.page_id,
                title=doc.title,
                block_number=doc.block_number,
                content=doc.content,
            )
            for doc in docs
        ],
    )
