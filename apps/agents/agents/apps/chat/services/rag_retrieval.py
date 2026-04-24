from dataclasses import dataclass
from uuid import UUID

from langchain_core.documents import Document

from agents.apps.processing.repositories import VectorStoreRepository

from ..schemas import RagDocumentSchema


@dataclass
class RagRetrievalService:
    """Поиск top-K релевантных чанков из Qdrant с dedup по (pageId, blockNumber)."""

    vector_store_repository: VectorStoreRepository

    async def retrieve(
        self, workspace_id: UUID, query: str, k: int = 5,
    ) -> list[RagDocumentSchema]:
        docs = await self.vector_store_repository.similarity_search(
            workspace_id=str(workspace_id), query=query, k=k * 3,
        )
        return self._dedupe(docs, k)

    @staticmethod
    def _dedupe(docs: list[Document], k: int) -> list[RagDocumentSchema]:
        seen: set[tuple[str, int]] = set()
        result: list[RagDocumentSchema] = []
        for d in docs:
            key = (d.metadata['pageId'], d.metadata['blockNumber'])
            if key in seen:
                continue
            seen.add(key)
            result.append(RagDocumentSchema(
                page_id=UUID(d.metadata['pageId']),
                workspace_id=UUID(d.metadata['workspaceId']),
                title=d.metadata['title'],
                page_type=d.metadata['pageType'],
                block_number=d.metadata['blockNumber'],
                content=d.metadata['content'],
            ))
            if len(result) >= k:
                break
        return result
