"""Schemas for the page-search HTTP API."""

from typing import Annotated
from uuid import UUID

from fast_clean.schemas.request_response import RequestResponseSchema
from pydantic import ConfigDict, Field

from agents.apps.processing.schemas import EmbeddingProviderConfigSchema


class SearchRequestSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    workspace_id: UUID
    query: Annotated[str, Field(min_length=1, max_length=500)]
    limit: Annotated[int, Field(default=10, ge=1, le=50)]
    embedding: EmbeddingProviderConfigSchema
    score_threshold: Annotated[float, Field(default=0.7, ge=0.0, le=1.0)]


class SearchResultSchema(RequestResponseSchema):
    model_config = ConfigDict(populate_by_name=True)

    page_id: UUID
    title: str
    block_number: int
    content: str


class SearchResponseSchema(RequestResponseSchema):
    results: list[SearchResultSchema]
