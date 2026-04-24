from uuid import UUID

from pydantic import BaseModel, Field


class ContentBlockSchema(BaseModel):
    blockNumber: int = Field(..., ge=0)
    content: str = Field(..., min_length=1)


class VectorizationRequestSchema(BaseModel):
    pageId: UUID
    workspaceId: UUID
    title: str
    pageType: str
    contents: list[ContentBlockSchema]


class VectorizationResponseSchema(BaseModel):
    indexedChunks: int
    skippedBlocks: int
