from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from uuid import UUID

from ..repositories import EmbeddingFactoryRepository, VectorStoreRepository
from ..schemas import (
    VectorizationRequestSchema,
    VectorizationResponseSchema,
)
from ..services import ChunkerService, NormalizerService
from ..utils import collection_name_for


@dataclass
class VectorizePageUseCase:
    chunker: ChunkerService
    normalizer: NormalizerService
    vector_store: VectorStoreRepository
    embedding_factory: EmbeddingFactoryRepository

    async def __call__(
        self,
        payload: VectorizationRequestSchema,
    ) -> VectorizationResponseSchema:
        embedder = self.embedding_factory.make(payload.embedding)
        collection = collection_name_for(payload.embedding.provider, payload.embedding.model_slug)

        await self.vector_store.ensure_collection(collection, payload.embedding.vector_size)
        await self.vector_store.delete_by_page(collection, payload.page_id)

        skipped = 0
        pending: list[tuple[str, str, int, int]] = []
        for block in payload.contents:
            raw_chunks = self.chunker.split(block.content)
            if not raw_chunks:
                skipped += 1
                continue
            for i, raw in enumerate(raw_chunks):
                normalized = self.normalizer.normalize(raw)
                if not normalized:
                    continue
                pending.append((raw, normalized, block.blockNumber, i))

        if not pending:
            return VectorizationResponseSchema(chunksIndexed=0, skippedBlocks=skipped)

        vectors = await embedder.aembed_documents(
            [normalized for _, normalized, _, _ in pending],
        )

        points: list[tuple[str, list[float], dict[str, Any]]] = []
        for (raw, _normalized, block_number, chunk_idx), vector in zip(pending, vectors, strict=True):
            payload_meta: dict[str, Any] = {
                'pageId': payload.page_id,
                'workspaceId': payload.workspace_id,
                'title': payload.title,
                'pageType': payload.pageType,
                'blockNumber': block_number,
                'content': raw,  # raw chunk до нормализации
            }
            points.append(
                (
                    self._point_id(payload.pageId, block_number, chunk_idx),
                    vector,
                    payload_meta,
                )
            )

        await self.vector_store.upsert_chunks(collection, points)
        return VectorizationResponseSchema(
            chunksIndexed=len(points),
            skippedBlocks=skipped,
        )

    @staticmethod
    def _point_id(page_id: str | UUID, block_number: int, chunk_idx: int) -> str:
        """Стабильный UUID из (pageId, blockNumber, chunkIdx) — Qdrant upsert
        по id делает retry полностью идемпотентным."""
        h = sha256(f'{page_id}:{block_number}:{chunk_idx}'.encode()).hexdigest()
        return str(UUID(h[:32]))
