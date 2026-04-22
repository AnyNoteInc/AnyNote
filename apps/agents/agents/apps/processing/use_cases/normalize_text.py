from dataclasses import dataclass
from typing import Protocol

from agents.apps.processing.schemas import DetectedLanguage, Language, NormalizeRequest, NormalizeResponse


class Normalizer(Protocol):
    def normalize(self, text: str, language: Language) -> tuple[str, DetectedLanguage]: ...


@dataclass
class NormalizeTextUseCase:
    normalizer: Normalizer

    def __call__(self, payload: NormalizeRequest) -> NormalizeResponse:
        normalized, language = self.normalizer.normalize(payload.text, payload.language)
        return NormalizeResponse(normalized=normalized, language=language)
