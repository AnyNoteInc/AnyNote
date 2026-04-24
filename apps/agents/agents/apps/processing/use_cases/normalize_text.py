from dataclasses import dataclass

from ..schemas import NormalizeRequestSchema, NormalizeResponseSchema
from ..services import NormalizerService


@dataclass
class NormalizeTextUseCase:
    normalizer: NormalizerService

    def __call__(self, payload: NormalizeRequestSchema) -> NormalizeResponseSchema:
        normalized = self.normalizer.normalize(payload.text)
        chunks = [normalized] if normalized else []
        # Language is detected automatically within normalize()
        language = self.normalizer.detector.detect(payload.text) if payload.text else 'ru'
        return NormalizeResponseSchema(chunks=chunks, language=language)
