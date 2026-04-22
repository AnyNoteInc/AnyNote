from agents.apps.processing.schemas import (
    DetectedLanguage,
    Language,
    NormalizeRequest,
    NormalizeResponse,
)
from agents.apps.processing.use_cases import NormalizeTextUseCase


class StubNormalizerService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def normalize(self, text: str, language: Language) -> tuple[str, DetectedLanguage]:
        self.calls.append((text, language))
        return ('normalized text', 'en')


def test_normalize_text_use_case_delegates_to_service() -> None:
    service = StubNormalizerService()
    use_case = NormalizeTextUseCase(service)

    response = use_case(NormalizeRequest(text='Raw TEXT', language='auto'))

    assert response == NormalizeResponse(normalized='normalized text', language='en')
    assert service.calls == [('Raw TEXT', 'auto')]
