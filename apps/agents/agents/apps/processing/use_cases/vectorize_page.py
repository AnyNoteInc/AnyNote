from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from uuid import UUID

from ..repositories import VectorizationRepository, VectorStoreRepository
from ..schemas import (
    VectorizationRequestSchema,
    VectorizationResponseSchema,
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

        # 2. Собираем pending-чанки: (raw, normalized, block_number, chunk_idx)
        skipped = 0
        pending: list[tuple[str, str, int, int]] = []
        for block in payload.contents:
            raw_chunks = self.chunker_service.split(block.content)
            if not raw_chunks:
                skipped += 1
                continue
            for i, raw in enumerate(raw_chunks):
                normalized = self.normalizer_service.normalize(raw)
                if not normalized:
                    continue
                pending.append((raw, normalized, block.blockNumber, i))

        if not pending:
            await self.vector_store_repository.upsert_chunks([])
            return VectorizationResponseSchema(indexedChunks=0, skippedBlocks=skipped)

        # 3. Векторизуем всё одним batch-запросом
        vectors = await self.vectorization_repository.embed_batch(
            [normalized for _, normalized, _, _ in pending],
        )

        # 4. Собираем точки
        points: list[tuple[str, list[float], dict[str, Any]]] = []
        for (raw, _normalized, block_number, chunk_idx), vector in zip(pending, vectors, strict=True):
            payload_meta: dict[str, Any] = {
                'pageId': str(payload.pageId),
                'workspaceId': str(payload.workspaceId),
                'title': payload.title,
                'pageType': payload.pageType,
                'blockNumber': block_number,
                'content': raw,  # raw chunk до нормализации
            }
            points.append((
                self._point_id(payload.pageId, block_number, chunk_idx),
                vector,
                payload_meta,
            ))

        await self.vector_store_repository.upsert_chunks(points)
        return VectorizationResponseSchema(
            indexedChunks=len(points), skippedBlocks=skipped,
        )

    @staticmethod
    def _point_id(page_id: UUID, block_number: int, chunk_idx: int) -> str:
        """Стабильный UUID из (pageId, blockNumber, chunkIdx) — Qdrant upsert
        по id делает retry полностью идемпотентным."""
        h = sha256(f'{page_id}:{block_number}:{chunk_idx}'.encode()).hexdigest()
        return str(UUID(h[:32]))
