from dataclasses import dataclass
from uuid import UUID

from langchain_core.documents import Document

from agents.apps.agent.schemas import RagDocumentSchema
from agents.apps.processing.repositories import EmbeddingFactoryRepository, VectorStoreRepository
from agents.apps.processing.schemas import EmbeddingProviderConfigSchema
from agents.apps.processing.utils import collection_name_for


@dataclass
class RagRetrievalService:
    """Поиск top-K релевантных чанков из Qdrant с dedup по (pageId, blockNumber)."""  # noqa: RUF002

    vector_store_repository: VectorStoreRepository
    embedding_factory_repository: EmbeddingFactoryRepository

    async def retrieve(
        self,
        *,
        embedding: EmbeddingProviderConfigSchema,
        workspace_id: UUID,
        query: str,
        k: int = 5,
        score_threshold: float | None = 0.7,
    ) -> list[RagDocumentSchema]:
        embedder = self.embedding_factory_repository.make(embedding)
        collection = collection_name_for(embedding.provider, embedding.model_slug)
        docs = await self.vector_store_repository.similarity_search(
            collection_name=collection,
            embeddings=embedder,
            workspace_id=str(workspace_id),
            query=query,
            k=k * 3,
            score_threshold=score_threshold,
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
