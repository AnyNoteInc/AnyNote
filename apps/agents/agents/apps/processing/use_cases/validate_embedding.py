from __future__ import annotations

import asyncio
from dataclasses import dataclass

from ..repositories import EmbeddingFactoryRepository
from ..schemas import (
    EmbeddingProviderConfigSchema,
    EmbeddingValidationRequest,
    EmbeddingValidationResponse,
)

_EMB_TIMEOUT = 10.0


@dataclass
class ValidateEmbeddingUseCase:
    embedding_factory: EmbeddingFactoryRepository

    async def __call__(self, req: EmbeddingValidationRequest) -> EmbeddingValidationResponse:
        try:
            config = EmbeddingProviderConfigSchema(
                provider=req.provider,
                model_slug=req.model_slug,
                vector_size=1,  # placeholder; not used by .make(); real size measured below
                connection=req.connection,
            )
            embedder = self.embedding_factory.make(config)
            async with asyncio.timeout(_EMB_TIMEOUT):
                vector = await embedder.aembed_query('ping')
            return EmbeddingValidationResponse(ok=True, vector_size=len(vector))
        except Exception as exc:  # noqa: BLE001
            return EmbeddingValidationResponse(ok=False, error=(str(exc) or f'timed out after {_EMB_TIMEOUT:.0f}s')[:500])
