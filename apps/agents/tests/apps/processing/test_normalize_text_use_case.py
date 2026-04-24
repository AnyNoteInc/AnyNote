from typing import cast

from agents.apps.processing.schemas import (
    DetectedLanguage,
    Language,
    NormalizeRequestSchema,
    NormalizeResponseSchema,
)
from agents.apps.processing.services import NormalizerService
from agents.apps.processing.use_cases import NormalizeTextUseCase


class StubNormalizerService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def normalize(self, text: str, language: Language) -> tuple[list[str], DetectedLanguage]:
        self.calls.append((text, language))
        return (['chunk one', 'chunk two'], 'en')


def test_normalize_text_use_case_delegates_to_service() -> None:
    stub = StubNormalizerService()
    service = cast(NormalizerService, stub)
    use_case = NormalizeTextUseCase(service)

    response = use_case(NormalizeRequestSchema(text='Raw TEXT', language='auto'))

    assert response == NormalizeResponseSchema(chunks=['chunk one', 'chunk two'], language='en')
    assert stub.calls == [('Raw TEXT', 'auto')]
