from dataclasses import dataclass
from typing import Protocol

from agents.apps.processing.schemas import NormalizeRequest, NormalizeResponse
from ..services import NormalizerService

@dataclass
class NormalizeTextUseCase:
    normalizer: NormalizerService

    def __call__(self, payload: NormalizeRequest) -> NormalizeResponse:
        normalized, language = self.normalizer.normalize(payload.text, payload.language)
        return NormalizeResponse(normalized=normalized, language=language)
