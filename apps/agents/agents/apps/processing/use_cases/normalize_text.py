from dataclasses import dataclass

from ..schemas import NormalizeRequestSchema, NormalizeResponseSchema
from ..services import NormalizerService


@dataclass
class NormalizeTextUseCase:
    normalizer: NormalizerService

    def __call__(self, payload: NormalizeRequestSchema) -> NormalizeResponseSchema:
        chunks, language = self.normalizer.normalize(payload.text, payload.language)
        return NormalizeResponseSchema(chunks=chunks, language=language)
