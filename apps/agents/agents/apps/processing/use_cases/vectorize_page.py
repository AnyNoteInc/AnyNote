from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from uuid import UUID

from ..repositories import VectorStoreRepository, VectorizationRepository
from ..schemas import (
    VectorizationRequestSchema, VectorizationResponseSchema,
)
from ..services import ChunkerService, NormalizerService


@dataclass
class VectorizePageUseCase:
    chunker_service: ChunkerService
    normalizer_service: NormalizerService
    vectorization_repository: VectorizationRepository
    vector_store_repository: VectorStoreRepository

    async def __call__(
        self, payload: VectorizationRequestSchema,
    ) -> VectorizationResponseSchema:
        # 1. Идемпотентность: удаляем все точки этой страницы (reindex)
        await self.vector_store_repository.delete_by_page(str(payload.pageId))

        indexed = 0
        skipped = 0
        points: list[tuple[str, list[float], dict[str, Any]]] = []

        for block in payload.contents:
            raw_chunks = self.chunker_service.split(block.content)
            if not raw_chunks:
                skipped += 1
                continue

            for i, raw_chunk in enumerate(raw_chunks):
                normalized = self.normalizer_service.normalize(raw_chunk)
                if not normalized:
                    continue

                vector = await self.vectorization_repository.embed(normalized)

                payload_meta: dict[str, Any] = {
                    'pageId': str(payload.pageId),
                    'workspaceId': str(payload.workspaceId),
                    'title': payload.title,
                    'pageType': payload.pageType,
                    'blockNumber': block.blockNumber,
                    'content': raw_chunk,  # raw chunk до нормализации
                }
                points.append((
                    self._point_id(payload.pageId, block.blockNumber, i),
                    vector,
                    payload_meta,
                ))
                indexed += 1

        await self.vector_store_repository.upsert_chunks(points)
        return VectorizationResponseSchema(
            indexedChunks=indexed, skippedBlocks=skipped,
        )

    @staticmethod
    def _point_id(page_id: UUID, block_number: int, chunk_idx: int) -> str:
        """Стабильный UUID из (pageId, blockNumber, chunkIdx) — Qdrant upsert
        по id делает retry полностью идемпотентным."""
        h = sha256(f'{page_id}:{block_number}:{chunk_idx}'.encode()).hexdigest()
        return str(UUID(h[:32]))
