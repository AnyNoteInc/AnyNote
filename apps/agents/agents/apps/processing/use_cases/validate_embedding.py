import asyncio
from dataclasses import dataclass

from ..repositories import EmbeddingFactoryRepository
from ..schemas import (
    EmbeddingProviderConfigSchema,
    EmbeddingValidationRequestSchema,
    EmbeddingValidationResponseSchema,
)

_EMB_TIMEOUT = 10.0


@dataclass
class ValidateEmbeddingUseCase:
    embedding_factory: EmbeddingFactoryRepository

    async def __call__(self, req: EmbeddingValidationRequestSchema) -> EmbeddingValidationResponseSchema:
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
            if not vector:
                return EmbeddingValidationResponseSchema(ok=False, error='provider returned an empty embedding')
            return EmbeddingValidationResponseSchema(ok=True, vector_size=len(vector))
        except Exception as exc:  # surface provider error to the user
            return EmbeddingValidationResponseSchema(ok=False, error=(str(exc) or f'timed out after {_EMB_TIMEOUT:.0f}s')[:500])
